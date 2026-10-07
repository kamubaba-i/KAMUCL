package cn.kamucl.control;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.Framebuffer;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.client.option.KeyBinding;
import org.lwjgl.glfw.GLFW;
import org.lwjgl.opengl.GL11C;
import org.lwjgl.opengl.GL30C;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * 游戏操作编排：所有 Minecraft API 调用都调度到渲染线程执行并等待结果。
 * 截图读取主帧缓冲（不受窗口遮挡/焦点影响）；输入走游戏自己的
 * Keyboard 回调、Screen 交互、按键绑定与网络处理器，属于确定性操作，
 * 不接触系统真实键鼠、不需要任何系统权限。
 */
public final class GameOps {
    private static final int MAX_ACTIONS = 32;
    private static final int MAX_TEXT = 200;
    private static final long MAX_WAIT_MS = 2000;
    private static final int MAX_SHOT_EDGE = 1600;

    private GameOps() {}

    private interface RenderTask<T> { T run() throws Exception; }

    /** 在渲染线程执行任务并等待（HTTP 线程调用；超时视为游戏卡顿，不阻塞服务线程） */
    private static <T> T onRenderThread(RenderTask<T> task, long timeoutMs) throws Exception {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client == null) throw new IllegalStateException("游戏尚未就绪");
        CompletableFuture<T> future = new CompletableFuture<>();
        client.execute(() -> {
            try {
                future.complete(task.run());
            } catch (Throwable t) {
                future.completeExceptionally(t);
            }
        });
        try {
            return future.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw new IllegalStateException(String.valueOf(cause));
        }
    }

    // ---------------- 状态 ----------------

    public static Map<String, Object> captureState() throws Exception {
        return onRenderThread(() -> {
            MinecraftClient client = MinecraftClient.getInstance();
            Map<String, Object> out = new LinkedHashMap<>();
            ClientPlayerEntity player = client.player;
            out.put("ok", true);
            out.put("inWorld", player != null && client.world != null);
            if (player != null && client.world != null) {
                out.put("playerName", player.getGameProfile().getName());
                out.put("x", Math.round(player.getX() * 100.0) / 100.0);
                out.put("y", Math.round(player.getY() * 100.0) / 100.0);
                out.put("z", Math.round(player.getZ() * 100.0) / 100.0);
                out.put("yaw", Math.round(player.getYaw() * 10.0) / 10.0);
                out.put("pitch", Math.round(player.getPitch() * 10.0) / 10.0);
                out.put("health", player.getHealth());
                out.put("maxHealth", player.getMaxHealth());
                out.put("food", player.getHungerManager().getFoodLevel());
                out.put("gameMode", client.interactionManager != null ? client.interactionManager.getCurrentGameMode().getName() : "unknown");
                out.put("world", client.world.getRegistryKey().getValue().toString());
            }
            out.put("screen", client.currentScreen != null ? client.currentScreen.getClass().getSimpleName() : null);
            out.put("paused", client.isPaused());
            out.put("windowWidth", client.getWindow().getWidth());
            out.put("windowHeight", client.getWindow().getHeight());
            out.put("framebufferWidth", client.getWindow().getFramebufferWidth());
            out.put("framebufferHeight", client.getWindow().getFramebufferHeight());
            return out;
        }, 5000);
    }

    // ---------------- 截图 ----------------

    public static Map<String, Object> captureScreenshot() throws Exception {
        return onRenderThread(() -> {
            MinecraftClient client = MinecraftClient.getInstance();
            Framebuffer fb = client.getFramebuffer();
            int width = fb.textureWidth;
            int height = fb.textureHeight;
            GL30C.glBindFramebuffer(GL30C.GL_FRAMEBUFFER, fb.fbo);
            ByteBuffer pixels = ByteBuffer.allocateDirect(width * height * 4);
            GL11C.glReadPixels(0, 0, width, height, GL11C.GL_RGBA, GL11C.GL_UNSIGNED_BYTE, pixels);
            BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
            for (int y = 0; y < height; y++) {
                int src = height - 1 - y; // OpenGL 原点在左下：垂直翻转
                for (int x = 0; x < width; x++) {
                    int at = (src * width + x) * 4;
                    int r = pixels.get(at) & 0xFF;
                    int g = pixels.get(at + 1) & 0xFF;
                    int b = pixels.get(at + 2) & 0xFF;
                    image.setRGB(x, y, (r << 16) | (g << 8) | b);
                }
            }
            int outW = width, outH = height;
            BufferedImage output = image;
            int edge = Math.max(width, height);
            if (edge > MAX_SHOT_EDGE) {
                double ratio = (double) MAX_SHOT_EDGE / edge;
                outW = Math.max(1, (int) (width * ratio));
                outH = Math.max(1, (int) (height * ratio));
                output = new BufferedImage(outW, outH, BufferedImage.TYPE_INT_RGB);
                Graphics2D g2 = output.createGraphics();
                g2.drawImage(image, 0, 0, outW, outH, null);
                g2.dispose();
            }
            ByteArrayOutputStream png = new ByteArrayOutputStream();
            ImageIO.write(output, "png", png);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("width", outW);
            out.put("height", outH);
            out.put("framebufferWidth", width);
            out.put("framebufferHeight", height);
            out.put("pngBase64", Base64.getEncoder().encodeToString(png.toByteArray()));
            return out;
        }, 10000);
    }

    // ---------------- 输入 ----------------

    private static final Map<String, Integer> KEYS = new LinkedHashMap<>();
    static {
        for (char c = 'A'; c <= 'Z'; c++) KEYS.put(String.valueOf(c), GLFW.GLFW_KEY_A + (c - 'A'));
        for (char c = '0'; c <= '9'; c++) KEYS.put(String.valueOf(c), GLFW.GLFW_KEY_0 + (c - '0'));
        KEYS.put("SPACE", GLFW.GLFW_KEY_SPACE);
        KEYS.put("RETURN", GLFW.GLFW_KEY_ENTER);
        KEYS.put("ENTER", GLFW.GLFW_KEY_ENTER);
        KEYS.put("ESCAPE", GLFW.GLFW_KEY_ESCAPE);
        KEYS.put("ESC", GLFW.GLFW_KEY_ESCAPE);
        KEYS.put("TAB", GLFW.GLFW_KEY_TAB);
        KEYS.put("BACK", GLFW.GLFW_KEY_BACKSPACE);
        KEYS.put("LSHIFT", GLFW.GLFW_KEY_LEFT_SHIFT);
        KEYS.put("RSHIFT", GLFW.GLFW_KEY_RIGHT_SHIFT);
        KEYS.put("LCONTROL", GLFW.GLFW_KEY_LEFT_CONTROL);
        KEYS.put("RCONTROL", GLFW.GLFW_KEY_RIGHT_CONTROL);
        KEYS.put("CTRL", GLFW.GLFW_KEY_LEFT_CONTROL);
        KEYS.put("LALT", GLFW.GLFW_KEY_LEFT_ALT);
        KEYS.put("RALT", GLFW.GLFW_KEY_RIGHT_ALT);
        KEYS.put("UP", GLFW.GLFW_KEY_UP);
        KEYS.put("DOWN", GLFW.GLFW_KEY_DOWN);
        KEYS.put("LEFT", GLFW.GLFW_KEY_LEFT);
        KEYS.put("RIGHT", GLFW.GLFW_KEY_RIGHT);
        KEYS.put("DELETE", GLFW.GLFW_KEY_DELETE);
        KEYS.put("HOME", GLFW.GLFW_KEY_HOME);
        KEYS.put("END", GLFW.GLFW_KEY_END);
        for (int i = 1; i <= 12; i++) KEYS.put("F" + i, GLFW.GLFW_KEY_F1 + (i - 1));
        KEYS.put("SLASH", GLFW.GLFW_KEY_SLASH);
        KEYS.put("MINUS", GLFW.GLFW_KEY_MINUS);
        KEYS.put("PLUS", GLFW.GLFW_KEY_EQUAL);
        KEYS.put("COMMA", GLFW.GLFW_KEY_COMMA);
        KEYS.put("PERIOD", GLFW.GLFW_KEY_PERIOD);
        KEYS.put("SEMICOLON", GLFW.GLFW_KEY_SEMICOLON);
        KEYS.put("QUOTE", GLFW.GLFW_KEY_APOSTROPHE);
        KEYS.put("LBRACKET", GLFW.GLFW_KEY_LEFT_BRACKET);
        KEYS.put("RBRACKET", GLFW.GLFW_KEY_RIGHT_BRACKET);
        KEYS.put("BACKSLASH", GLFW.GLFW_KEY_BACKSLASH);
        KEYS.put("BACKTICK", GLFW.GLFW_KEY_GRAVE_ACCENT);
    }

    private static String str(Object raw, String fallback) {
        return raw == null ? fallback : String.valueOf(raw);
    }

    private static Integer keyCode(Object raw) {
        if (raw == null) return null;
        Integer named = KEYS.get(String.valueOf(raw).toUpperCase(java.util.Locale.ROOT));
        if (named != null) return named;
        try {
            int value = Integer.parseInt(String.valueOf(raw));
            return value > 0 && value <= GLFW.GLFW_KEY_LAST ? value : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static int mouseButton(Object raw) {
        String name = str(raw, "left").toLowerCase(java.util.Locale.ROOT);
        return switch (name) {
            case "right" -> GLFW.GLFW_MOUSE_BUTTON_RIGHT;
            case "middle" -> GLFW.GLFW_MOUSE_BUTTON_MIDDLE;
            default -> GLFW.GLFW_MOUSE_BUTTON_LEFT;
        };
    }

    private static double number(Object raw, double fallback) {
        if (raw instanceof Number n) return n.doubleValue();
        try {
            return Double.parseDouble(String.valueOf(raw));
        } catch (Exception e) {
            return fallback;
        }
    }

    public static Map<String, Object> performActions(List<Object> actions) {
        if (actions.size() > MAX_ACTIONS) return Map.of("ok", false, "error", "单次最多 " + MAX_ACTIONS + " 个动作");
        int performed = 0;
        for (Object raw : actions) {
            if (!(raw instanceof Map<?, ?> action)) return fail(performed, "动作不是对象");
            String type = str(action.get("type"), "");
            try {
                switch (type) {
                    case "wait" -> {
                        long ms = Math.min(MAX_WAIT_MS, Math.max(1, (long) number(action.get("ms"), 100)));
                        Thread.sleep(ms);
                    }
                    case "key" -> {
                        Integer code = keyCode(action.get("key"));
                        if (code == null) return fail(performed, "未知按键：" + action.get("key"));
                        String mode = str(action.get("mode"), "press");
                        if (mode.equals("down")) keyEvent(code, true);
                        else if (mode.equals("up")) keyEvent(code, false);
                        else if (mode.equals("press")) { keyEvent(code, true); Thread.sleep(25); keyEvent(code, false); }
                        else return fail(performed, "mode 必须是 press/down/up");
                    }
                    case "mouseButton" -> {
                        int button = mouseButton(action.get("button"));
                        String mode = str(action.get("mode"), "press");
                        if (mode.equals("down")) mousePress(button, true);
                        else if (mode.equals("up")) mousePress(button, false);
                        else if (mode.equals("press")) { mousePress(button, true); Thread.sleep(25); mousePress(button, false); }
                        else return fail(performed, "mode 必须是 press/down/up");
                    }
                    case "move" -> moveCursor(number(action.get("x"), -1), number(action.get("y"), -1));
                    case "click" -> {
                        double x = number(action.get("x"), -1), y = number(action.get("y"), -1);
                        clickAt(x, y, mouseButton(action.get("button")));
                    }
                    case "scroll" -> {
                        double delta = number(action.get("delta"), 0);
                        if (delta == 0) return fail(performed, "delta 无效");
                        scrollWheel(delta / 120.0);
                    }
                    case "type" -> typeText(str(action.get("text"), ""));
                    case "chat" -> {
                        String text = str(action.get("text"), "");
                        if (text.isBlank()) return fail(performed, "text 为空");
                        sendChat(text, false);
                    }
                    case "exec" -> {
                        String command = str(action.get("command"), "");
                        if (command.isBlank()) return fail(performed, "command 为空");
                        sendChat(command.startsWith("/") ? command.substring(1) : command, true);
                    }
                    case "look" -> {
                        double yaw = number(action.get("yaw"), Double.NaN);
                        double pitch = number(action.get("pitch"), Double.NaN);
                        onRenderThread(() -> {
                            ClientPlayerEntity player = requirePlayer();
                            if (!Double.isNaN(yaw)) player.setYaw((float) yaw);
                            if (!Double.isNaN(pitch)) player.setPitch((float) Math.max(-90, Math.min(90, pitch)));
                            return null;
                        }, 3000);
                    }
                    case "lookDelta" -> {
                        double dx = number(action.get("dx"), 0), dy = number(action.get("dy"), 0);
                        onRenderThread(() -> {
                            requirePlayer().changeLookDirection(dx, dy);
                            return null;
                        }, 3000);
                    }
                    default -> { return fail(performed, "未知动作类型：" + type); }
                }
            } catch (IllegalStateException | IllegalArgumentException e) {
                return fail(performed, e.getMessage());
            } catch (Exception e) {
                return fail(performed, type + " 执行失败：" + e.getMessage());
            }
            performed++;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("performed", performed);
        return out;
    }

    private static Map<String, Object> fail(int performed, String error) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", false);
        out.put("performed", performed);
        out.put("error", error);
        return out;
    }

    private static ClientPlayerEntity requirePlayer() {
        ClientPlayerEntity player = MinecraftClient.getInstance().player;
        if (player == null) throw new IllegalStateException("玩家不在世界中（可能在标题界面或加载中）");
        return player;
    }

    private static void keyEvent(int code, boolean down) throws Exception {
        onRenderThread(() -> {
            MinecraftClient client = MinecraftClient.getInstance();
            client.keyboard.onKey(client.getWindow().getHandle(), code, 0, down ? GLFW.GLFW_PRESS : GLFW.GLFW_RELEASE, 0);
            return null;
        }, 3000);
    }

    /** 世界内左/右/中键对应的按键绑定（攻击/使用/选取方块），经游戏自己的输入轮询生效 */
    private static KeyBinding mouseBinding(MinecraftClient client, int button) {
        return switch (button) {
            case GLFW.GLFW_MOUSE_BUTTON_RIGHT -> client.options.useKey;
            case GLFW.GLFW_MOUSE_BUTTON_MIDDLE -> client.options.pickItemKey;
            default -> client.options.attackKey;
        };
    }

    private static void mousePress(int button, boolean down) throws Exception {
        onRenderThread(() -> {
            MinecraftClient client = MinecraftClient.getInstance();
            if (client.currentScreen != null) {
                // 界面内：在光标当前位置点击（坐标系：GUI 缩放像素）
                double sx = client.mouse.getX() * client.getWindow().getScaledWidth() / client.getWindow().getWidth();
                double sy = client.mouse.getY() * client.getWindow().getScaledHeight() / client.getWindow().getHeight();
                if (down) client.currentScreen.mouseClicked(sx, sy, button);
                else client.currentScreen.mouseReleased(sx, sy, button);
            } else {
                mouseBinding(client, button).setPressed(down);
            }
            return null;
        }, 3000);
    }

    private static void moveCursor(double x, double y) throws Exception {
        onRenderThread(() -> {
            MinecraftClient client = MinecraftClient.getInstance();
            Framebuffer fb = client.getFramebuffer();
            if (x < 0 || y < 0 || x >= fb.textureWidth || y >= fb.textureHeight) {
                throw new IllegalStateException("坐标超出画面 " + fb.textureWidth + "x" + fb.textureHeight);
            }
            if (client.currentScreen != null) {
                double sx = x * client.getWindow().getScaledWidth() / fb.textureWidth;
                double sy = y * client.getWindow().getScaledHeight() / fb.textureHeight;
                client.currentScreen.mouseMoved(sx, sy);
            }
            // 世界内移动视角请用 look / lookDelta（无屏幕光标）
            return null;
        }, 3000);
    }

    private static void clickAt(double x, double y, int button) throws Exception {
        boolean screenClick = onRenderThread(() -> {
            MinecraftClient client = MinecraftClient.getInstance();
            Framebuffer fb = client.getFramebuffer();
            if (x < 0 || y < 0 || x >= fb.textureWidth || y >= fb.textureHeight) {
                throw new IllegalStateException("坐标超出画面 " + fb.textureWidth + "x" + fb.textureHeight);
            }
            if (client.currentScreen != null) {
                double sx = x * client.getWindow().getScaledWidth() / fb.textureWidth;
                double sy = y * client.getWindow().getScaledHeight() / fb.textureHeight;
                client.currentScreen.mouseMoved(sx, sy);
                client.currentScreen.mouseClicked(sx, sy, button);
                client.currentScreen.mouseReleased(sx, sy, button);
                return true;
            }
            return false;
        }, 3000);
        if (!screenClick) {
            mousePress(button, true);
            Thread.sleep(25);
            mousePress(button, false);
        }
    }

    private static void scrollWheel(double amount) throws Exception {
        onRenderThread(() -> {
            MinecraftClient client = MinecraftClient.getInstance();
            if (client.currentScreen != null) {
                double sx = client.getWindow().getScaledWidth() / 2.0;
                double sy = client.getWindow().getScaledHeight() / 2.0;
                client.currentScreen.mouseScrolled(sx, sy, 0, amount);
            } else {
                requirePlayer().getInventory().scrollInHotbar(amount);
            }
            return null;
        }, 3000);
    }

    private static void typeText(String text) throws Exception {
        if (text.isEmpty()) return;
        if (text.length() > MAX_TEXT) throw new IllegalArgumentException("text 超过 " + MAX_TEXT + " 字符");
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            onRenderThread(() -> {
                MinecraftClient client = MinecraftClient.getInstance();
                if (client.currentScreen == null) throw new IllegalStateException("当前没有打开的界面可输入（先用 key T 或 SLASH 打开聊天框）");
                client.currentScreen.charTyped(c, 0);
                return null;
            }, 3000);
            Thread.sleep(10);
        }
    }

    private static void sendChat(String text, boolean command) throws Exception {
        if (text.length() > 256) throw new IllegalArgumentException("消息超过 256 字符");
        onRenderThread(() -> {
            ClientPlayNetworkHandler handler = MinecraftClient.getInstance().getNetworkHandler();
            if (handler == null) throw new IllegalStateException("玩家不在世界中，无法发送聊天/命令");
            if (command) handler.sendChatCommand(text);
            else handler.sendChatMessage(text);
            return null;
        }, 3000);
    }
}
