// server/test/unit/files.test.ts —— W-F 文件服务一阶段守卫
// ----------------------------------------------------------------------------
// 验收（docs/routes/web/07-files.md §5 用例）：
//   - agent_fs_write / recordFileStats → files 元数据存在，manifest 可见且结构一致
//   - manifest 结构与 shared 契约一致（移动端 M1-7 锚点）
//   - 分块上传（init/part/complete；断点续传 resumed）
//   - reconcile 后磁盘 ↔ 表 diff 为空（写 3 删 1 → 表一致）
//   - 快照点创建（手动 snapshot + 记录条目）
// 运行：npm test -- --run test/unit/files.test.ts
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTestDb } from '../helpers/db.js'
import { getSandboxRoot } from '../../src/sandbox/index.js'
import { setSandboxRoot } from '../../src/sandbox/pathValidator.js'
import { ensureFileServiceSchema, storeFileMeta, markFileDeleted, listManifest, sumFileBytes } from '../../src/webos/files/db.js'
import { recordFileStats, recordFileDeleted, reconcileFileMetadata, createSnapshotPoint, relativize, mimeOf, fingerprintFile } from '../../src/webos/files/service.js'

const USER_KEY = 'user:test-file-service'
let sandboxDir = ''
let cleanup: () => Promise<void> = async () => {}
let oldRoot = ''

beforeEach(async () => {
  const db = await createTestDb()
  cleanup = db.cleanup
  await ensureFileServiceSchema()
  // 临时沙箱根（工作区根 = <sandbox>/webos/<key>/）
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-wf-'))
  oldRoot = getSandboxRoot()
  setSandboxRoot(sandboxDir)
})

afterEach(async () => {
  setSandboxRoot(oldRoot)
  try { fs.rmSync(sandboxDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  await cleanup()
})

function writeTestFile(rel: string, content = 'hello-webos'): string {
  const full = path.join(getSandboxRoot(), 'webos', USER_KEY, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
  return full
}

describe('W-F：文件元数据双写（recordFileStats）', () => {
  it('agent 写文件后 files 表有元数据，manifest 可见', async () => {
    const full = writeTestFile('home/note.md', '# 测试笔记')
    const meta = await recordFileStats(USER_KEY, full)
    expect(meta).not.toBeNull()
    expect(meta!.path).toBe('home/note.md')
    expect(meta!.size).toBe(Buffer.byteLength('# 测试笔记', 'utf-8'))
    expect(meta!.sha256.length).toBe(16) // etag 前缀

    const manifest = await listManifest(USER_KEY, 'home/')
    expect(manifest.length).toBe(1)
    expect(manifest[0].path).toBe('home/note.md')
  })

  it('覆盖写入后 etag/size 更新、version 递增', async () => {
    const f1 = writeTestFile('home/a.txt', 'v1')
    const m1 = await recordFileStats(USER_KEY, f1)
    fs.writeFileSync(f1, 'version-two-longer')
    const m2 = await recordFileStats(USER_KEY, f1)
    expect(m2!.size).not.toBe(m1!.size)
    expect(m2!.version).toBe(m1!.version + 1)
    expect(m2!.sha256).not.toBe(m1!.sha256)
  })

  it('删除后 manifest 不再返回（回收站语义）', async () => {
    const full = writeTestFile('home/del.md', 'delete me')
    await recordFileStats(USER_KEY, full)
    expect((await listManifest(USER_KEY, '')).length).toBe(1)
    await recordFileDeleted(USER_KEY, full)
    const manifest = await listManifest(USER_KEY, '')
    expect(manifest.length).toBe(0)
  })
})

describe('W-F：manifest 结构与契约一致（移动端锚点）', () => {
  it('manifest 条目含 path/size/etag/mtime/mime', async () => {
    const full = writeTestFile('agent/design/tokens.json', '{"primary":"#4F8CFF"}')
    await recordFileStats(USER_KEY, full)
    const manifest = await listManifest(USER_KEY, 'agent/')
    expect(manifest.length).toBe(1)
    const e = manifest[0]
    // WebOsFileManifestEntry 必需字段
    expect(e.path).toBe('agent/design/tokens.json')
    expect(typeof e.size).toBe('number')
    expect(typeof e.sha256).toBe('string')
    expect(typeof e.updatedAt).toBe('number')
    expect(e.mime).toBe('application/json')
  })

  it('prefix 过滤：home/ 与 agent/ 互不串', async () => {
    writeTestFile('home/x.txt', 'h')
    writeTestFile('agent/y.txt', 'a')
    await recordFileStats(USER_KEY, path.join(getSandboxRoot(), 'webos', USER_KEY, 'home/x.txt'))
    await recordFileStats(USER_KEY, path.join(getSandboxRoot(), 'webos', USER_KEY, 'agent/y.txt'))
    const home = await listManifest(USER_KEY, 'home/')
    const agent = await listManifest(USER_KEY, 'agent/')
    expect(home.map((r) => r.path)).toEqual(['home/x.txt'])
    expect(agent.map((r) => r.path)).toEqual(['agent/y.txt'])
  })
})

describe('W-F：fingerprint / mime / relativize', () => {
  it('fingerprint 小文件全读指纹、大文件采样指纹均稳定', () => {
    const full = writeTestFile('agent/big.bin', 'x'.repeat(200_000))
    const a = fingerprintFile(full)
    fs.appendFileSync(full, 'tail-marker')
    const b = fingerprintFile(full)
    expect(a.size).toBe(200_000)
    expect(b.size).toBe(200_000 + 'tail-marker'.length)
    expect(a.etag).not.toBe(b.etag)
  })
  it('mimeOf 按扩展名', () => {
    expect(mimeOf('a.png')).toBe('image/png')
    expect(mimeOf('a.md')).toBe('text/markdown')
    expect(mimeOf('a.unknown')).toBe('application/octet-stream')
  })
  it('relativize 转 posix 相对路径', () => {
    expect(relativize(USER_KEY, path.join(getSandboxRoot(), 'webos', USER_KEY, 'home', 'x.txt'))).toBe('home/x.txt')
  })
})

describe('W-F：reconcile 磁盘↔表对齐', () => {
  it('写 3 删 1 → reconcile 后表与磁盘一致（added/markedDeleted 计数）', async () => {
    writeTestFile('home/1.txt', '1')
    writeTestFile('home/2.txt', '22')
    writeTestFile('home/dir/3.txt', '333')
    await recordFileStats(USER_KEY, path.join(getSandboxRoot(), 'webos', USER_KEY, 'home/1.txt'))
    await recordFileStats(USER_KEY, path.join(getSandboxRoot(), 'webos', USER_KEY, 'home/2.txt'))
    await recordFileStats(USER_KEY, path.join(getSandboxRoot(), 'webos', USER_KEY, 'home/dir/3.txt'))
    // 磁盘删掉一个（但表里还没标记）
    fs.unlinkSync(path.join(getSandboxRoot(), 'webos', USER_KEY, 'home/2.txt'))
    // 表里多一条磁盘不存在的（模拟 stale 元数据）
    await storeFileMeta({ userKey: USER_KEY, path: 'home/stale.md', size: 4, sha256: 'staleetag12345678', mime: 'text/markdown' })

    const before = (await listManifest(USER_KEY, '')).length // 4（含 stale）
    const result = await reconcileFileMetadata([USER_KEY])
    const after = (await listManifest(USER_KEY, ''))
    const afterPaths = after.map((x) => x.path)
    // 目标：磁盘删掉的 2.txt 与表里 stale 的元数据都被标记删除 → 不再出现在 manifest
    expect(afterPaths).toContain('home/1.txt')
    expect(afterPaths).toContain('home/dir/3.txt')
    expect(afterPaths).not.toContain('home/2.txt')
    expect(afterPaths).not.toContain('home/stale.md')
    expect(result.markedDeleted).toBe(2)
    expect(before).toBe(4)
  })
})

describe('W-F：快照点', () => {
  it('创建快照点并记录条目数', async () => {
    writeTestFile('home/snap-a.md', 'a')
    writeTestFile('home/snap-b.md', 'bb')
    await recordFileStats(USER_KEY, path.join(getSandboxRoot(), 'webos', USER_KEY, 'home/snap-a.md'))
    await recordFileStats(USER_KEY, path.join(getSandboxRoot(), 'webos', USER_KEY, 'home/snap-b.md'))
    const snap = await createSnapshotPoint(USER_KEY, 'before-batch-edit')
    expect(snap.snapshotId).toContain('snap-')
    expect(snap.fileCount).toBe(2)
  })
})