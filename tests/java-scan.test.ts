import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  expandWindowsEnvironment,
  javaHomeExecutable,
  normalizeJavaArchitecture,
  parseJavaProbeOutput,
  parseRegistryJavaHomes,
  shouldPruneJavaDirectory
} from '../src/main/core/javaScanUtils'
import { gameJavaExecutable } from '../src/main/core/javaScanUtils'

test('Java forwarding path resolves to actual java.home runtime across versions and operating systems', () => {
  assert.equal(javaHomeExecutable('    java.home = C:\\Program Files\\Java\\jdk-25.0.2\n', 'win32'), 'C:\\Program Files\\Java\\jdk-25.0.2\\bin\\java.exe')
  assert.equal(javaHomeExecutable('java.home = D:\\运行环境\\jre8', 'win32'), 'D:\\运行环境\\jre8\\bin\\java.exe')
  assert.equal(javaHomeExecutable('java.home = /opt/jdk-21', 'linux'), '/opt/jdk-21/bin/java')
  assert.equal(javaHomeExecutable('java.home = relative', 'win32'), null)
  assert.equal(javaHomeExecutable('java.version = 25', 'win32'), null)
})

test('Windows game launch prefers javaw when the GUI entry exists', () => {
  const root = fs.mkdtempSync('kamucl-javaw-')
  try {
    const java = path.join(root, 'bin', 'java.exe')
    fs.mkdirSync(path.dirname(java), { recursive: true })
    fs.writeFileSync(path.join(path.dirname(java), 'javaw.exe'), '')
    assert.equal(gameJavaExecutable(java, 'win32'), path.join(root, 'bin', 'javaw.exe'))
    assert.equal(gameJavaExecutable(java, 'linux'), java)
    assert.equal(gameJavaExecutable(path.join(root, 'bin', 'other.exe'), 'win32'), path.join(root, 'bin', 'other.exe'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Windows game launch falls back to java when javaw is unavailable', () => {
  const root = fs.mkdtempSync('kamucl-java-no-javaw-')
  try {
    const java = path.join(root, 'bin', 'java.exe')
    fs.mkdirSync(path.dirname(java), { recursive: true })
    assert.equal(gameJavaExecutable(java, 'win32'), java)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveJavaExecutable double-decodes GBK java.home for JRE in CJK game dir', async () => {
  const java = await import('../src/main/core/java')
  const source = fs.readFileSync('src/main/core/java.ts', 'utf8')
  // JVM ≤17 按平台默认编码输出属性（中文 Windows = GBK）；自动下载的 JRE 落在
  // 含中文的游戏目录时 UTF-8 直读会得到乱码路径，必须 GBK 回退。
  assert.match(source, /encoding: 'buffer'/)
  assert.match(source, /new TextDecoder\('gbk'\)/)
  // 真实冒烟：本机有 Java 时解析出真实可执行文件
  const probe = process.env.KAMUCL_TEST_JAVA ?? 'C:\\Program Files\\Java\\jdk-25.0.2\\bin\\java.exe'
  if (!fs.existsSync(probe)) return
  const resolved = await java.resolveJavaExecutable(probe)
  assert(/\\bin\\java\.exe$/i.test(resolved), resolved)
  assert(fs.existsSync(resolved))
  // 真实中文路径复现（用户报告）：中文目录 junction 下的 JDK 17 必须解析成功
  // 路径基于本机 LOCALAPPDATA 拼接，不硬编码用户名；可用 KAMUCL_TEST_CJK_JAVA 覆盖
  const cjk = process.env.KAMUCL_TEST_CJK_JAVA
    ?? (process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '\\Temp\\opencode\\中文路径\\jdk17\\bin\\java.exe' : '')
  if (fs.existsSync(cjk)) {
    const cjkResolved = await java.resolveJavaExecutable(cjk)
    assert(/\\bin\\java\.exe$/i.test(cjkResolved), cjkResolved)
    assert(fs.existsSync(cjkResolved))
  }
})

test('Java 探测输出解析版本、架构和发行版', () => {
  const modern = parseJavaProbeOutput(`
Property settings:
    java.vendor = Eclipse Adoptium
    java.version = 21.0.5
    os.arch = amd64
openjdk version "21.0.5" 2024-10-15 LTS
`, 'win32')
  assert.deepEqual(modern, {
    major: 21,
    version: '21.0.5',
    is64Bit: true,
    architecture: 'x64',
    vendor: 'Eclipse Adoptium'
  })

  const legacy = parseJavaProbeOutput(
    'java version "1.8.0_431"\nJava HotSpot(TM) Client VM (build 25.431-b10, mixed mode)',
    'win32'
  )
  assert.equal(legacy?.major, 8)
  assert.equal(legacy?.architecture, 'x86')
  assert.equal(legacy?.is64Bit, false)
})

test('Java 架构别名归一化', () => {
  assert.equal(normalizeJavaArchitecture('amd64'), 'x64')
  assert.equal(normalizeJavaArchitecture('x86_64'), 'x64')
  assert.equal(normalizeJavaArchitecture('aarch64'), 'arm64')
  assert.equal(normalizeJavaArchitecture('i386'), 'x86')
})

test('注册表 JavaHome/Path 解析并展开环境变量、忽略无关值', () => {
  const output = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\JavaSoft\\JDK\\17
    JavaHome    REG_SZ    D:\\Java\\jdk-17
    RuntimeLib    REG_SZ    D:\\Java\\jdk-17\\bin\\server\\jvm.dll
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\JDK\\21
    Path    REG_EXPAND_SZ    %ProgramFiles%\\Microsoft\\jdk-21
    Feature    REG_DWORD    0x1
`
  assert.deepEqual(parseRegistryJavaHomes(output, { ProgramFiles: 'C:\\Program Files' }), [
    'D:\\Java\\jdk-17',
    'C:\\Program Files\\Microsoft\\jdk-21'
  ])
  assert.equal(
    expandWindowsEnvironment('%JAVA_ROOT%\\bin', { JAVA_ROOT: 'E:\\Runtimes\\Java' }),
    'E:\\Runtimes\\Java\\bin'
  )
})

test('全盘扫描目录剪枝不会进入系统、依赖和游戏内容目录', () => {
  for (const name of [
    '$Recycle.Bin',
    'System Volume Information',
    'Windows',
    'node_modules',
    '.git',
    'libraries',
    'assets',
    'versions',
    'mods',
    'saves'
  ]) {
    assert.equal(shouldPruneJavaDirectory(name), true, name)
  }
  for (const name of ['jdk-21', 'runtime', 'jre', 'bin', 'Contents']) {
    assert.equal(shouldPruneJavaDirectory(name), false, name)
  }
})
