package cn.kamucl.control;

import com.google.gson.Gson;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;

/**
 * 控制 HTTP 服务：仅监听 127.0.0.1 随机端口，一次性 token 写入游戏目录
 * .kamucl-control.json 发现文件（启动器读取发现），与 kamucl-bridge 同一安全模型。
 * 所有游戏 API 调用经 GameOps 编排到渲染线程执行。
 */
public final class ControlServer {
    public static final int PROTOCOL = 1;
    private static final Gson GSON = new Gson();

    private ControlServer() {}

    public static void start(Path gameDir, String modVersion, String mcVersion) throws IOException {
        String token = newToken();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/kamucl-control/v1/ping", exchange -> respond(exchange, null, () -> Map.of("ok", true, "protocol", PROTOCOL)));
        server.createContext("/kamucl-control/v1/state", exchange -> respond(exchange, token, GameOps::captureState));
        server.createContext("/kamucl-control/v1/screenshot", exchange -> respond(exchange, token, GameOps::captureScreenshot));
        server.createContext("/kamucl-control/v1/input", exchange -> respond(exchange, token, () -> performInput(exchange)));
        // 与 kamucl-bridge 相同：daemon 线程 + 显式启停，避免游戏退出后 JVM 被挂住
        ExecutorService requests = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "kamucl-control-request");
            thread.setDaemon(true);
            return thread;
        });
        server.setExecutor(requests);
        FutureTask<Void> start = new FutureTask<>(() -> { server.start(); return null; });
        Thread bootstrap = new Thread(start, "kamucl-control-start");
        bootstrap.setDaemon(true);
        bootstrap.start();
        try {
            start.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            requests.shutdownNow();
            server.stop(0);
            throw new IOException("Control startup interrupted", e);
        } catch (ExecutionException e) {
            requests.shutdownNow();
            server.stop(0);
            throw new IOException("Control startup failed", e.getCause());
        }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            requests.shutdownNow();
            server.stop(0);
        }, "kamucl-control-stop"));
        int port = server.getAddress().getPort();
        writeDiscovery(gameDir, port, token, modVersion, mcVersion);
        System.out.println("[KAMUCL Control] 控制服务已就绪，端口 " + port + "（仅本机，需 token）");
    }

    private static String newToken() {
        byte[] bytes = new byte[24];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void writeDiscovery(Path gameDir, int port, String token, String modVersion, String mcVersion) {
        Map<String, Object> discovery = new LinkedHashMap<>();
        discovery.put("protocol", PROTOCOL);
        discovery.put("port", port);
        discovery.put("token", token);
        discovery.put("modVersion", modVersion);
        discovery.put("mcVersion", mcVersion);
        discovery.put("pid", ProcessHandle.current().pid());
        discovery.put("startedAt", System.currentTimeMillis());
        try {
            Files.writeString(gameDir.resolve(".kamucl-control.json"), GSON.toJson(discovery), StandardCharsets.UTF_8);
        } catch (IOException ignored) { /* 发现文件写失败时启动器无法接入，不影响游戏 */ }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> performInput(HttpExchange exchange) throws IOException {
        Map<?, ?> body = readJson(exchange);
        Object actions = body.get("actions");
        if (!(actions instanceof List<?> list) || list.isEmpty()) return Map.of("ok", false, "error", "actions 必须是非空数组");
        return GameOps.performActions((List<Object>) list);
    }

    private static Map<?, ?> readJson(HttpExchange exchange) throws IOException {
        String text = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        if (text.isBlank()) return Map.of();
        Object parsed = GSON.fromJson(text, Object.class);
        if (parsed instanceof Map<?, ?>) return (Map<?, ?>) parsed;
        return Map.of();
    }

    private interface Handler { Map<String, Object> handle() throws Exception; }

    private static void respond(HttpExchange exchange, String expectedToken, Handler handler) throws IOException {
        try {
            if (!"127.0.0.1".equals(exchange.getRemoteAddress().getAddress().getHostAddress())) {
                json(exchange, 403, Map.of("ok", false, "error", "仅限本机访问"));
                return;
            }
            if (expectedToken != null && !expectedToken.equals(exchange.getRequestHeaders().getFirst("X-Kamucl-Token"))) {
                json(exchange, 401, Map.of("ok", false, "error", "身份校验失败：缺少或错误的 token"));
                return;
            }
            json(exchange, 200, handler.handle());
        } catch (Exception e) {
            json(exchange, 500, Map.of("ok", false, "error", String.valueOf(e.getMessage())));
        } finally {
            exchange.close();
        }
    }

    private static void json(HttpExchange exchange, int status, Map<String, Object> body) throws IOException {
        byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
