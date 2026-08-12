import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: [
      'test/helpers/**',
      'test/**/*-script.ts',
      'test/**/*-test.ts',
      'test/**/*-verify.ts',
      'test/**/*-diag.ts',
      'test/**/*-find-*.ts',
      'test/**/poc-*.ts',
      'test/**/adv-*.ts',
      'test/**/phase-*.ts',
      'test/**/search-*.ts',
      'test/**/s2-*.ts',
    ],
    globals: false,
    environment: 'node',
    pool: 'forks',
    setupFiles: ['test/helpers/env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // 按 spec 行 662 风险缓解"仅核心 AI 模块 70%，其他不强制"，
      // coverage.include 只列核心 AI 模块 + S8 测试目标模块。
      // 非核心模块（llmCaller/sanitize/fileSystemTools/capabilityTools/connection/schema 等）
      // 不纳入 perFile 阈值检查，但 coverage 报告仍生成全貌（reporter=text/html/lcov）。
      include: [
        'src/piBridge.ts',
        'src/ws.ts',
        'src/db/aiContext.ts',
        'src/utils/aiTools.ts',
        'src/utils/searchTools.ts',
        'src/middleware/auth.ts',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/db/migrateFromSqlite.ts',
        'src/db/test-sqlite.ts',
        'src/db/seed.ts',
      ],
      thresholds: {
        // perFile 模式：每个核心模块文件单独达标，避免平均值掩盖
        perFile: true,
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
  },
})
