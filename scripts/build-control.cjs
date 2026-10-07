// Build the bundled control MOD with the checked-in Gradle wrapper, then stage the jar.
// Gradle dependencies resolve through the Fabric/Mojang maven repositories (standard
// Loom toolchain); the wrapper distribution itself is pinned by SHA-256 in
// control/gradle/wrapper/gradle-wrapper.properties.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const control = path.join(root, 'control')
const built = path.join(control, 'build', 'libs', 'kamucl-control-1.21.1-1.0.0.jar')
const output = path.join(control, 'dist', 'kamucl-control-1.21.1.jar')
const gradlew = path.join(control, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
execFileSync(gradlew, ['build', '--console=plain'], { cwd: control, stdio: 'inherit', windowsHide: true })
if (!fs.existsSync(built)) throw new Error(`control MOD 构建产物缺失：${built}`)
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.copyFileSync(built, output)
console.log('Built control MOD: ' + output)
