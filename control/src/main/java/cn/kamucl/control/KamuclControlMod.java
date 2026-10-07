package cn.kamucl.control;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.loader.api.FabricLoader;

import java.nio.file.Path;

/**
 * KAMUCL 控制 MOD 入口：为启动器 MCP Host 提供游戏内能力
 * （玩家状态、画面截图、确定性输入、聊天与命令执行）。
 * 与参数桥接 MOD（kamucl-bridge）相互独立；服务失败绝不影响游戏。
 */
public final class KamuclControlMod implements ModInitializer {
    public static final String MOD_ID = "kamucl-control";
    public static final String VERSION = "1.0.0";

    @Override
    public void onInitialize() {
        Path gameDir = FabricLoader.getInstance().getGameDir();
        String mcVersion = FabricLoader.getInstance().getModContainer("minecraft")
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");
        try {
            ControlServer.start(gameDir, VERSION, mcVersion);
        } catch (Exception e) {
            System.out.println("[KAMUCL Control] 控制服务启动失败（不影响游戏）：" + e.getMessage());
        }
    }
}
