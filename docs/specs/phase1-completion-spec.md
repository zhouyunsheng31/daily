# Phase 1 完成 Spec (v2)

> 生成日期：2026-06-23
> 目标：完成 roadmap_v3.md Phase 1 的所有遗留项，使 Phase 1 达到验收标准
> 范围：仅修复现有 8 个组件和基础设施，不创建虚构的 17 个组件

---

## 一、现状与问题清单

### 1.1 Widget Schema Registry (1.1)
- **问题 A**：`calculatorDef` 缺少 `getAISummary()` 方法
- **问题 B**：全部 8 个组件缺少 `migrateState()` 实现
- **问题 C**：全部 8 个组件缺少 `lifecycle` 声明
- **非问题**：接口名 `WidgetDefinitionV2A` vs roadmap 的 `WidgetSchema` — 项目扩展了接口（validateState/normalizeStateForSave 等），保持现有接口名不变

### 1.2 Data Source Registry (1.2)
- **问题 D**：`DataSourceDefinition` 接口缺少 `defaultQuery` 字段
- **问题 E**：`aiAuditLog` 未注册为数据源
- **问题 F**：无分页查询支持（roadmap 1.3.1 明确要求"Data Source Registry 的 defaultQuery 支持分页参数 offset/limit"）

### 1.3 核心个人数据模型 (1.3)
- **问题 G**：`AIAuditLog` 接口缺少 `params` 和 `result` 字段（roadmap 明确要求）
- **问题 H**：`AIAuditLog` 类型未导出到 `types/index.ts`（当前 `interface AIAuditLog` 无 `export` 关键字）

### 1.3.1 IndexedDB 基础设施
- **问题 I（严重 bug）**：`aiAuditLog` 不在 `V2_STORE_NAMES` 中，store 从未被创建
- **问题 J**：`V2_INDEX_DEFINITIONS` 中无 `aiAuditLog` 的索引定义（`by_sessionId`, `by_createdAt`）
- **问题 K**：`initV2Storage` 的版本验证中无 `aiAuditLog`
- **问题 L**：`exportImportV2.ts` 的 `ExportBundle` 和 `exportV2Data()` 未包含 8 个新表
- **说明**：`initV2Storage` 中无 `requiredV7Stores`，v7 为历史跳过版本（合并到 v8），非 bug，不修复

### 1.4 WidgetPort — ✅ 已完成，无需修改

### 1.6 组件菜单分组 — 框架已完成，8 个组件可正常分组显示，无需修改

### 1.7 同步文档
- **问题 M**：Workspace.tsx 快捷键提示浮层未包含组件分组说明

---

## 二、实施方案

### 2.1 修复 aiAuditLog store 和索引（问题 I/J/K）

**文件**：`client/desktop/src/utils/dbV2.ts`

1. 在 `V2_STORE_NAMES` 数组中添加 `'aiAuditLog'`（在 `'aiMemories'` 之后）
2. 在 `V2_INDEX_DEFINITIONS` 中添加：
   ```typescript
   aiAuditLog: [
     { name: 'by_sessionId', keyPath: 'data.sessionId', options: { unique: false } },
     { name: 'by_createdAt', keyPath: 'data.createdAt', options: { unique: false } },
   ],
   ```
3. `DB_VERSION` 从 8 递增到 9
4. 在 `initV2Storage` 中添加 `requiredV9Stores = ['aiAuditLog']` 验证

**文件**：`client/desktop/src/utils/idbTx.ts`
- 第 361 行注释更新为："aiAuditLog store restored in Phase 1 completion"

### 2.2 修复 AIAuditLog 数据模型（问题 G/H）

**文件**：`client/desktop/src/utils/dbStores/aiData.ts`

1. 将 `interface AIAuditLog` 改为 `export interface AIAuditLog`，并添加 `params` 和 `result` 字段：
   ```typescript
   export interface AIAuditLog {
     id: string
     sessionId: string
     toolName: string
     actionType: 'create' | 'update' | 'delete' | 'read' | 'suggest'
     targetType?: 'widget' | 'canvas' | 'task' | 'note' | 'calendar' | 'memory'
     status: 'success' | 'failure'
     userConfirmed: boolean
     params?: unknown          // 新增：工具调用参数
     result?: unknown          // 新增：工具调用结果
     createdAt: number
     schemaVersion: 1
   }
   ```

**文件**：`client/desktop/src/types/index.ts`
- 添加 re-export：`export type { AIAuditLog } from '../utils/dbStores/aiData'`

### 2.3 修复 Data Source Registry（问题 D/E/F）

**文件**：`client/desktop/src/types/index.ts`

1. 在 `DataSourceDefinition` 接口中添加 `defaultQuery` 字段：
   ```typescript
   export interface DataSourceDefinition {
     storeName: string
     displayName: string
     category: string
     aiReadable: boolean
     aiWritable: boolean
     schema: Record<string, string>
     defaultQuery?: (options?: { offset?: number; limit?: number }) => Promise<{ items: unknown[]; total: number }>
   }
   ```

**文件**：`client/desktop/src/registry/dataSources.ts`

2. 注册 `aiAuditLog` 数据源

3. 为 8 个核心数据表添加 `defaultQuery` 实现。已验证以下 dbStore 函数存在：
   - `getAllNotes()` (notes.ts:54)
   - `getAllJournals()` (journals.ts:70)
   - `getAllQuickNotes()` (quickNotes.ts:54)
   - `getAllSavingsGoals()` (savings.ts:57)
   - `getAllSavingsTransactions()` — 需确认是否存在，若无则用 `getSavingsTransactionsByGoal` 遍历
   - `getAllAIConversations()` — 需确认，aiData.ts 中有 `getAIConversationsBySession` 但可能无 getAll
   - `getAllAIMemories()` (aiData.ts:149)
   - `getAllAIAuditLogs()` (aiData.ts:346)

   `defaultQuery` 实现模式（以 notes 为例）：
   ```typescript
   import { getAllNotes } from '../utils/dbStores/notes'

   registerDataSource({
     storeName: 'notes',
     // ...其他字段
     defaultQuery: async (options) => {
       const all = await getAllNotes()
       const offset = options?.offset ?? 0
       const limit = options?.limit ?? 50
       return {
         items: all.slice(offset, offset + limit),
         total: all.length,
       }
     },
   })
   ```

   **分页语义**：offset/limit 为基于 skip 的分页（`all.slice(offset, offset + limit)`），total 为全量计数。对于 IndexedDB 数据量（个人数据），此方式性能可接受。

   **依赖方向**：`dataSources.ts` → `dbStores/*` → `db.ts` → `idbTx.ts`，无循环依赖。

   **执行顺序**：必须先完成 2.1（创建 aiAuditLog store）才能注册 aiAuditLog 的 defaultQuery。

### 2.4 补全 Widget Definitions（问题 A/B/C）

**文件**：`client/desktop/src/registry/widgetDefinitions.ts`

**已验证**：`WidgetLifecycle` 接口（v2.ts:192-196）所有字段均为 optional，`lifecycle: {}` 合法。

1. 为 `calculatorDef` 添加 `getAISummary()`：
   ```typescript
   getAISummary(state: CalculatorWidgetState): string {
     if (state.history.length === 0) return '计算器: 无历史记录'
     const last = state.history[state.history.length - 1]
     return `计算器: 最近计算 ${last.expression} = ${last.result}, 共${state.history.length}条记录`
   }
   ```

2. 为全部 8 个组件添加 `migrateState()`。**关键**：先检查 fromVersion 是否等于当前 stateVersion，相同时直接返回原状态（不触发 normalizeState 的副作用）：
   ```typescript
   migrateState(oldState: unknown, fromVersion: number): T {
     if (fromVersion === this.stateVersion) return oldState as T
     // fromVersion < 当前版本时，通过 normalizeState 恢复
     return this.normalizeState(oldState)
   }
   ```

3. 为全部 8 个组件添加 `lifecycle: {}`。Phase 1 只定义接口不强制实现具体钩子。

### 2.5 修复导入导出体系（问题 L）

**文件**：`client/desktop/src/utils/exportImportV2.ts`

**ExportBundle.version 决策**：保持 `version: 3` 不变。新字段设为 optional，旧 bundle（version 3 无新字段）导入时新字段为 undefined，向后兼容。

1. 添加 8 个 store 常量：
   ```typescript
   const NOTES_STORE = 'notes'
   const JOURNALS_STORE = 'journals'
   const QUICK_NOTES_STORE = 'quickNotes'
   const SAVINGS_GOALS_STORE = 'savingsGoals'
   const SAVINGS_TRANSACTIONS_STORE = 'savingsTransactions'
   const AI_CONVERSATIONS_STORE = 'aiConversations'
   const AI_MEMORIES_STORE = 'aiMemories'
   const AI_AUDIT_LOG_STORE = 'aiAuditLog'
   ```

2. 在 `ExportBundle` 接口中添加 8 个 optional 字段

3. 在 `exportV2Data()` 中：
   - 将 8 个新 store 加入 `storeNames` 数组
   - 为每个新 store 添加 `iterateStore` 导出逻辑（与现有表相同模式）

4. 在 `validateBundleFormat()` 中：
   - 将 8 个新字段加入 `optionalArrays` 列表
   - 在 bundle 构造中添加 8 个新字段的 `validateRecords` 调用

5. 在 `importV2Stage()` 中：
   - 为 8 个新表的每条记录分配新 ID 到 `entityIdMap`

6. 在 `importV2Remap()` 中：
   - 8 个新表走**通用导入路径**（无特殊 ID 重映射需求，因为这些表的 panelId/widgetId 关联较弱）
   - 模式：`const newId = entityIdMap[record.id] ?? uuidv4(); const newData = { ...record.data }; records.set(STORE, [...])`

7. 在 commit 函数中添加 8 个新 store 的写入逻辑

### 2.6 更新快捷键提示浮层（问题 M）

**文件**：`client/desktop/src/components/Workspace.tsx`

在快捷键提示浮层（第 1111-1117 行）中添加组件分组说明：
```jsx
<span>组件分组：基础 / 时间与任务 / 生活与健康 / 媒体与阅读 / 学习工具 / AI 助手</span>
```

---

## 三、后端 API 范围说明

`aiData.ts` 使用 `withFallback` 模式：先尝试 API 后端，失败后回退到 IndexedDB。

- **Phase 1 范围**：仅修复 IndexedDB 路径。修复后 IndexedDB 路径完全可用。
- **后端 API**：`entitiesApi.queryEntities({ type: 'aiAuditLog' })` 是否支持取决于后端 entities 表是否已有 aiAuditLog 类型数据。后端使用通用 entities 表，理论上支持任意类型，但 Phase 1 不做后端修改。
- **降级行为**：如果 API 后端不可用，`withFallback` 自动回退到 IndexedDB，功能正常。

---

## 四、验收标准

### 4.1 TypeScript 编译验证
- `npm run build` 或 `tsc --noEmit` 无错误

### 4.2 运行时验证（必须每项通过）

| # | 验证项 | 操作步骤 | 预期结果 |
|---|--------|----------|----------|
| 1 | DB 升级 | 启动应用，打开 DevTools Console | 无报错，DB_VERSION=9 |
| 2 | aiAuditLog store | DevTools → Application → IndexedDB → living-dashboard-v2 | aiAuditLog store 存在，有 by_sessionId 和 by_createdAt 索引 |
| 3 | aiAuditLog 写入 | 在 Console 中执行 `saveAIAuditLog({id:'test',sessionId:'s1',toolName:'test',actionType:'read',status:'success',userConfirmed:false,createdAt:Date.now(),schemaVersion:1})` | 写入成功无报错 |
| 4 | aiAuditLog 读取 | 执行 `getAIAuditLogsBySession('s1')` | 返回包含 test 记录的数组 |
| 5 | AddWidgetMenu | 点击 + 按钮 | 显示 8 个组件，按分组展示 |
| 6 | calculator getAISummary | 添加计算器组件，在 Console 触发 `widgetDefinitionMap.get('calculator')?.getAISummary?.({history:[],schemaVersion:1})` | 返回 '计算器: 无历史记录' |
| 7 | migrateState | 在 Console 执行 `widgetDefinitionMap.get('calculator')?.migrateState?.({history:[],schemaVersion:1}, 1)` | 返回状态对象，history 不被截断 |
| 8 | 导出 | 执行 `exportV2Data()`，下载 JSON，检查内容 | JSON 包含 notes/journals/quickNotes/savingsGoals/savingsTransactions/aiConversations/aiMemories/aiAuditLog 字段 |
| 9 | defaultQuery | 执行 `getDataSource('notes')?.defaultQuery?.({offset:0,limit:10})` | 返回 `{items:[], total:0}` 或实际数据 |
| 10 | 快捷键浮层 | 创建空面板 | 浮层包含组件分组说明 |

### 4.3 代码审查验证
- adversarial-review Skill 审查通过

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| DB_VERSION 升级导致已有数据丢失 | onupgradeneeded 只添加新 store 和索引，不删除已有数据 |
| defaultQuery 引入循环依赖 | dataSources.ts → dbStores/* 单向依赖，无循环 |
| 导入导出 bundle 版本兼容 | 新字段设为 optional，保持 version=3，旧 bundle 导入不受影响 |
| migrateState 裁剪数据 | 先检查 fromVersion === stateVersion，相同时直接返回原状态 |
| 后端 API 不支持 aiAuditLog | withFallback 自动回退到 IndexedDB，功能正常 |
