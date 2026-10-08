# START HERE — KAMUCL 1.1.21

本批实施用户文档的14组要求：社区兼容判断与后台确认队列、个性化/导航/透明度、小屏适应、更新镜像、嵌套整合包、默认材质包、图片与服务器版本显示。Windows x64已覆盖项目通过本批验收，原问题包等未覆盖项另外列明。Mac ARM64同步原生包，实际通过范围和失败独立列明，完整平台一致性未放行。Electron44.3.0保持，资源优化暂停。

- Project: KAMUCL
- Deliverable: 1.1.21 Windows x64、Mac ARM64、源码、交接包及实际验收记录
- Packaged artifact: _handoff/artifacts/内的成品；最终文件大小/SHA由DELIVERY和SHA256SUMS绑定
- Intended receiver: 使用自己账号及游戏目录的玩家、维护者
- Operating system: Windows10/11 x64、macOS13+ ARM64；本批实际Windows11与macOS26 ARM64云桌面
- Runtime/tool versions: Electron44.3.0、Node24、锁定npm依赖、完整JDK17+含javac/jar；Windows本批生产构建JDK21.0.12

## Prerequisites

成品不需要安装Node。游戏使用自己的账号、适配Java及资源。Windows未发行者签名；Mac仅ad-hoc，未Developer ID签名或公证，最低macOS13没有实体测试。Mac尚不能宣称全部游戏/外观/动效与Windows完全一致。

开发环境：Node24、npm ci、JDK17+（完整JDK含jar）、Windows.NET C#编译器；Mac原生构建需要Xcode工具。完整命令见README和docs/DEVELOPMENT.md。

## Setup

核对SHA256SUMS.txt。Windows运行KAMUCL-1.1.21.exe；紧凑ZIP解压后运行同名EXE，展开ZIP运行KAMUCL.exe。Mac使用ARM64 ZIP或DMG的KAMUCL.app，依系统提示安装；签名和未通过项先看docs/validation-1.1.21/MAC_ACCEPTANCE.json。不要覆盖自己的游戏目录或把登录配置发给别人。

源码解压后在项目根npm ci、node scripts/build-bridge.cjs；交接包在source目录执行。保留当前用户数据、旧实例和未提交文件。

## Use the deliverable

社区资源添加到下载队列后可继续搜索和切页。每个任务冻结目标，必要前置在独立确认界面展示；不会因检测完成就自动安装。错误可以重试/取消，结果以实际完成状态和文件为准。

个性化的主题入口、画布、草稿与正式应用分开。取消不应用；失败保留内容并恢复意外失去的按钮焦点。小屏自适应入口保留且默认关闭，开启结合实际工作区和手动缩放，关闭恢复手动缩放。

更新可选择预设及自定义HTTPS镜像，首块测速有缓存；最终附件仍校验官方同版本SHA256。嵌套MRPACK移除旧512MiB整包限制但保留路径/CRC/容量/取消安全检查。材质包支持唯一wrapper，拒绝含糊多包而不丢弃内容。单图片导入替换旧轮播，保存失败回滚。

## Verify

npm test；npx --no-install tsc --noEmit；npm run license:check；npm run build。Windows包：node scripts/verify-windows-package.cjs。Mac原生工作流和专项脚本见验证目录，不能用Windows通过代替Mac结果。

Windows最终QA源263df7aacacbb4577e2f8c0f0232cec5d1a4b9b1全量：1589项/1588通过/0失败/1平台跳过；Mac原生成品8e源全量1561项/1556通过/0失败/5平台跳过。两平台QA源和计数分列。类型、许可、生产构建和包完整性通过。Windowsa844脚本16组矩阵全部通过，后续7528输入协议和263df7计时脚本各有Windows最小窗口125%烟雾测试，另有原生成品/硬件GPU/DPI证据；Mac实际修改范围与全部未通过按job分列。

Mac本批修改范围的18组原生ARM64离屏矩阵及独立评分通过，使用原8e包、QA263df7aacacbb4577e2f8c0f0232cec5d1a4b9b1、run37831726301；实际窗口、游戏、动效和整个平台仍未放行。这是受控renderer/原包专项，不是实体Mac完整验收。

交接记录验证命令数组：["node","source/scripts/check-licenses.cjs"]，交接根运行应输出License check passed并退出0。它只验证许可，不代替游戏、UI或真实服务验收。

源码是最终Git原始blob，所有既有公开历史夹具保留；不含原用户DOCX/ZIP、玩家世界、凭据、私钥、实时profile或未提交pelican-bicycle.html。Windows冻结539输入先于构建完整读取；后来QA/文档变化与成品来源由DELIVERY列明，不冒充最终标签重新构建。

原PCL故障包、Nan2uu原材质包、人工听感、完整动效/帧率、实体Mac/macOS13未覆盖。Mac1.20.1 NSGL游戏失败，现代26.2保存链也不能代替可辨识画面通过；不降低门槛或改写原失败。
