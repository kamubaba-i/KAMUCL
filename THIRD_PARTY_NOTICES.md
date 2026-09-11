# Third-party notices / 第三方声明

The root MIT license covers original KAMUCL contributions only. Third-party
copyright, license and trademark rights remain with their respective holders.

## VoxLink protocol integration — LGPL-3.0-only

Upstream: https://github.com/AUGUHDAR/VoxLink
Revision: 6b11d930fe4fe568dacc8c47fa0e46e08fa4b110 (1.1.5).
Authors: AUGUHDAR / VoxLink contributors.

The adaptations of PunchAuth.java and TurnRelayClient.java are in
src/main/core/voxlink/punchAuth.ts and turn.ts. The replacement protocol runtime
in rudp.ts, punch.ts, session.ts and engine.ts uses the licensed Java
ReliableUdpTransport, SignalingClient, SignalingWsTransport and ConnectionManager
protocols. These files are distributed under LGPL-3.0-only. Node lifecycle,
cancellation, HTTP fallback and UI reporting are KAMUCL changes.
The former app-desktop Go adaptations have been replaced; the Java license does
not establish authorization for that historical Go source.

Full terms: licenses/LGPL-3.0.txt and licenses/GPL-3.0.txt. Users may modify and
rebuild these portions and recombine them with the application. KAMUCL imposes no
restriction on reverse engineering for debugging such modifications.
Build instructions: docs/CORRESPONDING_SOURCE.md.

## Skin preview — MIT

skinview3d v3.4.2: https://github.com/bs-community/skinview3d/tree/v3.4.2
src/renderer/src/vendor/skinview3d/model.ts is the upstream model with an added
attribution header. Full authors and terms: licenses/skinview3d.txt.
skinview-utils 0.7.1: https://github.com/bs-community/skinview-utils
Provides canvas skin loading and conversion. Terms: licenses/skinview-utils.txt.
The version and integrity are fixed in package-lock.json.
KAMUCL's preview interaction adapter is an original MIT contribution.
The previous HMCL/FCL-derived preview and conversion are no longer used.

## Other bundled libraries

Vue/runtime packages, Three.js, @iarna/toml, adm-zip, koffi and undici:
complete license texts are retained in licenses/ and dependency packages.
Electron/Chromium notices remain alongside the executable in LICENSE and
LICENSES.chromium.html. Compile-only bridge dependencies are not embedded.

## Referenced launcher projects

PCL: https://github.com/Meloong-Git/PCL
HMCL: https://github.com/HMCL-dev/HMCL
Prism: https://github.com/PrismLauncher/PrismLauncher
XMCL: https://github.com/Voxelum/x-minecraft-launcher
Modrinth: https://github.com/modrinth/code
ATLauncher: https://github.com/ATLauncher/ATLauncher
MultiMC: https://github.com/MultiMC/Launcher

Acknowledgement does not grant permission or imply endorsement. Referencing
behavior, formats or UI features does not relicense upstream code. Historical
release issues are recorded in docs/LICENSE_REMEDIATION.md. New replacements
do not retroactively establish permission for older releases.
