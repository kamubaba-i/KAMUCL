/**
 * macOS 打包脚本（Windows 上运行，无需 symlink 权限）：
 * 直接在 zip 层重写 Electron.app → KAMUCL.app，保留所有 unix 权限与符号链接，
 * 注入 app.asar、kamucl.icns，改写 Info.plist。
 *
 * 用法: node scripts/pack-mac.mjs <x64|arm64> <electron-darwin-zip路径>
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import yauzl from 'yauzl'
import yazl from 'yazl'
import licenseChecks from './check-licenses.cjs'
licenseChecks.checkLicenses({ release: true })

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const arch = process.argv[2]
const srcZip = process.argv[3]
if (!arch || !srcZip) {
  console.error('用法: node scripts/pack-mac.mjs <x64|arm64> <electron-darwin-zip>')
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
const version = pkg.version
const RELEASE = path.join(ROOT, 'release')
const STAGING = path.join(RELEASE, '.mac-staging')
// asar 按版本命名：避免旧版本缓存被误用，也避免被占用文件阻塞
const ASAR_OUT = path.join(RELEASE, '.mac-staging', `app-${version}.asar`)
const ICNS_OUT = path.join(RELEASE, '.mac-staging', 'kamucl.icns')
const OUT_ZIP = path.join(RELEASE, `KAMUCL-${version}-mac-${arch}.zip`)

// ---------------- 1. 组装 app 内容并打 asar（两架构共用） ----------------
function ensureAsar() {
  if (fs.existsSync(ASAR_OUT)) return
  console.log('[mac] 组装 app 目录并打 asar…')
  const appDir = path.join(STAGING, 'app')
  fs.rmSync(appDir, { recursive: true, force: true })
  fs.mkdirSync(appDir, { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(appDir, 'package.json'))
  fs.cpSync(path.join(ROOT, 'out'), path.join(appDir, 'out'), { recursive: true })
  fs.mkdirSync(path.join(appDir, 'node_modules'), { recursive: true })
  fs.cpSync(
    path.join(ROOT, 'node_modules', 'adm-zip'),
    path.join(appDir, 'node_modules', 'adm-zip'),
    { recursive: true }
  )
  const asarBin = path.join(ROOT, 'node_modules', 'asar', 'bin', 'asar.js')
  execFileSync(process.execPath, [asarBin, 'pack', appDir, ASAR_OUT], { cwd: ROOT, stdio: 'inherit' })
  fs.rmSync(appDir, { recursive: true, force: true })
}

// ---------------- 2. 用 PNG 手工拼 icns（ic08=256px, ic09=512px） ----------------
function buildIcns() {
  if (fs.existsSync(ICNS_OUT)) return
  console.log('[mac] 生成 kamucl.icns…')
  const p256 = fs.readFileSync(path.join(ROOT, 'build', 'icon.png'))
  const p512 = fs.readFileSync(path.join(ROOT, 'build', 'icon-512.png'))
  const block = (type, data) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(8 + data.length, 4)
    return Buffer.concat([head, data])
  }
  const body = Buffer.concat([block('ic08', p256), block('ic09', p512)])
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + body.length, 4)
  fs.mkdirSync(STAGING, { recursive: true })
  fs.writeFileSync(ICNS_OUT, Buffer.concat([head, body]))
}

// ---------------- 3. zip 层重写 ----------------
function openZip(f) {
  return new Promise((res, rej) =>
    yauzl.open(f, { lazyEntries: true }, (e, z) => (e ? rej(e) : res(z)))
  )
}
function readEntry(z, e) {
  return new Promise((res, rej) => z.openReadStream(e, (err, s) => (err ? rej(err) : res(s))))
}
async function streamToBuffer(s) {
  const chunks = []
  for await (const c of s) chunks.push(c)
  return Buffer.concat(chunks)
}

function patchInfoPlist(text) {
  let t = text
  t = t.replace(/(<key>CFBundleName<\/key>\s*<string>)[^<]*(<\/string>)/, '$1KAMUCL$2')
  t = t.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, '$1KAMUCL$2')
  t = t.replace(/(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]*(<\/string>)/, '$1com.kamucl.launcher$2')
  t = t.replace(/(<key>CFBundleIconFile<\/key>\s*<string>)[^<]*(<\/string>)/, '$1kamucl.icns$2')
  return t
}

async function rewrite() {
  console.log(`[mac] 重写 zip → ${path.basename(OUT_ZIP)}`)
  const zin = await openZip(srcZip)
  const zout = new yazl.ZipFile()
  const outStream = fs.createWriteStream(OUT_ZIP)
  const donePromise = new Promise((res, rej) => {
    outStream.on('close', res)
    outStream.on('error', rej)
    zout.outputStream.pipe(outStream)
  })

  zin.readEntry()
  await new Promise((resolve, reject) => {
    zin.on('entry', async (entry) => {
      try {
        const name = entry.fileName
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
        const isSymlink = (unixMode & 0o170000) === 0o120000
        const base = { mtime: entry.getLastModDate(), mode: unixMode || (name.endsWith('/') ? 0o40755 : 0o100644) }

        if (!name.startsWith('Electron.app/')) {
          // zip 根下无其他内容则跳过非 app 条目（理论上没有）
          zin.readEntry()
          return
        }
        const rest = name.slice('Electron.app/'.length)
        // 丢弃默认 app 与 electron 图标
        if (
          rest === 'Contents/Resources/default_app.asar' ||
          rest === 'Contents/Resources/electron.icns'
        ) {
          zin.readEntry()
          return
        }
        const newName = 'KAMUCL.app/' + rest
        if (name.endsWith('/')) {
          zout.addEmptyDirectory(newName, base)
        } else if (isSymlink) {
          const s = await readEntry(zin, entry)
          const target = await streamToBuffer(s)
          zout.addBuffer(target, newName, base) // symlink: 内容即目标路径，mode 已含 0120000
        } else if (rest === 'Contents/Info.plist') {
          const s = await readEntry(zin, entry)
          const text = patchInfoPlist((await streamToBuffer(s)).toString('utf-8'))
          zout.addBuffer(Buffer.from(text, 'utf-8'), newName, base)
        } else {
          const s = await readEntry(zin, entry)
          zout.addReadStream(s, newName, base)
        }
        zin.readEntry()
      } catch (e) {
        reject(e)
      }
    })
    zin.on('end', resolve)
    zin.on('error', reject)
  })

  // 注入 app.asar 与图标
  zout.addFile(ASAR_OUT, 'KAMUCL.app/Contents/Resources/app.asar', { mode: 0o100644 })
  zout.addFile(ICNS_OUT, 'KAMUCL.app/Contents/Resources/kamucl.icns', { mode: 0o100644 })

  zout.end()
  await donePromise
  console.log(`[mac] 完成: ${OUT_ZIP} (${(fs.statSync(OUT_ZIP).size / 1024 / 1024).toFixed(1)}MB)`)
}

fs.mkdirSync(RELEASE, { recursive: true })
ensureAsar()
buildIcns()
await rewrite()
