# CURRENT STATUS — KAMUCL 1.1.21

香港产品日志：2026-10-09 01:04。本批Windows x64和Mac ARM64；Electron44.3.0。图片、收藏、设置、全部历史计数、旧实例和未提交文件保留。不操作wuhui、不强推、不结束他人游戏；资源占用优化暂停。

## Identity

- Project: KAMUCL
- Version or revision: 1.1.21；最终master提交由标签与DELIVERY绑定
- Status timestamp: 2026-10-09 03:47 Asia/Hong_Kong

## Last verified state

Windows产品输入与c6771c4f6a453d6a2b171e372f83b94df224b562一致；实际开建时为b11 checkout加当时未提交的焦点修复，随后这些产品输入以c677提交。539生产输入在最终构建前完全读取并冻结，当前文件和实际ASAR逐字节核对。Windows正式EXE SHA034b64e5…、ASAR1b6b85d8…、renderer dddda49c…。后续QA-only提交263df7aacacbb4577e2f8c0f0232cec5d1a4b9b1的测试和对应矩阵独立列明，没有再改变产品输入；原生Mac8e与后续原包复用补验的来源分别绑定。

Mac原生构建/QA来源8e29307b0eefa95d12dea948fab2002b7807854b，fresh run37820579554，ARM64、macOS26、Electron44.3.0；正式ASAR75981e1837d06425234c1279db65e499174fd7898be2bf24c978f7aec1964196。Mac包原字节与本地下载完全核对，APP/DMG实际专项分列。后续QA-only与最终交付文档差异不冒充产品重建。

- Build command: npm run build；electron-builder --win portable --x64 --config.electronDist=node_modules/electron/dist --publish never；node scripts/pack-windows-zip.cjs；原生Mac node scripts/pack-mac.mjs arm64 --package-only
- Build result: 两平台生产构建及包完整性通过；实际功能和游戏验收范围见验证目录
- Test/validation commands: npm test；npx --no-install tsc --noEmit；npm run license:check；Windows便携包/compact UI；实际native Mac工作流及APP/DMG专项
- Validation results: Windows QA263df7aacacbb4577e2f8c0f0232cec5d1a4b9b1全量1588/1589，0失败/1平台skip；Mac1556/1561，0失败/5平台skip；Windowsa844实际16/16界面及后续7528/263df7最小窗口烟雾测试；Mac各job和失败独立列明
- Finished artifact: Windows EXE、紧凑ZIP、展开ZIP；Mac ARM64 ZIP/DMG；源码和交接包由外部DELIVERY绑定
- Artifact SHA256: 平台成品如下；源码/交接/清单的完整SHA由外部DELIVERY与SHA256SUMS绑定

## Last verified artifacts

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| KAMUCL-1.1.21.exe | 97339567 | 034b64e567dd34ce90f784e1c5d2eda920e5ba9050cfdd84070231c3cbbd12a7 |
| KAMUCL-1.1.21-windows-x64.zip | 97371675 | 2cb7a1c7a758c725ffbe5d46cb51937e0b7df2304973679d857e98365d82fb6a |
| KAMUCL-1.1.21-windows-x64-unpacked.zip | 143012837 | cb192afbbc7b1d83705c9b2b7d3e94d90c6bc0a01719b4a780e0fc386ad3e34b |
| KAMUCL-1.1.21-mac-arm64.zip | 125954202 | a4930cc3a722b9308ee7df18b9f97484419306a0782257ef821b1bcd30b27579 |
| KAMUCL-1.1.21-mac-arm64.dmg | 135777009 | 36969f1095a211cfede974b34fe0884a4119a6f019095b960ee57861108c07a5 |

## Completed

14组文档要求已实现并映射：[REQUIREMENTS](docs/validation-1.1.21/REQUIREMENTS.md)。实际修复包含错误版本范围、队列非阻断浏览、主题/导航/透明度/焦点、小屏适应、更新镜像与共享传输、嵌套MRPACK、材质包归一/同步、.DS_Store过滤、26.X关联显示和图片单图替换轮播。

不同作者独立交叉评审：社区9.1/9.2/8.9；外观/导航等9.2/9.1/8.7；镜像控件9.1/9.2/8.8，合理性/功能性/外观分别满足8.5。后端外观无UI时不适用；最终scope、实际证据与Mac修改范围另外绑定，不算平均分或全部平台通过。

Mac本批修改范围的18组原生ARM64离屏矩阵及独立评分通过，使用原8e包、QA263df7aacacbb4577e2f8c0f0232cec5d1a4b9b1、run37831726301；实际窗口、游戏、动效和整个平台仍未放行。这是受控renderer/原包专项，不是实体Mac完整验收。

## Known issues and risks

Mac完整一致性未放行。原始及fresh1.20.1 GLFW/NSGL用例未进入世界；云GPU格式不可用是观察到的线索，无实体设备不能推断真实机器通过。现代26.2实际加入/保存日志与区域文件不代替画面，原黑/模糊截图未改判。次级Acorn异常原网络断言来源尚未确定。显示恢复等失败按原job保留。

Windows黑橙原生DWM次级文字较弱，在同机1.1.20原图相同；不宣称全部桌面材质表现一致。页面125%与观察到的DPI120分开。PNG/JPEG/WebP原件未改；native编码一级单通道舍入不是修改用户素材，但不承诺codec内部逐像素完全一致。

原PCL和Nan2uu付费材质包没有取得，合成夹具不代替实物。没有最终新公开Release经镜像完整自动更新实物链。Mac只ad-hoc，无Developer ID/公证、实体Mac/macOS13、人工音效听感或完整帧率覆盖。原帧时间/视频不插帧、不调低标准。

## Remaining

需要原问题包和实机补验上述未覆盖项。最终发布身份/附件完整匿名下载在发布后核对，结果由外部公开核验receipt记录，不能提前写成功。Mac修改专项与整个平台放行分开，详见MAC_ACCEPTANCE。

## Historical failures

[历史记录](docs/validation-1.1.21/HISTORICAL_FAILURES.md)保留初始测试mock/断言失败、真实异步focus缺陷、中间row重建失败、旧Mac18矩阵/过时确认按钮失败，以及实际图形/显示恢复失败。新QA保持GPU/WebGL/errors/原阈值，要求真实状态；没有降Electron或放宽标准。

## Recommended next action

接收者核对SHA后使用自己的账号与游戏目录。维护者先运行交接记录许可命令，再按验收目录区分真实服务、夹具、故障注入与实际native桌面。完整Mac和原样例未覆盖需要新增证据；最终master/main及成品来源差异以DELIVERY为准。
