// scripts/gen-contract-schemas.mjs —— 从 TS 单一事实源生成纯 JSON schema 快照
// 用途：server（rootDir=./src 不能 import shared 的 .ts）通过 import JSON 快照
// 消费同一 schema；移动端 Kotlin DTO 生成也读同一 JSON。运行：
//   node scripts/gen-contract-schemas.mjs
// 说明：shared 的 TS 里 import 'typebox' 需解析到服务端已安装的 typebox——
// 脚本运行时临时在 shared/webos-contracts/packages/node_modules 建一个指向
// server/node_modules/typebox 的 symlink，生成完自动清理（不留下仓库脏文件）。
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, readlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// scripts/ → 仓库根（包含 server/ 与 shared/）
const pkgRoot = join(__dirname, '..', '..')
const serverTypebox = join(pkgRoot, 'server', 'node_modules', 'typebox')
const sharedContractsDir = join(pkgRoot, 'shared', 'webos-contracts')
const sharedPackagesDir = join(sharedContractsDir, 'packages')
const tmpNmDir = join(sharedPackagesDir, 'node_modules')
const tmpNmDir2 = join(sharedContractsDir, 'node_modules')

// 临时 symlink（两处：packages/ 与 shared/webos-contracts/ 根都要指向 typebox）
const tmpLinks = []
try {
  for (const tmpDir of [tmpNmDir, tmpNmDir2]) {
    mkdirSync(tmpDir, { recursive: true })
    const linkPath = join(tmpDir, 'typebox')
    if (existsSync(linkPath)) {
      try {
        if (readlinkSync(linkPath) !== serverTypebox) rmSync(linkPath, { recursive: true, force: true })
      } catch { /* 非符号链接目录等，忽略 */ }
    }
    if (!existsSync(linkPath)) {
      symlinkSync(serverTypebox, linkPath, 'dir')
      tmpLinks.push(linkPath)
    }
  }

  // 动态 import TS 定义（node strip-types）
  const pkgModule = await import(
    pathToFileURL(join(sharedPackagesDir, 'daily-pkg.schema.ts')).href
  )
  const apiModule = await import(
    pathToFileURL(join(sharedPackagesDir, 'api.schema.ts')).href
  )
  const capabilitiesModule = await import(
    pathToFileURL(join(sharedPackagesDir, 'capabilities.ts')).href
  )
  const desktopLayoutModule = await import(
    pathToFileURL(join(sharedPackagesDir, '..', 'desktop-layout.ts')).href
  )

  const pkgJsonSchema = pkgModule.PACKAGE_JSON_SCHEMA
  const apiJsonSchema = apiModule.API_JSON_SCHEMA
  const capabilitiesList = capabilitiesModule.WEBOS_CAPABILITIES
  const desktopLayoutJsonSchema = desktopLayoutModule.DESKTOP_LAYOUT_JSON_SCHEMA

  writeFileSync(join(sharedPackagesDir, 'daily-pkg.schema.json'), JSON.stringify(pkgJsonSchema, null, 2), 'utf-8')
  writeFileSync(join(sharedPackagesDir, 'api.schema.json'), JSON.stringify(apiJsonSchema, null, 2), 'utf-8')
  // 能力词汇表也落 JSON 快照（server 侧同构消费；同时给移动端 Kotlin 词汇表生成用）
  writeFileSync(join(sharedPackagesDir, 'capabilities.json'), JSON.stringify(capabilitiesList, null, 2), 'utf-8')
  // 桌面布局契约同样生成 JSON Schema 快照（R7 移动端 M1-4 也消费）
  writeFileSync(join(sharedPackagesDir, '..', 'desktop-layout.schema.json'), JSON.stringify(desktopLayoutJsonSchema, null, 2), 'utf-8')

  console.log('[gen-contract-schemas] wrote:')
  console.log('  - shared/webos-contracts/packages/daily-pkg.schema.json')
  console.log('  - shared/webos-contracts/packages/api.schema.json')
  console.log('  - shared/webos-contracts/packages/capabilities.json')
  console.log('  - shared/webos-contracts/desktop-layout.schema.json')
  console.log('  package keys:', Object.keys(pkgJsonSchema).join(','))
  console.log('  api keys:', Object.keys(apiJsonSchema).join(','))
  console.log('  capabilities count:', capabilitiesList.length)
} catch (error) {
  console.error('[gen-contract-schemas] FAILED:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  for (const linkPath of tmpLinks) {
    try { rmSync(linkPath, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
  // 若 node_modules 目录空了，一并移除
  for (const tmpDir of [tmpNmDir, tmpNmDir2]) {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}