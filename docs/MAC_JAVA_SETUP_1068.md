# macOS Java preparation failure (1.0.68)

The reported case is Intel macOS, Minecraft 26.2, Fabric 0.19.5. The
diagnostic records `下载失败：fetch failed` while preparing Java 25; PID and
exitCode are null. This is a launcher prerequisite-download failure, before
Minecraft or Fabric starts. It is not evidence of a mod crash.

The previous implementation queried Adoptium with Node fetch and downloaded
only the GitHub release URL. Neither that query nor the undici transfer used
macOS system proxy/PAC settings. Failure of that one distribution path ended
launch preparation. The supplied diagnostic does not identify whether the
underlying network failure was DNS, TLS, proxy, or routing.

The replacement uses Electron's system networking for Java metadata and
archives, retaining normal TLS verification. Temurin is attempted first;
failure of metadata, download, checksum or runtime verification switches to
Azul's public Zulu JRE API and independent CDN. Each provider supplies its own
SHA256 and size. A fresh staging directory is verified before publication;
existing runtimes are never deleted or replaced. The resulting Java version
and CPU architecture are checked by running its executable, and discovery
caches are updated immediately. Errors state the required version, platform,
source failures and that Minecraft has not started.

The native regression script `scripts/verify-mac-game.cjs` installs 26.2 with
Fabric 0.19.5 through the packaged app's real IPC. It hides preinstalled Java
25+ only in a disposable runner profile and blocks the Temurin GitHub download
through the test session's network hook. A pass requires the fallback JRE and
an actual native Minecraft window. No production test switch, player account,
player profile or existing game process is used.

Protocol references (independent implementation, no upstream source copied):

- https://adoptium.net/installation/ci-scripts
- https://api.azul.com/metadata/v1/docs/swagger
- https://www.electronjs.org/docs/latest/api/net

Java is downloaded on demand, not embedded in the launcher packages. Original
runtime license and notice files remain in the extracted distribution.
