# Living Dashboard v2 执行规格（经42轮对抗审核）

> 生成时间：2026-06-02
> 审核模型：GPT 5.5（36轮）+ Gemini 3.5 Flash（1轮）+ Grok 4.3（5轮）
> v2核心定位：**让自由画布稳定、好用、数据安全**

## v2.0范围合理性论证

> 以下论证解释为什么v2.0需要这些看似"过度工程化"的合同。

**核心矛盾**：数据安全需要复杂度，但"轻盈"排斥复杂度。v2.0的选择是：**数据安全不可妥协，但复杂度必须可分阶段交付**。

| 合同类别 | 为什么v2.0必须 | 如果推迟的后果 | 实际行数 |
|---|---|---|---|
| IdbTxContext + runIdbTransaction | 所有写操作的基础封装 | 裸IDB API导致事务泄漏、数据不一致 | 300-400 |
| StoreSchemaContract | 数据加载必须校验schema | 损坏数据直接渲染导致白屏 | 200-300 |
| WidgetDefinitionV2A | 16组件必须validate+normalize | 无校验导致损坏state写入DB | 400-600 |
| CAS + pending_delete | 数据安全底线 | 覆盖丢失、误删不可恢复 | 150-200 |
| SaveJob + dirty | 用户未保存数据必须提示 | 编辑丢失无感知 | 200-300 |
| EditorLease | 多标签页互斥 | 两标签同时编辑导致数据覆盖 | 100-150 |
| 导入导出 | 用户数据可迁移 | 浏览器清除=数据永久丢失 | 400-600 |
| 诊断系统 | 损坏数据必须有恢复入口 | 损坏数据只能手动清DB | 150-250 |

**推迟到v2.1+的合同**（v2.0不验收）：
- 完整migration框架（v2.0只做version gate + placeholder）
- 复杂诊断UI（v2.0只做console.error + placeholder）
- WidgetStateLocator缓存优化（v2.0每次重新查询）
- File System Access API Blob持久化
- 完整diff面板（v2.0只做toast提示）

**"轻盈"的正确理解**：轻盈≠简陋。轻盈是"每个复杂度都有存在的必要"。v2.0的复杂度全部来自数据安全需求，没有装饰性复杂度。

## v2.0最小范围声明

> 以下声明明确v2.0的验收边界。超出此范围的合同推迟到v2.1+，不在v2.0验收矩阵中。

**v2.0验收的合同**（不可再减）：

1. runIdbTransaction + IdbTxContext（所有写操作基础，含TxPromise brand运行时检查）
2. StoreSchemaContract（数据加载校验，v2.0只做validateData，不做readCompatValidate）
3. WidgetDefinitionV2A最小版（createDefaultState + validateState + normalizeStateForSave）
4. CAS + pending_delete + 10秒撤销（v2.0冲突只toast提示"数据冲突，请刷新"，不做diff面板）
5. 简单dirty flag（v2.0不做完整SaveJob状态机，只做dirty/clean/saving三态）
6. 单panel导出导入（同步流程，不含staging状态机）
7. WidgetStateEnvelope
8. 16组件State Schema
9. ErrorBoundary + placeholder

**v2.0不验收的合同**（推迟到v2.1+）：

- ~~EditorLease多标签互斥~~ → v2.1（v2.0单标签编辑，多标签只读）
- ~~SaveJob完整状态机~~ → v2.1（v2.0只做dirty/clean/saving三态）
- ~~CAS冲突diff面板~~ → v2.1（v2.0只toast提示刷新）
- ~~ReadCompatResult判定树~~ → v2.1
- ~~WidgetStateLocator缓存~~ → v2.1（v2.0每次重新查询）
- ~~导入staging 7态状态机~~ → v2.1（v2.0简化为同步导入）
- ~~诊断系统（DiagnosticIssueKind/OperationCapability/canExecute）~~ → v2.1
- ~~DisabledMcpComponentManifest~~ → v2.1（v2.0中MCP widget归入unknown widget opaque路径）
- ~~canonical JSON + SHA-256 hash~~ → v2.1
- ~~UUID v5确定性remap~~ → v2.1（v2.0使用crypto.randomUUID）
- ~~programming_error_after_commit恢复表~~ → v2.1（v2.0只console.error）
- ~~跨store操作恢复表~~ → v2.1
- ~~Blob生命周期完整合同~~ → v2.1（v2.0 Blob仅内存+刷新丢失）
- ~~quota模式墓碑死锁兜底~~ → v2.1（v2.0只做基本quota检测）
- ~~getNestedValue安全读取器~~ → v2.1（v2.0 deleteChecked不支持嵌套路径）
- ~~实现复杂度预算~~ → v2.1
- ~~parent guard完整表格~~ → v2.1（v2.0只做基本pending_delete检查）
- ~~EffectiveRuntimeMode + canExecute权限矩阵~~ → v2.1（v2.0只有normal_editable和quota两种模式）
- ~~21个高层操作合同表~~ → v2.1（v2.0只定义5个核心操作：createWidget/deleteWidgetWithUndo/undoDeleteWidget/createTask/deleteTaskWithUndo）

**v2.0导入简化**：

- 不使用staging状态机
- 流程：选择文件 → 校验 → remap id（crypto.randomUUID）→ 单事务写入 → 完成/失败
- 失败则整个事务回滚，用户重试
- 不做preview hash、不做staging recovery、不做committing状态检测
- MCP widget归入unknown widget opaque路径，不单独处理

**v2.0事务模型简化**：

- 方案B（await ctx方法），仅支持Chrome latest stable
- H1-H5验证在v2.0a交付前完成，记录CI日志
- 验证失败则切换方案C（回调式API，接口可能不同）
- 不做跨浏览器验证

---

## 设计原则（20条，完整列出）

1. **自由优先**：所有功能可选，用户可以只放一个时钟
2. **轻盈不变**：不引入后端、路由、认证、云同步、重型库
3. **画布为核**：不做传统App布局，始终是自由画布
4. **积木感**：一个组件=一个积木，不是一个子系统
5. **显式绑定**：联动是用户显式连接，不是广播
6. **按需引入**：不提前建DB表，不提前做架构抽象
7. **生活平衡**：组件类型不能全是生产力工具
8. **数据安全**：备份优先于功能，导入导出必须安全
9. **数据治理**：区分组件私有状态和实体数据
10. **MCP安全**：v2.0不实现MCP执行能力；任何MCP类型组件必须disabled placeholder；权限模型推迟到v3+单独RFC
    - **MCP残留字段清理声明**（v2.0必须）：以下字段仅用于导入兼容和unknown widget修复，不构成MCP执行能力：
      - `DisabledMcpComponentManifest`：导入时遇到MCP类型widget的占位记录，仅记录type和id，不执行任何MCP操作。v3实现MCP时替换为真实manifest
      - `opaqueImportContext`：unknown widget修复所需的remap上下文，与MCP无关。任何widget（包括非MCP类型）导入为unknown时都需要此字段
      - `MCP_LEGACY_WIDGET_ID_NAMESPACE`：UUID v5 namespace常量，仅用于legacy MCP widget id remap。v2.0不使用此常量（因为没有MCP widget），保留仅为v3兼容
      - `normalizeDisabledMcpManifestId`：导入校验辅助函数，确保MCP manifest id格式合法。v2.0仅校验格式不执行操作
    - **v2.0禁止**：创建新的MCP类型widget、执行MCP操作、渲染MCP组件、调用MCP工具
11. **删除widget不删除实体**：Widget是视图入口，实体store是长期数据。实体只有用户显式删除实体时才按实体删除合同处理
12. **聚合不持久化权威值**：聚合结果不作为权威数据持久化。允许可丢弃缓存，但缓存必须可重建且不得作为导出内容
13. **编辑态优先**：编辑时暂停拖拽、提升层级
14. **实体支持迁移**：实体store必须有schemaVersion和migration
15. **MCP权限带作用域**：不只限制能做什么，也限制对哪些panel/widget/type做
16. **模式互斥**：画布同一时刻只能处于一种模式
17. **AI是助手不是主人**
18. **绘画是标注不是作品**
19. **连线是关系表达不是流程图**
20. **学习组件是积木不是系统**

## 不做的事（30条，完整列出）

1. 不引入后端服务器
2. 不引入用户认证
3. 不引入云同步
4. 不引入路由
5. 不引入传统App布局
6. 不做社交功能
7. 不做移动端适配
8. 不引入重型图表库
9. 不删除旧组件
10. 不做通用EventBus
11. 不做完整Repository层
12. 不做完整Calendar
13. 不做独立Kanban
14. 不做MusicPlayer联动
15. 不做DailyReview
16. 不做TodayPanel
17. 不做NoteEditor多文档
18. 不做PDF自动摘录
19. 不允许AI默认删除组件或写入组件state
20. 不提前建未使用的IndexedDB store
21. v2不做DrawingBoard
22. v2不做组件连线
23. v2不做AI助手
24. v2不做学习组件
25. v2不做用户可管理的独立数据表视图；允许为少数组件建立最小实体store（tasks/calendarEvents/focusSessions/habits/habitCheckins/moodEntries）
26. v2不做命令面板复杂命令
27. v2不做全画布绘画层
28. v2不做连线数据流
29. v2不做AI写操作
30. v2不做AI长期记忆

---

## v2五个硬目标

1. **数据安全可验收合同**（替代不可证明的"bug不丢数据"口号）：
   - 所有权威数据的跨store正式提交必须单事务原子（runIdbTransaction保证）
   - staging状态流转、非权威展示增强字段、诊断性清理允许分段执行，但必须满足：
     1. 不产生可见脏数据
     2. 可重试
     3. 可幂等
     4. 失败不覆盖现有数据
     5. 启动恢复规则确定
   - focusSession.taskSnapshot.deletedAt是非权威展示增强字段，允许异步best-effort补写，可能缺失，不能作为任务存在性的判断依据
   - 导入永不覆盖现有记录（只导入为新panel，remap所有id）
   - migration前提示导出备份
   - 删除widget/task/event/moodEntry先pending_delete，10秒撤销窗口后hard delete
   - 删除panel/habit必须二次确认
   - CAS冲突不自动覆盖，进入UI提示
   - quota模式禁止新增和普通编辑
2. **未保存dirty数据必须有状态提示和尽力恢复机制**：dirty标记可见，保存失败可重试，debounce窗口内刷新未保存内容可能丢失，sessionStorage尽力保存文本草稿
3. **所有破坏性操作必须可撤销或显式确认**：删除widget有10秒pending_delete撤销，删除panel需确认，删除实体需确认或toast撤销
4. **导入不得修改现有数据，失败不得留下可见脏数据**：只导入为新panel，失败自动清理staging，启动时清理orphan staging
5. **多标签并发由CAS兜底，不保证强互斥**：EditorLease是best-effort提示，CAS是最终防线

## 技术栈

以当前稳定版为准：React 19 + TypeScript stable + Vite stable + Zustand 5 + Tailwind v4。v2开始后冻结大版本升级，除安全问题外不升级框架主版本。lockfile锁定，minor/patch允许自动升级但需review。transitive dependency跟随lockfile。

v2.0 kickoff时生成技术基线快照并提交lockfile：

```json
{
  "react": "19.x.x",
  "typescript": "5.x.x",
  "vite": "x.x.x",
  "zustand": "5.x.x",
  "tailwindcss": "4.x.x"
}
```

---

## 数据归属模型

```typescript
type DataScope = 'widget' | 'panel' | 'workspace'

type ResourceKind =
  | 'panel'
  | 'widgetRecord'
  | 'widgetState'
  | 'task'
  | 'calendarEvent'
  | 'focusSession'
  | 'habit'
  | 'habitCheckin'
  | 'moodEntry'
```

DataScope只作为高层归属标签。ResourceKind用于SaveJob、删除策略、导出策略的精确路由。

| Store | ResourceKind | 归属 | 随panel删除 | 随widget删除 | 导出 | 导入 | 使用组件 |
|---|---|---|---|---|---|---|---|
| panels | panel | workspace | N/A | 否 | 是 | remap panelId | 所有面板 |
| widgetRecords | widgetRecord | panel | 是 | 是 | 是 | remap widgetId | 所有16组件 |
| widgetState | widgetState | widget | 是(随record) | 是 | 按类型 | 按类型 | 所有16组件 |
| tasks | task | panel | 是 | 否 | 是 | remap entityId | taskList |
| calendarEvents | calendarEvent | panel | 是 | 否 | 是 | remap entityId | agendaList |
| focusSessions | focusSession | workspace | 否 | 否 | 否 | N/A | focusTimer, statsPanel |
| habits | habit | workspace | 否 | 否 | 否 | N/A | habitTracker |
| habitCheckins | habitCheckin | workspace | 否 | 否 | 否 | N/A | habitTracker |
| moodEntries | moodEntry | workspace | 否 | 否 | 否 | N/A | moodTracker |

---

## IndexedDB Schema

```typescript
const DB_NAME = 'living-dashboard'
const DB_VERSION = 2

const STORES = {
  panels: { keyPath: 'id', indexes: [] },
  widgetRecords: { keyPath: 'id', indexes: ['data.panelId', 'data.type', 'data.recordStatus'] },
  widgetStates: { keyPath: 'id', indexes: ['data.widgetId', 'data.panelId'] },
  tasks: { keyPath: 'id', indexes: ['data.panelId', 'data.taskStatus', 'data.recordStatus', 'data.dueAt'] },
  calendarEvents: { keyPath: 'id', indexes: ['data.panelId', 'data.recordStatus', 'data.startAt'] },
  focusSessions: { keyPath: 'id', indexes: ['data.taskId', 'data.startedAt'] },
  habits: { keyPath: 'id', indexes: [] },
  habitCheckins: { keyPath: 'id', indexes: ['data.habitId', 'data.date'] },
  moodEntries: { keyPath: 'id', indexes: ['data.date', 'data.recordStatus'] },
  importStaging: { keyPath: 'id', indexes: ['data.batchId', 'data.status', 'data.expiresAt'] },
}
```

注：purgeLogs移至v2.2 migration创建，v2.0不建此store。每个store都有对应组件使用（见上表"使用组件"列），不违反"不提前建未使用store"原则。

### 最小IndexedDB Migration（v2.0必须）

v2.0不做完整migration框架（v2.1再做），但必须有最小DB升级能力：

- DB version upgrade时在onupgradeneeded中创建新store
- 旧数据只读兼容（通过LoadedWidgetState识别）
- upgrade失败进入只读模式
- migration幂等（重复执行结果一致）
- migration单元测试
- **v2.0 migration必须创建widgetStates的data.panelId索引**：raw panel bundle和deleteCorruptPanel通过该索引扫描widgetStates

**IndexedDB upgrade多标签阻塞协议**（v2.0必须）：

```typescript
db.onversionchange = () => {
  db.close()
  showBlockingModal('数据库需要升级，请刷新页面')
  releaseEditorLease()
}

request.onblocked = () => {
  showModal('数据库升级被其他标签页阻塞，请关闭其他 Living Dashboard 标签页后重试')
}
```

- blocked超时60秒后进入只读模式
- 旧tab收到versionchange后禁止继续写（所有写API检查DB连接状态）
- upgrade前释放EditorLease
- upgrade成功后重新acquire lease
- **upgrade失败与lease关系**：upgrade失败进入只读不acquire lease，blocked超时进入只读不acquire lease，version too new只读不acquire lease，open失败只读不acquire lease

**Migration preflight协议**（v2.0必须）：

```
启动：
1. 尝试indexedDB.databases()探测DB是否存在
2. 如果不存在：open(DB_NAME, DB_VERSION)，执行初始化
3. 如果存在：
   a. open(DB_NAME)读取currentVersion
   b. 若currentVersion === DB_VERSION：正常启动
   c. 若currentVersion < DB_VERSION：
      - 关闭连接
      - 进入upgrade preflight UI
      - 提供导出备份
      - 用户确认后open(DB_NAME, DB_VERSION)
   d. 若currentVersion > DB_VERSION：只读模式，提示版本过新
4. 如果indexedDB.databases()不可用：
   - open(DB_NAME)不带版本号
   - onsuccess后读取db.version
   - 关闭
   - 根据db.version与DB_VERSION比较
   - 如果onupgradeneeded oldVersion=0说明误创建空库，关闭并deleteDatabase，再按新库初始化
   - 如果oldVersion>0，读取后按3c/3d处理
```

**Migration前LegacyJsonDiagnosticBackup合同**（v2.0必须，简化版）：

upgrade preflight执行diagnostic backup，在open(DB_NAME, DB_VERSION)之前完成：

```typescript
interface LegacyJsonDiagnosticBackup {
  kind: 'legacy_json_diagnostic_backup'
  dbVersion: number
  exportedAt: number
  storeNames: string[]
  totalRecordCount: number
  totalSizeEstimate: number
  stringifyErrors: string[]
}
```

- **简化策略**（v2.0必须）：不遍历所有store做raw JSON导出，只做轻量级统计
- 读取每个objectStore的count（使用IDBObjectStore.count()），不读取具体record
- 统计storeNames、totalRecordCount、totalSizeEstimate（按平均每条记录1KB估算）
- 如果count操作失败，记录到stringifyErrors
- **不承诺灾难恢复**：此backup仅用于诊断，不保证数据可恢复
- **50MB raw JSON遍历已取消**：v2.0不做全量raw JSON导出（性能风险过高+实现复杂度不合理）
- 用户需要数据恢复时，使用panel导出功能手动备份
### 实体StoreSchemaContract（v2.0必须）

v2.0必须为每个IndexedDB store定义StoreSchemaContract，即使v2.0不做复杂migration：

```typescript
interface StoreSchemaContract<TPersistedData> {
  storeName: string
  currentSchemaVersion: number
  supportedSchemaVersions: number[]
  validateRecordShell(rawRecord: unknown): rawRecord is PersistedRecord<unknown>
  validateData(rawData: unknown): ValidationResult<TPersistedData>
  readCompatValidateRecord(rawRecord: unknown): ReadCompatResult<TPersistedData>
}
```

- 每个实体至少有`currentSchemaVersion`常量和`supportedSchemaVersions`列表
- 加载时version gate：加载时检查schemaVersion，不在supportedSchemaVersions中则显示placeholder+导出按钮，不渲染组件
- **validateRecordShell**：校验PersistedRecord外壳（id为string、version为正整数、updatedAt为有限数、data为plain object）。所有store共用同一实现，不重复
- **validateData**：校验data字段（TPersistedData），包含schemaVersion和业务字段
- **readCompatValidateRecord**：组合shell校验+data校验+legacy识别，返回ReadCompatResult
- v2.0的readCompatValidateRecord方法可以只做validateData（不做实际字段迁移），但接口必须存在
- v2.0不得自动调用readCompatValidateRecord写回DB。v2.0 readCompatValidateRecord仅用于读兼容校验，不产生持久化副作用
- readCompatValidateRecord负责识别legacy shape：schemaVersion缺失时进入legacy candidate路径
- legacy识别属于StoreSchemaContract职责
- LoadedWidgetState在readCompatValidateRecord之后产生
- v2.1再引入migrateToCurrentWithPlan（含backup+dry-run+verify+rollback+幂等）

**WidgetState统一使用ReadCompatResult**（删除冗余的WidgetStateReadResult，与通用ReadCompatResult合并）：

```typescript
type ReadCompatResult<T> =
  | { ok: true; kind: 'current'; data: T }
  | { ok: true; kind: 'legacy'; raw: unknown; syntheticData: T }
  | { ok: false; reason: 'bad_shell' | 'unsupported_schema' | 'bad_legacy'; raw: unknown }
```

WidgetState加载使用`ReadCompatResult<WidgetStateData>`，其他实体store使用`ReadCompatResult<TPersistedData>`。不再存在独立的WidgetStateReadResult类型。

**StoreSchemaContract校验层级**（v2.0必须，合并legacy pipeline为唯一权威判定树）：

WidgetState加载判定顺序（唯一权威）：

```
1. locateWidgetStateByWidgetId
   - missing → missing_state
   - duplicate_conflict → duplicate_conflict placeholder
2. 校验PersistedRecord外壳
   - 不符合current shell但符合legacy shell → legacy candidate
   - 不符合任何shell → bad_state
3. 校验data.schemaVersion
   - 存在且支持 → current path
   - 存在但不支持 → incompatible_schema
   - 缺失 → legacy candidate
4. legacy candidate调用readCompatValidateRecord
   - 返回legacy → 生成syntheticEnvelope，不写DB，正常渲染
   - 返回current → 继续current path
   - 返回invalid → bad_state
5. current path校验envelope.stateVersion
   - 不支持 → incompatible_state_version
6. 如果importedAsOpaqueUnknown=true → opaque placeholder
7. 调用validateState → 失败 → bad_state
8. 正常渲染
```

各实体store的SchemaContract实例：

| Store | currentSchemaVersion | supportedSchemaVersions |
|---|---|---|
| panels | 1 | [1] |
| widgetRecords | 1 | [1] |
| widgetStates | 1 | [1] |
| tasks | 1 | [1] |
| calendarEvents | 1 | [1] |
| focusSessions | 1 | [1] |
| habits | 1 | [1] |
| habitCheckins | 1 | [1] |
| moodEntries | 1 | [1] |
| importStaging | 1 | [1] |

**StoreSchemaContract具体校验规则**（v2.0必须）：

| Store | 字段 | 类型 | 长度/范围 | nullable | unknown策略 | legacy候选 |
|---|---|---|---|---|---|---|
| panels | name | string | 1-100 | 否 | 拒绝 | 缺失→"未命名" |
| panels | createdAt | number | 0-4102444800000 | 否 | 拒绝 | 缺失→ctx.now() |
| panels | zIndex | number | 0-9999 | 否 | 拒绝 | 缺失→1 |
| panels | width/height | number | 20-10000 | 否 | 拒绝 | 缺失→800/600 |
| panels | offsetX/offsetY | number | -10000-10000 | 否 | 拒绝 | 缺失→0 |
| panels | schemaVersion | number | 正整数 | 否 | 拒绝 | 缺失→legacy候选 |
| widgetRecords | panelId | string(UUID) | - | 否 | 拒绝 | 缺失→bad_state |
| widgetRecords | type | string | 1-64 | 否 | 拒绝 | 缺失→bad_state |
| widgetRecords | x/y | number | -10000-10000 | 否 | 拒绝 | 缺失→0 |
| widgetRecords | width/height | number | 20-10000 | 否 | 拒绝 | 缺失→200 |
| widgetRecords | zIndex | number | 0-9999 | 否 | 拒绝 | 缺失→0 |
| widgetRecords | recordStatus | 'active'/'pending_delete' | - | 否 | 拒绝 | 缺失→'active' |
| widgetRecords | schemaVersion | number | 正整数 | 否 | 拒绝 | 缺失→legacy候选 |
| tasks | panelId | string(UUID) | - | 否 | 拒绝 | 缺失→bad_state |
| tasks | title | string | 1-10000 | 否 | 拒绝 | 缺失→'' |
| tasks | description | string | 0-10000 | 否 | 拒绝 | 缺失→'' |
| tasks | taskStatus | 'todo'/'in_progress'/'done' | - | 否 | 拒绝 | 缺失→'todo' |
| tasks | dueAt | number/null | 0-4102444800000 | 是 | 拒绝 | 缺失→null |
| tasks | recordStatus | 'active'/'pending_delete' | - | 否 | 拒绝 | 缺失→'active' |
| tasks | schemaVersion | number | 正整数 | 否 | 拒绝 | 缺失→legacy候选 |
| calendarEvents | panelId | string(UUID) | - | 否 | 拒绝 | 缺失→bad_state |
| calendarEvents | title | string | 1-10000 | 否 | 拒绝 | 缺失→'' |
| calendarEvents | startAt/endAt | number | 0-4102444800000, endAt>=startAt | 否 | 拒绝 | 缺失→bad_state |
| calendarEvents | description | string | 0-10000 | 否 | 拒绝 | 缺失→'' |
| calendarEvents | recordStatus | 'active'/'pending_delete' | - | 否 | 拒绝 | 缺失→'active' |
| calendarEvents | schemaVersion | number | 正整数 | 否 | 拒绝 | 缺失→legacy候选 |
| focusSessions | taskId | string(UUID) | - | 是 | 拒绝 | 缺失→null |
| focusSessions | taskSnapshot.title | string | 0-10000 | 是 | 拒绝 | 缺失→null |
| focusSessions | startedAt/endedAt | number | 0-4102444800000, endedAt>=startedAt | 否 | 拒绝 | 缺失→bad_state |
| focusSessions | duration | number | >=0 | 否 | 拒绝 | 缺失→endedAt-startedAt |
| focusSessions | schemaVersion | number | 正整数 | 否 | 拒绝 | 缺失→legacy候选 |
| habits | name | string | 1-100 | 否 | 拒绝 | 缺失→'' |
| habits | frequency | 'daily'/'weekly' | - | 否 | 拒绝 | 缺失→'daily' |
| habits | schemaVersion | number | 正整数 | 否 | 拒绝 | 缺失→legacy候选 |
| habitCheckins | habitId | string(UUID) | - | 否 | 拒绝 | 缺失→bad_state |
| habitCheckins | date | string(YYYY-MM-DD) | - | 否 | 拒绝 | 缺失→bad_state |
| habitCheckins | schemaVersion | number | 正整数 | 否 | 拒绝 | 缺失→legacy候选 |
| moodEntries | date | string(YYYY-MM-DD) | - | 否 | 拒绝 | 缺失→bad_state |
| moodEntries | mood | number | 1-5 | 否 | 拒绝 | 缺失→3 |
| moodEntries | note | string | 0-10000 | 否 | 拒绝 | 缺失→'' |
| moodEntries | recordStatus | 'active'/'pending_delete' | - | 否 | 拒绝 | 缺失→'active' |
| moodEntries | schemaVersion | number | 正整数 | 否 | 拒绝 | 缺失→legacy候选 |

- **validateData失败UI**：显示placeholder+导出按钮+删除按钮，不写回DB
- **导入时validateData失败**：该条记录跳过，addWarning，不影响其他记录
- **legacy候选策略**：schemaVersion缺失时进入legacy path，生成syntheticData，不写DB
- **widgetStates的validateData**：由对应WidgetDefinition.validateState负责，不在本表列出

---

## 完整Record类型定义

```typescript
interface PersistedRecord<T> {
  id: string
  version: number
  updatedAt: number
  data: T
}

type RecordStatus = 'active' | 'pending_delete'

interface DeletableEntityData {
  recordStatus: RecordStatus
  deleteToken?: string
  deleteExpiresAt?: number
  deletedAt?: number
}

// 所有extends DeletableEntityData的记录创建时必须写入recordStatus:'active'，不得省略

interface PanelData {
  name: string
  createdAt: number
  zIndex: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  importBatchId?: string
  schemaVersion: number
}

type PanelRecord = PersistedRecord<PanelData>

// importBatchId仅用于审计追溯，绝不用于UI过滤或panel可见性判断
// panel没有recordStatus字段，panel存在即active，删除panel是hard delete
// UI展示所有存在于panels store的panel

interface WidgetRecordData extends DeletableEntityData {
  panelId: string
  type: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  schemaVersion: number
}

type WidgetRecord = PersistedRecord<WidgetRecordData>

interface WidgetStateData<T = unknown> {
  widgetId: string
  panelId: string
  envelope: WidgetStateEnvelope<T>
  legacyRaw?: unknown
  legacyWrappedAt?: number
  legacyRawDroppedAt?: number
  importedAsOpaqueUnknown?: boolean
  opaqueImportContext?: {
    oldWidgetId: string
    newWidgetId: string
    oldPanelId: string
    newPanelId: string
    widgetIdMap: Record<string, string>
    panelIdMap: Record<string, string>
    entityIdMap: Record<string, string>
  }
  schemaVersion: number
}

type WidgetStateRecord<T = unknown> = PersistedRecord<WidgetStateData<T>>

// WidgetStateRecord.id MUST equal WidgetStateData.widgetId
// 创建widget时record/state一一对应（同一id），删除widget时直接delete widgetStates by id，导入remap简单

interface TaskData extends DeletableEntityData {
  panelId: string
  title: string
  description: string
  taskStatus: 'todo' | 'in_progress' | 'done'
  dueAt: number | null
  createdAt: number
  schemaVersion: number
}

type TaskRecord = PersistedRecord<TaskData>

interface CalendarEventData extends DeletableEntityData {
  panelId: string
  title: string
  startAt: number
  endAt: number
  description: string
  schemaVersion: number
}

type CalendarEventRecord = PersistedRecord<CalendarEventData>

interface FocusSessionData {
  taskId?: string
  taskSnapshot?: {
    title: string
    deletedAt?: number
  }
  startedAt: number
  endedAt: number
  duration: number
  schemaVersion: number
}

type FocusSessionRecord = PersistedRecord<FocusSessionData>

// 旧数据无taskSnapshot时：如果taskId存在则从tasks store补读title，但不立即写DB；补读失败不影响渲染（显示"未知任务"）；用户编辑focusTimer时才CAS写入taskSnapshot；task处于pending_delete时title仍可读取（recordStatus过滤不适用于跨store补读）；如果taskId不存在或task已hard delete，显示"已删除任务"
// taskSnapshot.deletedAt可能由异步best-effort补写，可能缺失，不能作为任务存在性的判断依据
// **补读title时UI标注"实时读取"**：补读的title在UI上标注"实时读取"提示，用户编辑后固化快照（taskSnapshot写入DB），标注消失

**focusSession创建时task状态处理表**（v2.0必须）：

| 创建时task状态 | taskSnapshot.title |
|---|---|
| active task存在 | task.title |
| pending_delete task存在 | task.title |
| task不存在 | 不写taskId，title不写 |
| task bad_record | title='未知任务' |
| 读取失败 | 创建无任务focusSession |

interface HabitData {
  name: string
  frequency: 'daily' | 'weekly'
  createdAt: number
  schemaVersion: number
}

type HabitRecord = PersistedRecord<HabitData>

interface HabitCheckinData {
  habitId: string
  date: string
  checkedAt: number
  schemaVersion: number
}

type HabitCheckinRecord = PersistedRecord<HabitCheckinData>

interface MoodEntryData extends DeletableEntityData {
  date: string
  mood: number
  note: string
  schemaVersion: number
}

type MoodEntryRecord = PersistedRecord<MoodEntryData>

interface RealImportStagingData {
  kind: 'import_staging'
  schemaVersion: 1
  batchId: string
  status: 'created' | 'validated' | 'remapped' | 'previewed' | 'committing' | 'committed' | 'recovery_error'
  createdAt: number
  expiresAt: number
  manifest: ExportManifest
  payload: ValidatedImportPayload
  remapContext?: {
    panelIdMap: Record<string, string>
    widgetIdMap: Record<string, string>
    taskIdMap: Record<string, string>
    calendarEventIdMap: Record<string, string>
    entityIdMap: Record<string, string>
  }
  targetPanelId?: string
  targetWidgetIds: string[]
  targetTaskIds: string[]
  targetCalendarEventIds: string[]
  previewDigest?: ImportPreviewDigest
  previewManifest?: ImportPreviewManifest
  committedAt?: number
  commitAttempt?: number
  recoveryErrorReason?: ImportRecoveryDerivedState
}

- `remapContext`：remapped后必填。`entityIdMap`是taskIdMap和calendarEventIdMap的合并（key=原始id, value=remap后id），workspace entity不进入entityIdMap
- `previewDigest`：previewed后必填
- `previewManifest`：previewed后必填
- `target*Ids`：remapped后必填
- `recoveryErrorReason`：recovery_error后必填

interface QuotaProbeData {
  kind: 'quota_probe'
  createdAt: number
  schemaVersion: 1
}

type ImportStagingData =
  | RealImportStagingData
  | QuotaProbeData

type ImportStagingRecord = PersistedRecord<ImportStagingData>

// targetWidgetIds/targetTaskIds/targetCalendarEventIds在remapped/previewed阶段是planned ids（计划写入的id），不是已创建ids
// remapContext是remap映射的权威来源：第一次remap生成后必须写入staging，后续remap/preview/commit/recovery全部使用该持久化map，不允许重新随机生成
// target*Ids只是remapContext的派生结果，不是remap权威来源
// 所有staging扫描逻辑：if (record.data.kind !== 'import_staging') continue

interface ExportBundleV1 {
  kind: 'living_dashboard_panel_export'
  exportVersion: 1
  exportedAt: number
  appVersion: string
  manifest: ExportManifest
  panel: PanelRecord
  widgets: WidgetRecord[]
  widgetStates: WidgetStateRecord[]
  tasks: TaskRecord[]
  calendarEvents: CalendarEventRecord[]
  blobAssets: BlobAssetManifest[]
  disabledMcpComponents: DisabledMcpComponentManifest[]
  truncated: boolean
  oversizedWidgetIds: string[]
}

interface ValidatedImportPayload {
  panel: PanelRecord
  widgets: WidgetRecord[]
  widgetStates: WidgetStateRecord[]
  tasks: TaskRecord[]
  calendarEvents: CalendarEventRecord[]
  blobAssets: BlobAssetManifest[]
  disabledMcpComponents: DisabledMcpComponentManifest[]
}
```

---

## Blob策略（v2.0定稿）

v2.0不持久化Blob到IndexedDB。Blob只存在于内存，刷新后丢失。

```typescript
interface LocalBlobPlaceholderState {
  fileName?: string
  mimeType?: string
  size?: number
  needsReselect: boolean
}
```

- 用户选择文件后，Blob在内存中可用，widget正常显示
- 刷新页面后，Blob丢失，widget显示placeholder"请重新选择文件"+文件名提示
- 导出只写BlobAssetManifest（文件名+类型+大小）
- 导入后提示需重新选择本地文件
- 验收矩阵中pdfViewer/musicPlayer的"刷新恢复"改为"恢复placeholder（文件需重选）"

### Blob生命周期独立合同（RuntimeBlobRegistry）

```typescript
interface RuntimeBlobRegistry {
  get(widgetId: string): Blob | undefined
  set(widgetId: string, blob: Blob, meta: BlobAssetManifest): void
  delete(widgetId: string): void
  clearByPanel(panelWidgetIds: string[]): void
}
```

- Blob存储在Zustand内存store，key=widgetId
- **v2.0b可选持久化路径**：File System Access API（`window.showSavePicker`/`window.showOpenFilePicker`），用户显式授权后持久化文件句柄（`FileSystemFileHandle`），刷新后可重新读取。此路径为可选增强，v2.0a不实现
- pending_delete期间Blob保留（撤销需要）
- undo delete后Blob恢复（因为内存中未删除）
- hard delete后从RuntimeBlobRegistry删除
- panel删除后clearByPanel
- import后无Blob，只保留placeholder meta
- quota模式hard delete清Blob

**Blob生命周期完整合同**（v2.0必须）：

| 场景 | Blob行为 | 说明 |
|---|---|---|
| 用户选择文件 | set(widgetId, blob, meta) | 正常设置 |
| 刷新页面 | Blob丢失 | 内存only，widget显示placeholder |
| widget pending_delete | Blob保留 | 撤销需要 |
| undo delete widget | Blob恢复（内存中未删除） | 无需重新选择 |
| hard delete widget | delete(widgetId) | 清除Blob |
| panel删除 | clearByPanel(widgetIds) | 批量清除 |
| import | 无Blob | 只保留placeholder meta |
| quota hard delete | delete(widgetId) | 清除Blob |
| widgetId repair后 | delete(oldWidgetId), set(newWidgetId, blob, meta) | key迁移 |
| import opaque recover | Blob不变（如果存在） | recover不涉及Blob |
| duplicate widget state删除全部 | delete所有candidates的widgetId | 清除所有Blob |
| panel bad_record删除 | clearByPanel(widgetIds) | 与正常删除一致 |
| quota hard delete panel | clearByPanel(widgetIds) | 与正常删除一致 |
| widgetRecord missing但Blob存在 | Blob残留（内存中） | 不主动清理，刷新后自动丢失 |
| Blob key与当前widgetId不一致 | 不影响（key=widgetId，repair后迁移） | repair时同步迁移 |

---

## 数据一致性与持久化合同

### PersistedRecord

```typescript
interface PersistedRecord<T> {
  id: string
  version: number
  updatedAt: number
  data: T
}
```

- `version`：CAS版本号，每次成功写入+1
- `updatedAt`：由写入层生成（Date.now()），不信任客户端传入
- 写入时compare-and-swap

**Date.now()回拨声明**：时间仅作本地弱语义。lease heartbeat使用Date.now容忍回拨。deleteExpiresAt如果检测到now明显小于createdAt，采用保守策略（延长等待）。v2.0不做monotonic clock。

### ID生成规则

- 新建record使用`crypto.randomUUID()`
- `crypto.randomUUID()`不可用时降级为RFC4122 v4 fallback（`crypto.getRandomValues`实现）
- 如果连`crypto.getRandomValues`也没有则进入只读模式
- 所有新数据record id必须UUID格式
- **导入remap使用UUID v5保证确定性幂等**：`uuidV5(batchId + ':' + 原始id, REMAP_NAMESPACE)`，同一batch内同一原始id永远生成相同新id，不同batch生成不同id。REMAP_NAMESPACE = `'f7d3a1e2-b4c5-5d7e-8f9a-0b1c2d3e4f5a'`（合法UUID v5，version nibble为5）。**namespace UUID不受isUuid(v4/v5)业务校验限制**——namespace是UUID v5算法的固定参数，不需要通过业务校验
- **UUID v5 ID在所有内部路径必须被接受**（v2.0必须）：
  - 所有内部schema校验（StoreSchemaContract.validateData、WidgetDefinition.validateState、importStaging校验）对id字段使用宽松校验：`typeof id === 'string' && id.length > 0`
  - **禁止内部路径使用UUID v4-only校验**：不使用zod `.uuid()`（默认只校验v4），不使用第三方UUID validator限制版本
  - 如果需要校验id格式，使用自定义`isValidId(id: string): boolean`，接受v4和v5
  - 下游诊断工具、未来v3 schema验证层也必须遵循此规则
  - 导出文件中的id字段同样遵循宽松校验
- remapContext一旦成功写入staging，后续preview/commit/recovery必须复用该remapContext
- 如果remap事务失败且remapContext未写入，允许下次重新生成UUID v5（结果相同，幂等）
- **legacy id兼容**：旧数据非UUID id允许继续存在，不做跨实体自动ID重写
- **UUID v5 namespace**：DisabledMcpComponentManifest.id生成稳定hash UUID时使用UUID v5，namespace定义：
  ```typescript
  const MCP_LEGACY_WIDGET_ID_NAMESPACE = 'a1b2c3d4-e5f6-5a7b-8c9d-0e1f2a3b4c5d'
  ```
  使用RFC 4122 UUID v5算法，输入字符串UTF-8编码，输出必须符合v5 variant/version bits。
- **WidgetStateRecord.id与data.widgetId不一致**：仅此局部问题允许lazy repair。**普通panel导出必须输出修正后的id=data.widgetId**。**诊断raw导出必须同时包含primaryKey和record.id/data.widgetId原值**。lazy repair事务步骤：
  - repairWidgetStatePrimaryKey(oldId, newId)：
    - 单store readwrite事务
    - get oldId
    - 校验record.data.widgetId === newId
    - get newId必须不存在
    - addNew newId
    - deleteChecked oldId
    - 成功后使用newId作为正式state id
    - 任一步失败则进入诊断，不覆盖
  - **repair失败后UI策略（方案A严格模式）**：
    - repair失败后禁止普通保存
    - 显示诊断placeholder"组件主键不一致，需修复"
    - 只允许：导出raw、删除组件、再次尝试repair
    - **WidgetStateRecord.id MUST equal data.widgetId**作为强合同
    - legacy不一致时必须repair成功后才能继续正常使用
- DisabledMcpComponentManifest的id校验与record id校验一致（非UUID时用widgetId替代，见MCP章节）

### WidgetStateLocator统一定位（v2.0必须）

所有需要访问widgetState的路径（渲染/保存/导出/删除/repair/diagnostic）必须通过统一定位函数，禁止直接按id或data.widgetId单独查询：

```typescript
type LocatedWidgetState =
  | { kind: 'found'; primaryKey: string; record: WidgetStateRecord; matchedBy: 'id' | 'data.widgetId'; needsRepair: boolean }
  | { kind: 'duplicate_conflict'; widgetId: string; candidates: Array<{ primaryKey: string; record: WidgetStateRecord }> }
  | { kind: 'missing' }

/** @idb-tx-helper */
async function locateWidgetStateByWidgetId(
  ctx: IdbTxContext,
  widgetId: string
): TxPromise<LocatedWidgetState> {
  const byPrimaryKey = await ctx.get('widgetStates', widgetId)
  const byDataWidgetId = await ctx.indexGetAll('widgetStates', 'data.widgetId', widgetId)
  const candidates = dedupeByPrimaryKey([
    ...(byPrimaryKey ? [{ primaryKey: widgetId, record: byPrimaryKey }] : []),
    ...byDataWidgetId.map(r => ({ primaryKey: r.id, record: r })),
  ])
  if (candidates.length === 0) return { kind: 'missing' }
  if (candidates.length > 1) return { kind: 'duplicate_conflict', widgetId, candidates }
  const only = candidates[0]
  return {
    kind: 'found',
    primaryKey: only.primaryKey,
    record: only.record,
    matchedBy: only.primaryKey === widgetId ? 'id' : 'data.widgetId',
    needsRepair: only.primaryKey !== widgetId,
  }
}
```

- **始终同时查询primaryKey和data.widgetId两个索引**，合并去重后判定结果
- 仅1条候选且primaryKey===widgetId：`kind='found'`, `matchedBy='id'`, `needsRepair=false`
- 仅1条候选且primaryKey!==widgetId：`kind='found'`, `matchedBy='data.widgetId'`, `needsRepair=true`（主键不一致，需lazy repair）
- 多条候选：`kind='duplicate_conflict'`, `widgetId=widgetId`, `candidates`包含所有去重后记录
- 无候选：`kind='missing'`（对应WidgetRenderStatus的missing_state）
- **duplicate_conflict处理**：
  - 不渲染真实组件
  - 显示诊断placeholder"组件数据冲突"+导出全部候选按钮+删除全部按钮
  - 禁止普通保存
  - 删除widget时必须删除全部候选（确认后）
- 删除widget时：先`locateWidgetStateByWidgetId`获取结果，`found`时按`primaryKey`删除，`duplicate_conflict`时删除全部`candidates`的`primaryKey`（而非假设id===widgetId）
- 渲染/保存/导出/repair/diagnostic全部使用此函数，不绕过

**WidgetStateLocator渲染缓存策略**（v2.0必须）：

- 面板加载时一次readonly transaction批量加载全部widgetStates
- locateWidgetStateByWidgetId在此transaction内逐个调用
- 结果缓存到内存map（key=widgetId）
- 缓存失效：SaveJob成功后更新、pending_delete后移除、panel切换后清空
- SaveJob/export使用缓存定位primaryKey，但重新读取最新version
- **缓存primaryKey在写路径not_found时必须重新定位**：SaveJob使用缓存primaryKey执行putCas，如果返回not_found，必须重新调用locateWidgetStateByWidgetId(ctx, widgetId)定位。found new primaryKey→重试一次CAS；duplicate_conflict→进入诊断；missing→cancelled/stale
- **SaveJob使用缓存primaryKey的强校验**（v2.0必须）：SaveJob读取缓存primaryKey对应的widgetState后，必须校验：
  1. `record.id === primaryKey`
  2. `record.data.widgetId === widgetId`
  3. `record.data.panelId === expectedPanelId`
  4. `record.data.schemaVersion` supported
  任一不满足则立即重新调用locateWidgetStateByWidgetId(ctx, widgetId)定位。putCas前必须再次校验data.widgetId，不允许仅凭primaryKey写入
- **导出禁止只使用缓存primaryKey**（v2.0必须）：导出时必须在readonly transaction内重新调用locateWidgetStateByWidgetId(ctx, widgetId)获取最新primaryKey。缓存可能过期（其他tab repair了primaryKey、其他tab删除并重建了widgetState）。导出使用locator返回的primaryKey，不使用缓存
- **任何写操作成功后必须使缓存失效或更新**：
  - addNew widgetState后写入缓存
  - putCas widgetState后更新缓存
  - deleteChecked widgetState后移除缓存
  - repairWidgetStatePrimaryKey后以newId为key更新缓存
- **多标签缓存一致性**（v2.0必须）：
  - 缓存是per-tab内存map，不跨标签共享
  - 当本tab检测到其他tab持有lease时进入只读模式，此时清空全部widgetState缓存
  - 只读模式下不使用缓存（每次读取走readonly transaction）
  - 重新拿到lease后重新批量加载缓存
  - storage事件（`window.addEventListener('storage', ...)`）不用于缓存失效——IndexedDB变更不触发storage事件
  - v2.0不实现跨标签实时缓存同步，只依赖lease互斥保证：写tab独占缓存，只读tab不缓存

### updatedAt排序语义

- tasks按`data.dueAt`排序
- calendarEvents按`data.startAt`排序
- widgets按`data.zIndex`排序
- panel列表按`PersistedRecord.updatedAt`排序（导入后的panel是新panel，排序按导入时间。原导出时间在manifest里查看）

### CAS协议

所有CAS操作统一通过`ctx.putCas`在`runIdbTransaction`内执行。**不再存在独立的`putWithCas`函数**。CAS失败统一throw `IdbTransactionError`，调用方通过`toStorageWriteOutcome`适配器转换为`StorageWriteOutcome`。

- CAS必须在同一个IndexedDB readwrite事务内完成
- version成功写入时+1
- updatedAt由写入层生成（ctx.now()）
- CAS冲突不得自动覆盖
- 冲突状态进入UI（toast："数据冲突，请刷新"）
- **CAS冲突恢复路径**（v2.0必须）：
  1. SaveJob进入conflicted状态
  2. UI显示非阻塞toast："数据已被其他标签页修改，点击查看差异"
  3. 用户点击toast→显示diff面板（当前内存snapshot vs DB最新record）
  4. 用户选择：覆盖（以内存snapshot为准，重新CAS写入）或放弃（以DB为准，丢弃内存snapshot）
  5. 覆盖：创建新SaveJob，baseVersion=DB.version，latestQueuedSnapshot=当前内存snapshot
  6. 放弃：SaveJob进入cancelled，ResourceSaveState回到clean，UI刷新为DB数据
  7. 如果用户不操作：toast 30秒后消失，SaveJob保持conflicted，下次编辑时再次提示
- stale job丢弃

**toStorageWriteOutcome适配器**（v2.0必须）：

```typescript
function toStorageWriteOutcome(error: unknown): StorageWriteOutcome {
  if (error instanceof IdbTransactionError) {
    switch (error.kind) {
      case 'version_conflict': return { ok: false, kind: 'version_conflict', current: error.current }
      case 'quota_exceeded': return { ok: false, kind: 'quota_exceeded' }
      case 'constraint': return { ok: false, kind: 'constraint' }
      case 'not_found': return { ok: false, kind: 'not_found' }
      case 'condition_mismatch': return { ok: false, kind: 'condition_mismatch' }
      case 'accessor_rejected': return { ok: false, kind: 'condition_mismatch' }
      case 'key_path_invalid': return { ok: false, kind: 'condition_mismatch' }
      case 'transaction_failed_before_commit': return { ok: false, kind: 'retryable_abort' }
      case 'programming_error_after_commit': return { ok: false, kind: 'programming_error_after_commit' }
      case 'unknown': return { ok: false, kind: 'retryable_abort' }
    }
  }
  return { ok: false, kind: 'retryable_abort' }
}
```

- SaveJob、import、cleanup、diagnostic全部使用`toStorageWriteOutcome(e)`转换错误
- **禁止任何代码直接catch IdbTransactionError后做业务分支**，必须通过toStorageWriteOutcome归一化
- 业务层只看StorageWriteOutcome，不直接依赖IdbTransactionError.kind
- `ok: true`由runIdbTransaction成功resolve表示，不需要适配

### 事务内CAS API

在`runIdbTransaction`内使用IdbTxContext，禁止直接暴露IDBTransaction给业务层：

```typescript
interface IdbTxContext {
  now(): number
  get<T>(storeName: string, id: string): TxPromise<PersistedRecord<T> | undefined>
  addNew<T>(storeName: string, input: { id: string; data: T }): TxPromise<PersistedRecord<T>>
  putCas<T>(storeName: string, input: { id: string; expectedVersion: number; data: T }): TxPromise<PersistedRecord<T>>
  deleteChecked(storeName: string, input: {
    id: string
    expectedVersion?: number
    expectedFields?: Record<string, unknown>
    fieldPredicates?: Record<string, { op: 'lte'; value: number }>
  }): TxPromise<void>
  indexGetAll<T>(storeName: string, indexName: string, query: IDBKeyRange | IDBValidKey): TxPromise<PersistedRecord<T>[]>
  iterateIndex<T>(storeName: string, indexName: string, query: IDBKeyRange | IDBValidKey | null, visitor: (record: PersistedRecord<T>, cursor: { stop(): void }) => void): TxPromise<void>
  iterateStore<T>(storeName: string, visitor: (record: PersistedRecord<T>, cursor: { stop(): void }) => void): TxPromise<void>
  countIndex(storeName: string, indexName: string, query: IDBKeyRange | IDBValidKey): TxPromise<number>
}

**indexGetAll大数据策略**（v2.0必须）：

- 导出：iterateIndex逐条游标读取+累计预算（不一次性getAll，避免内存峰值）
- cleanup：iterateStore游标扫描（逐条处理，不一次性加载全部）
- deletePanel：indexGetAll一次性getAll（数据安全优先于性能，需确保完整收集所有待删记录）
- 最大读取不设硬限制，但导出有20MB预算早停
- countIndex用于计数查询（如quota模式下扫描staging数量）

- addNew：version=1, updatedAt=ctx.now()，由ctx内部生成
- putCas：version+1, updatedAt=ctx.now()，由ctx内部生成
- deleteChecked：先get再校验expectedFields再delete。expectedFields为内置条件对象（如`{ 'data.recordStatus': 'pending_delete', 'data.deleteToken': token }`），不允许自定义predicate函数。校验逻辑：对get到的record，按expectedFields的key路径（支持点分隔符访问嵌套字段）取值，与期望值严格相等。**expectedFields精确定义**：PersistedRecord本身必须是plain object；data如果是Object.create(null)接受；key path不允许空段；允许访问id/version/updatedAt；expectedFields不允许undefined作为期望值（缺失字段视为不匹配）；使用safeOwnDataProp读取；中间路径不是plain object视为不匹配；不支持数组下标；不触发getter

**deleteChecked路径安全读取器getNestedValue**（v2.0必须）：

```typescript
function getNestedValue(obj: unknown, path: string): { found: boolean; value: unknown } {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return { found: false, value: undefined };
    }
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
      return { found: false, value: undefined };
    }
    const desc = Object.getOwnPropertyDescriptor(current, part);
    if (!desc) {
      return { found: false, value: undefined };
    }
    if (desc.get) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}
```

- 零崩溃风险：null/undefined/基础类型中间路径返回`{ found: false }`
- 防原型链污染：`__proto__`/`constructor`/`prototype`返回`{ found: false }`
- 防getter：检测到accessor返回`{ found: false }`（不抛错，视为不匹配）
- 只读ownProperty：`Object.getOwnPropertyDescriptor`只检查自有属性
- **deleteChecked使用getNestedValue**：expectedFields和fieldPredicates的路径解析必须通过此函数
- **fieldPredicates的value也通过getNestedValue读取**：`{ 'data.deleteExpiresAt': { op: 'lte', value: now } }`中`data.deleteExpiresAt`通过getNestedValue读取

**DeleteCheckedError改为throw**（v2.0必须）：

```typescript
class DeleteCheckedError extends Error {
  kind: 'not_found' | 'version_mismatch' | 'field_mismatch' | 'accessor_rejected' | 'key_path_invalid'
}
```

- deleteChecked校验失败必须throw DeleteCheckedError
- runIdbTransaction捕获DeleteCheckedError后abort事务
- undo等单资源操作在事务外通过错误分类显示提示
- 跨store操作不得用返回值继续执行
- 删除DeleteCheckedError作为返回类型的定义
- 业务层不再直接传完整PersistedRecord

type TxPromise<T> = Promise<T> & { __txBrand: true }

- **ctx.now()统一事务时间**：runIdbTransaction开始时取一次Date.now()，ctx.now()返回该固定值。addNew/putCas内部使用ctx.now()而非Date.now()。同一事务内所有record的updatedAt使用同一时间戳。

async function runIdbTransaction<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  fn: (ctx: IdbTxContext) => Promise<T>
): Promise<T>
```

### 统一IDB错误分类

所有写路径（runIdbTransaction、ctx.addNew/putCas/deleteChecked、import commit、staging update、cleanup write）统一通过classifyToIdbTransactionError进入对应处理模式（quota模式/save_failed/conflicted/retry/readonly）：

```typescript
type IdbOperationContext =
  | 'create'
  | 'cas_update'
  | 'delete'
  | 'import_commit'
  | 'staging_update'
  | 'quota_probe'

function classifyToIdbTransactionError(error: unknown, context: IdbOperationContext): IdbTransactionError
```

- classifyToIdbTransactionError处理DOMException和内部错误，统一返回IdbTransactionError实例
- 调用方通过toStorageWriteOutcome(idbError)获取StorageWriteOutcome做业务分支
- **禁止业务层直接依赖IdbTransactionError.kind做分支**，必须通过toStorageWriteOutcome归一化
- **runIdbTransaction内的QuotaExceededError也必须通过classifyToIdbTransactionError触发全局quota模式**
- **classifyToIdbTransactionError处理DOMException和内部错误**：DOMException不误判为version_conflict

**StorageWriteOutcome统一错误归一化层**（v2.0必须）：

```typescript
type StorageWriteOutcome =
  | { ok: true }
  | { ok: false; kind: 'quota_exceeded' }
  | { ok: false; kind: 'version_conflict'; current?: PersistedRecord<unknown> }
  | { ok: false; kind: 'condition_mismatch' }
  | { ok: false; kind: 'not_found' }
  | { ok: false; kind: 'constraint' }
  | { ok: false; kind: 'retryable_abort' }
  | { ok: false; kind: 'readonly_required' }
  | { ok: false; kind: 'programming_error_after_commit' }
```

- SaveJob、import、cleanup、diagnostic全部引用StorageWriteOutcome
- IdbTransactionError到StorageWriteOutcome的映射由toStorageWriteOutcome适配器统一执行（见CAS协议章节）
- SaveJobFailureReason废弃，SaveJob使用StorageWriteOutcome
- `not_found`：目标记录不存在 → 进入save_failed
- `version_conflict`：CAS版本不匹配或内部VersionConflictError → 进入conflicted
- `transaction_abort`：事务被abort（非上述原因）→ 进入retry
- `unknown`：无法分类 → 进入readonly
- **runIdbTransaction内的QuotaExceededError也必须通过classifyToIdbTransactionError触发全局quota模式**
- **classifyToIdbTransactionError处理DOMException和内部错误**：DOMException不误判为version_conflict

**VersionConflictError内部业务错误类型**：

```typescript
class VersionConflictError extends Error {
  current?: PersistedRecord<unknown>
}
```

- putCas的expectedVersion不匹配时抛出VersionConflictError
- classifyToIdbTransactionError识别VersionConflictError实例，返回IdbTransactionError(kind='version_conflict')
- DOMException（IDB原生错误）不误判为version_conflict

**IdbTxContext实现约束**：

- ctx.addNew必须用IDBObjectStore.add（不用put），id已存在时事务abort
- ctx.putCas必须用IDBObjectStore.put，先get校验expectedVersion再写入
- ctx.deleteChecked必须先get再校验expectedFields再delete（不允许自定义predicate）
- 所有IDBRequest在onsuccess/onerror中resolve/reject
- 事务闭包内只允许直接await ctx.get/ctx.addNew/ctx.putCas/ctx.deleteChecked/ctx.indexGetAll/ctx.iterateIndex/ctx.iterateStore/ctx.countIndex
- **fn内禁止**：
  - 调用任何async helper
  - Promise.all
  - then/catch/finally
  - setTimeout/requestAnimationFrame/fetch
  - React setState
- **ESLint以AST检查事务闭包函数体**，CI强制
- **ESLint规则级规范**：
  - 规则包名：eslint-plugin-idb-tx-safety
  - 触发范围识别runIdbTransaction调用
  - 事务闭包内合法await表达式仅限：await ctx.get/addNew/putCas/deleteChecked/indexGetAll/iterateIndex/iterateStore/countIndex，以及await 标注了@idb-tx-helper的函数调用
  - 其他AwaitExpression一律报错
  - 事务闭包内禁止CallExpression调用返回Promise的函数，除ctx方法和@idb-tx-helper标注函数外
  - 未标注@idb-tx-helper的外部async函数禁止在事务闭包内调用
  - @idb-tx-helper标注：允许标注为`@idb-tx-helper`的async helper函数在事务闭包内调用
  - @idb-tx-helper约束：参数必须包含同一个ctx；内部只能await ctx白名单方法（get/addNew/putCas/deleteChecked/indexGetAll/iterateIndex/iterateStore/countIndex）；不得调用其他未标注async helper；不得捕获外部Promise；必须被静态分析
  - locateWidgetStateByWidgetId标注为@idb-tx-helper，deletePanel等事务内可直接调用
  - 其他需要的事务helper也可标注@idb-tx-helper
  - **事务活跃性实现约束**（v2.0必须）：
    - 每个ctx方法（get/addNew/putCas/deleteChecked/indexGetAll/iterateIndex/iterateStore/countIndex）内部必须在同一microtask内同步enqueue IDBRequest
    - Promise resolve必须发生在IDBRequest success/error callback内（不使用setTimeout/setImmediate等延迟调度）
    - 事务闭包fn内await ctx方法后，下一个ctx方法的request必须在当前request的success callback链内被enqueue
    - 禁止await ctx方法后执行复杂同步逻辑（超过10行或包含循环/递归），避免阻塞microtask队列
    - tx.oncomplete早于fn resolve的检测：在tx.oncomplete handler中设置flag，fn resolve后检查flag，如果已set则throw programming_error_after_commit
    - **v2.0b必须测试事务内连续await稳定性**：Chrome latest stable下连续10次await ctx.get/putCas不触发事务自动commit
    - **事务安全性不依赖ESLint**：事务闭包合法性主要由ESLint+CI+受控代码审查保证。运行时guard（TxPromise brand check + TransactionState flag）仅用于检测部分违规并进入诊断失败路径，不构成完整安全边界
  - 泛型ctx alias禁止：不允许`const c = ctx`后再await c.xxx
  - 解构ctx禁止：不允许`const { get, putCas } = ctx`后再await
  - 事务闭包内同步helper白名单标注@idb-tx-safe
- **ESLint规则可执行定义**：
  - 使用@typescript-eslint/parser
  - rule运行时必须启用type information（requireTypeInfo: true）
  - CI中必须传入parserOptions.project
  - 对于无法可靠判断返回Promise的情况，保守处理（报错）
- 若需要复用逻辑，只能复用纯同步函数，用于构造record或校验已加载数据
- **TxPromise brand定位为lint hint，不是安全机制**：不声称branded TxPromise类型系统能区分事务内Promise和外部Promise
- runIdbTransaction最终Promise必须等待fn完成+tx.oncomplete两者都成功才resolve
- fn失败必须立即tx.abort()
- **事务abort cause传递**：runIdbTransaction必须保存业务错误abortCause。fn抛出VersionConflictError时：保存abortCause→tx.abort()→onabort时优先reject abortCause
- tx abort/error必须优先reject
- **禁止直接暴露IDBTransaction给业务层**
- **禁止在事务内调用异步validator**（validateState必须在事务前完成）
- **fn resolve后但tx未complete时，runIdbTransaction的Promise仍pending**
- **tx.oncomplete早于fn resolve时，视为事务闭包违反约束，进入transaction_failed/programming_error**

**事务错误模型**（v2.0必须）：

```typescript
class IdbTransactionError extends Error {
  kind:
    | 'transaction_failed_before_commit'
    | 'programming_error_after_commit'
    | 'version_conflict'
    | 'quota_exceeded'
    | 'constraint'
    | 'not_found'
    | 'condition_mismatch'
    | 'accessor_rejected'
    | 'key_path_invalid'
    | 'unknown'
  current?: PersistedRecord<unknown>
  cause?: unknown
}
```

- `transaction_failed_before_commit`：事务在fn resolve前失败/abort，可重试
- `programming_error_after_commit`：fn resolve后tx.oncomplete已触发但fn尚未返回，数据已写入，不可重试，只能console.error+上报
- **programming_error_after_commit精确语义与检测逻辑**（v2.0必须）：
  - **检测方式**：使用确定性控制流标志，不在oncomplete和fn resolve之间制造竞争
  - ```typescript
    async function runIdbTransaction<T>(
      storeNames: string[],
      mode: IDBTransactionMode,
      fn: (ctx: IdbTxContext) => Promise<T>
    ): Promise<T> {
      const db = await getDbInstance();
      const tx = db.transaction(storeNames, mode);
      let fnResolved = false;
      let txAborted = false;
      let errorCaptured: unknown = null;
      const fixedTime = Date.now();
      const ctx = createIdbTxContext(tx, { now: () => fixedTime });
      return new Promise<T>((resolve, reject) => {
        tx.oncomplete = () => {
          if (!fnResolved) {
            reject(new IdbTransactionError('programming_error_after_commit'));
          }
        };
        tx.onabort = () => {
          txAborted = true;
          reject(errorCaptured || tx.error || new IdbTransactionError('transaction_failed_before_commit'));
        };
        tx.onerror = () => {
          reject(tx.error || new IdbTransactionError('unknown'));
        };
        fn(ctx).then((result) => {
          fnResolved = true;
          tx.oncomplete = () => { resolve(result); };
        }).catch((err) => {
          errorCaptured = err;
          if (!txAborted) { tx.abort(); }
          reject(err);
        });
      });
    }
    ```
  - **触发条件**：tx.oncomplete触发时fnResolved仍为false——说明fn内部await了外部非transaction-aware的Promise，导致事件循环空闲，事务自动提交
  - **数据状态**：已写入DB，不可回滚
  - **禁止重试**：数据已写入，重试会导致重复写入
  - **禁止忽略**：说明事务闭包违反了约束，必须记录并进入恢复流程
  - **正常路径**：fn正常resolve后，fnResolved=true，tx.oncomplete触发时resolve(result)
  - **与`transaction_failed_before_commit`的区别**：后者事务未提交，数据未写入，可重试
- `version_conflict`：CAS version不匹配
- `quota_exceeded`：写入超限
- `constraint`：addNew时id已存在
- `not_found`：putCas/deleteChecked时记录不存在
- `condition_mismatch`：deleteChecked的expectedFields或fieldPredicates校验不匹配（DeleteCheckedError.field_mismatch/version_mismatch映射到此）
- `accessor_rejected`：deleteChecked的字段读取遇到getter/accessor descriptor（DeleteCheckedError.accessor_rejected映射到此）
- `key_path_invalid`：deleteChecked的key path不合法（DeleteCheckedError.key_path_invalid映射到此）
- `unknown`：未分类错误
- `cause`：保留原始错误（如DeleteCheckedError），调用方可通过cause获取细分信息，但不得依赖cause穿透做业务分支

runIdbTransaction失败统一throw IdbTransactionError，调用方通过toStorageWriteOutcome归一化后做业务分支。classifyToIdbTransactionError处理DOMException，IdbTransactionError处理内部错误。
- runIdbTransaction如果检测到tx.oncomplete早于fn resolve，返回`programming_error_after_commit`
- 所有调用方不得把`programming_error_after_commit`当作普通失败路径重试
- **programming_error_after_commit恢复策略**：
  - 只适用于单资源SaveJob
  - 立即按resourceKind/entityId重新读取DB
  - 如果当前内存snapshot与DB canonical snapshot一致：ResourceSaveState=clean，更新baseVersion
  - 如果不一致：ResourceSaveState=dirty，baseVersion=DB.version，latestQueuedSnapshot=当前内存snapshot，创建新SaveJob
  - 显示非阻塞诊断warning，不显示普通保存失败
- **跨store操作（createWidget/deletePanel/importPanelAsNew）的programming_error_after_commit处理**：
  - 重新读取关键资源判断事务是否实际提交
  - 按各操作的具体恢复策略处理
  - 不套用SaveJob的clean/dirty分支

**跨store操作完整恢复表**（v2.0必须，11个操作全部补全）：

### 1. createWidget recovery

| widgetRecord | widgetState | 判定 | UI动作 | 允许重试 |
|---|---|---|---|---|
| exists | exists | committed | 渲染组件 | 否 |
| missing | missing | not_committed | 显示创建失败，可重试 | 是 |
| exists | missing | inconsistent | 诊断issue=create_widget_partial_commit | 否 |
| missing | exists | orphan_state | 诊断issue=orphan_widget_state | 否 |

### 2. hardDeleteWidget recovery

| widgetRecord | widgetState | 判定 | UI动作 |
|---|---|---|---|
| missing | missing | committed | 刷新列表 |
| exists | exists | not_committed | 可重试 |
| missing | exists | partial | 诊断issue=orphan_widget_state |

### 3. deleteWidgetWithUndo recovery

| widgetRecord | 判定 | UI动作 |
|---|---|---|
| recordStatus=pending_delete | committed | 显示撤销toast |
| recordStatus=active | not_committed | 可重试 |
| missing | inconsistent | 诊断issue=widget_record_missing |

### 4. undoDeleteWidget recovery

| widgetRecord | 判定 | UI动作 |
|---|---|---|
| recordStatus=active | committed | 正常渲染 |
| recordStatus=pending_delete | not_committed | 可重试 |
| missing | inconsistent | 诊断issue=widget_record_missing |

### 5. deletePanel recovery

| panel | 判定 | UI动作 |
|---|---|---|
| missing | committed | 刷新列表 |
| exists | not_committed | 可重试 |

### 6. deleteCorruptPanel recovery

| panel | 判定 | UI动作 |
|---|---|---|
| missing | committed | 刷新列表 |
| exists | not_committed | 重新读取panel是否存在 |

### 7. importPanelAsNew recovery

按importStaging恢复规则处理（targetPanelId判断）

### 8. quotaHardDeletePanel recovery

| panel | 判定 | UI动作 |
|---|---|---|
| missing | committed | 刷新列表+probe退出quota |
| exists | not_committed | 可重试 |

### 9. compressLegacyRaw recovery

| widgetState | 判定 | UI动作 |
|---|---|---|
| legacyRawDroppedAt存在 | committed | 正常渲染 |
| legacyRaw仍存在 | not_committed | 可重试 |
| missing | inconsistent | 诊断issue=widget_state_missing |

### 10. repairWidgetStatePrimaryKey recovery

| widgetState(oldId) | widgetState(newId) | 判定 | UI动作 |
|---|---|---|---|
| missing | exists | committed | 更新缓存 |
| exists | missing | not_committed | 可重试 |
| exists | exists | duplicate | 诊断issue=duplicate_widget_state |
| missing | missing | inconsistent | 诊断issue=widget_state_missing |

### 11. recoverOpaqueUnknownWidget recovery

| widgetState(importedAsOpaqueUnknown) | 判定 | UI动作 |
|---|---|---|
| importedAsOpaqueUnknown=false/undefined | committed | 正常渲染 |
| importedAsOpaqueUnknown=true | not_committed | 可重试 |
| missing | inconsistent | 诊断issue=widget_state_missing |

### cleanupPendingDelete recovery

单资源事务，programming_error_after_commit时重新读取record判断是否已删除

**runIdbTransaction内部状态机TxInternalPhase**（v2.0必须）：

```typescript
type TxInternalPhase =
  | 'fn_running'
  | 'fn_resolved_waiting_complete'
  | 'fn_rejected_aborting'
  | 'tx_completed_before_fn_resolved'
  | 'done'
```

- `fn_running`：事务闭包fn正在执行
- `fn_resolved_waiting_complete`：fn已resolve，等待tx.oncomplete
- `fn_rejected_aborting`：fn抛错，正在abort事务
- `tx_completed_before_fn_resolved`：tx.oncomplete触发但fn尚未resolve（programming_error_after_commit）
- `done`：终态，fn和tx都完成

**runIdbTransaction实现约束**：

- **采用方案B：允许await ctx方法**（ctx方法返回TxPromise，作为lint hint标识合法await目标）
- **tx.active是内部TransactionState自定义flag，不是浏览器属性**：每个ctx方法执行前检查此flag，不active则throw TransactionInactiveError
- **静态保障依赖ESLint AST规则**：eslint rule以AST检查事务闭包函数体，禁止await非ctx方法调用，CI强制
- **运行时只能捕获部分违规**：ctx方法执行前检查TransactionState flag，但无法捕获所有违规await
- **TypeScript类型系统无法完全阻止违规await，只能靠ESLint+runtime guard+CI测试**
- **所有validator必须在transaction前执行**：类型分层——validateState输入是unknown不是TxPromise，事务闭包内禁止调用validateState
- 所有IDBRequest必须包装为transaction-aware promise
- runIdbTransaction负责监听tx.oncomplete/onerror/onabort
- fn抛错时必须tx.abort()
- 事务active期间禁止：网络请求、setTimeout、React状态更新、任意非IDB异步操作
- **fn内部禁止await非ctx方法**（只有ctx.get/ctx.addNew/ctx.putCas/ctx.deleteChecked/ctx.indexGetAll/ctx.iterateIndex/ctx.iterateStore/ctx.countIndex是合法await）
- **eslint rule：以AST检查事务闭包函数体，禁止await非ctx方法调用**
- **文档明确：事务内所有validator必须提前执行**

**浏览器事务活跃性验证矩阵**（v2.0b必须）：

方案B（await ctx方法）的安全性依赖以下浏览器行为假设。v2.0b必须在Chrome latest stable下验证每个假设：

| # | 假设 | 验证方法 | 失败后果 |
|---|---|---|---|
| H1 | IDBRequest.onsuccess回调在event loop task中执行，await后下一个ctx方法的IDBRequest在同一事务内被enqueue | 在onsuccess中验证后续IDBRequest是否在同一事务内成功创建 | 事务模型不可行，需切换方案C |
| H2 | await ctx.get()后，下一个ctx.putCas()的IDBRequest在当前request的success callback链内被enqueue | 连续10次await ctx方法，验证事务不自动commit | 事务可能中途commit，数据不一致 |
| H3 | 事务在所有pending request完成后才尝试commit | 在多个pending request场景下验证 | 部分写入可能丢失 |
| H4 | fn内无await时（纯同步ctx调用链），事务正常完成 | 验证同步链式request的事务完整性 | 同步路径需特殊处理 |
| H5 | fn抛错后tx.abort()在下一个event loop task前生效 | 在fn throw后验证事务是否回滚 | 错误恢复不可靠 |

**验证测试代码模板**（v2.0b必须实现）：

```typescript
async function verifyTransactionLiveness(): Promise<{
  passed: boolean
  results: Array<{ hypothesis: string; passed: boolean; detail: string }>
}> {
  const results = []
  
  // H2: 连续await不触发自动commit
  const db = await openDb()
  const results_h2 = []
  await runIdbTransaction(['testStore'], 'readwrite', async (ctx) => {
    for (let i = 0; i < 10; i++) {
      await ctx.addNew('testStore', { id: `test_${i}`, data: { value: i } })
      results_h2.push(i)
    }
  })
  results.push({
    hypothesis: 'H2: 连续10次await ctx方法不触发事务自动commit',
    passed: results_h2.length === 10,
    detail: `成功执行${results_h2.length}/10次操作`
  })
  
  // H5: fn抛错后事务回滚
  let h5Passed = false
  try {
    await runIdbTransaction(['testStore'], 'readwrite', async (ctx) => {
      await ctx.addNew('testStore', { id: 'should_rollback', data: { value: 999 } })
      throw new Error('intentional')
    })
  } catch {
    const record = await runIdbTransaction(['testStore'], 'readonly', async (ctx) => {
      return ctx.get('testStore', 'should_rollback')
    })
    h5Passed = record === undefined
  }
  results.push({
    hypothesis: 'H5: fn抛错后事务回滚',
    passed: h5Passed,
    detail: h5Passed ? '记录未写入' : '记录仍存在，回滚失败'
  })
  
  return { passed: results.every(r => r.passed), results }
}
```

**方案C（fallback：显式request callback queue）**：

如果H1或H2验证失败，切换到方案C。方案C使用显式request.onsuccess回调链式enqueue下一个request，不依赖await/microtask/Promise。

- 方案C的IdbTxContext接口与方案B**可能不同**：事务闭包改为回调式API而非async/await
- 方案C的具体接口设计在验证失败后根据实际浏览器行为确定
- **不承诺方案C与方案B接口相同**
- 方案C必须通过相同的测试矩阵（事务完整性、回滚、并发安全）

**v2.0b验收要求**：
1. H1-H5全部验证通过→使用方案B
2. 任一H验证失败→切换方案C，方案C必须通过相同的测试矩阵
3. 方案C接口设计在验证失败后确定，不提前承诺
4. 验证结果记录到CI日志，每次Chrome major版本升级重新验证
5. **v2.0仅以Chrome latest stable作为事务模型支持目标**，Safari/Firefox未验收

**事务安全测试覆盖**（v2.0b必须）：

- 事务内连续await：`await ctx.get(); await ctx.putCas();` 必须在E2E测试中验证
- 事务abort：fn抛错时事务必须abort，所有写入回滚
- 事务超时：长时间未完成的事务由浏览器自动abort，runIdbTransaction必须正确reject
- **事务闭包内禁止调用外部async的测试覆盖**：验证事务内await非ctx方法时抛错或被eslint拦截
- **tx.oncomplete早于fn resolve的测试覆盖**：验证此情况进入transaction_failed/programming_error

高层操作封装（业务层不直接拼多个putWithCas）：

```typescript
async function createWidget(panelId: string, type: string, config: WidgetConfig): Promise<WidgetRecord>
async function deleteWidgetWithUndo(widgetId: string): Promise<void>
async function hardDeleteWidget(widgetId: string): Promise<void>
async function undoDeleteWidget(widgetId: string): Promise<void>
async function deletePanel(panelId: string): Promise<void>
async function deleteCorruptPanel(panelId: string): Promise<void>
async function importPanelAsNew(stagingBatchId: string): Promise<PanelRecord>
async function quotaHardDeletePanel(panelId: string): Promise<void>
async function compressLegacyRaw(widgetId: string): Promise<void>
async function repairWidgetStatePrimaryKey(oldId: string, newId: string): Promise<void>
async function recoverOpaqueUnknownWidget(widgetId: string): Promise<void>
```

每个高层操作内部使用runIdbTransaction保证原子性。部分成功时回滚整个事务。

**EffectiveRuntimeMode组合**（v2.0必须）：

```typescript
type EffectiveRuntimeMode =
  | 'normal_editable'
  | 'readonly_lease_lost'
  | 'quota'
  | 'bad_panel_readonly'

function getEffectiveRuntimeMode(context: {
  hasLease: boolean
  isQuotaMode: boolean
  panelLoadStatus: PanelLoadStatus
}): EffectiveRuntimeMode {
  if (context.isQuotaMode) return 'quota'
  if (context.panelLoadStatus === 'bad_record' || context.panelLoadStatus === 'incompatible_schema') return 'bad_panel_readonly'
  if (!context.hasLease) return 'readonly_lease_lost'
  return 'normal_editable'
}
```

**模式组合优先级**（v2.0必须，从高到低）：

1. quota（最高优先级，任何模式下quota触发都覆盖）
2. bad_panel_readonly（panel损坏时强制只读）
3. readonly_lease_lost（无lease时只读）
4. normal_editable（默认）

**权限裁决函数**（v2.0必须）：

```typescript
type OperationCapability =
  | { kind: 'normal_write'; operation: string }
  | { kind: 'import_commit'; operation: string }
  | { kind: 'delete_panel'; operation: string }
  | { kind: 'quota_write'; operation: 'hard_delete_panel' | 'delete_focus_sessions' | 'delete_habit' }
  | { kind: 'diagnostic_write'; operation: DiagnosticCapability }
  | { kind: 'readonly_export'; operation: 'export_raw_widget_state' | 'export_all_widget_state_candidates' | 'export_raw_panel_bundle' | 'export_raw_widget_record' | 'export_widget_record' | 'export_import_staging_diagnostics' }

type CapabilityDecision = 'allowed' | 'denied_mode' | 'denied_capability'

function canExecute(
  mode: EffectiveRuntimeMode,
  capability: OperationCapability,
  context?: { panelId?: string }
): CapabilityDecision
```

**统一权限矩阵**（v2.0必须，替代WriteCapability矩阵和DiagnosticCapability矩阵）：

| OperationCapability | normal_editable | readonly_lease_lost | quota | bad_panel_readonly | 需要lease | 需要确认 | 需要备份 |
|---|---|---|---|---|---|---|---|
| normal_write | ✅ | ❌ | ❌ | ❌ | 是 | 否 | 否 |
| import_commit | ✅ | ❌ | ❌ | ❌ | 是 | 是(preview) | 否 |
| delete_panel | ✅ | ❌ | ❌ | ❌ | 是 | 是 | 否 |
| quota_write.hard_delete_panel | ❌ | ❌ | ✅ | ❌ | 是 | 是+建议导出 | 否 |
| quota_write.delete_focus_sessions | ❌ | ❌ | ✅ | ❌ | 是 | 是+preview | 否 |
| quota_write.delete_habit | ❌ | ❌ | ✅ | ❌ | 是 | 是 | 否 |
| diagnostic_write.delete_corrupt_panel | ✅ | ❌ | ✅ | ✅ | 是 | 是 | 是 |
| diagnostic_write.compress_legacy_raw | ✅ | ❌ | ✅ | ❌ | 是 | 否 | 是 |
| diagnostic_write.delete_orphan | ✅ | ❌ | ✅ | ✅ | 是 | 是 | 是 |
| diagnostic_write.delete_import_staging | ✅ | ❌ | ✅ | ❌ | 是 | 是 | 否 |
| diagnostic_write.delete_duplicate_widget_states | ✅ | ❌ | ❌ | ❌ | 是 | 是 | 是 |
| diagnostic_write.repair_widget_state_primary_key | ✅ | ❌ | ❌ | ❌ | 是 | 是 | 是 |
| diagnostic_write.recover_opaque_unknown_widget | ✅ | ❌ | ❌ | ❌ | 是 | 是 | 是 |
| diagnostic_write.delete_widget_record | ✅ | ❌ | ✅ | ❌ | 是 | 是 | 是 |
| readonly_export.* | ✅ | ✅ | ✅ | ✅ | 否 | 否 | 否 |

- **WriteCapability和DiagnosticCapability类型保留作为OperationCapability的子类型引用，但权限裁决统一通过canExecute函数**
- `denied_mode`：当前运行模式不允许此操作
- `denied_capability`：当前模式不支持此能力
- 所有写操作入口必须先调用canExecute检查，不通过则拒绝并显示对应提示

**完整高层操作合同表**（v2.0必须，21个操作）：

| # | 操作 | storeNames | 需要lease | readonly允许 | quota允许 | 确认 | 备份 | recovery表 | StorageWriteOutcome映射 | pending_delete语义 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | createPanel | panels | 是 | 否 | 否 | 否 | 否 | panel exists→committed; missing→not_committed | retryable_abort→重试; constraint→id冲突 | N/A |
| 2 | savePanel | panels | 是 | 否 | 否 | 否 | 否 | not_found→cancelled; version_conflict→conflicted | version_conflict→conflicted; not_found→cancelled | N/A（panel无recordStatus） |
| 3 | createWidget | widgetRecords, widgetStates | 是 | 否 | 否 | 否 | 否 | 见跨store恢复表1 | retryable_abort→重试; constraint→id冲突 | N/A |
| 4 | deleteWidgetWithUndo | widgetRecords | 是 | 否 | 否 | 否 | 否 | 见跨store恢复表3 | version_conflict→重试; not_found→cancelled | 设置pending_delete+deleteToken+deleteExpiresAt |
| 5 | undoDeleteWidget | widgetRecords | 是 | 否 | 否 | 否 | 否 | 见跨store恢复表4 | version_conflict→冲突提示; not_found→cancelled | 恢复recordStatus=active |
| 6 | hardDeleteWidget | widgetRecords, widgetStates | 是 | 否 | quota允许 | 否 | 否 | 见跨store恢复表2 | retryable_abort→重试 | 删除record+state+Blob |
| 7 | deletePanel | panels, widgetRecords, widgetStates, tasks, calendarEvents | 是 | 否 | 否(走quota_hard_delete_panel) | 是+建议导出 | 否 | 见跨store恢复表5 | retryable_abort→重试 | panel下所有active/pending_delete全部hard delete |
| 8 | deleteCorruptPanel | panels, widgetRecords, widgetStates, tasks, calendarEvents | 是 | 否 | 是 | 是 | 是 | 见跨store恢复表6 | retryable_abort→重试 | N/A |
| 9 | importPanelAsNew | panels, widgetRecords, widgetStates, tasks, calendarEvents, importStaging | 是 | 否 | 否 | 是(preview确认) | 否 | 按importStaging恢复规则 | 见staging commit quota失败处理 | N/A |
| 10 | quotaHardDeletePanel | panels, widgetRecords, widgetStates, tasks, calendarEvents | 是 | 否 | 是 | 是+建议导出 | 否 | 见跨store恢复表8 | retryable_abort→重试 | 直接hard delete |
| 11 | compressLegacyRaw | widgetStates | 是 | 否 | 是 | 否 | 是 | 见跨store恢复表9 | version_conflict→重试; quota_exceeded→保持quota | pending_delete widget禁止压缩 |
| 12 | repairWidgetStatePrimaryKey | widgetStates | 是 | 否 | 否 | 否 | 是 | 见跨store恢复表10 | constraint→newId已存在; not_found→oldId不存在 | N/A |
| 13 | recoverOpaqueUnknownWidget | widgetStates | 是 | 否 | 否 | 否 | 是 | 见跨store恢复表11 | version_conflict→重试 | N/A |
| 14 | createTask | tasks | 是 | 否 | 否 | 否 | 否 | not_found→cancelled(不应发生) | constraint→id冲突 | N/A |
| 15 | deleteTaskWithUndo | tasks | 是 | 否 | 否 | 否 | 否 | not_found→cancelled | version_conflict→重试 | 设置pending_delete+deleteToken+deleteExpiresAt |
| 16 | undoDeleteTask | tasks | 是 | 否 | 否 | 否 | 否 | not_found→cancelled | version_conflict→冲突提示 | 恢复recordStatus=active |
| 17 | hardDeleteTask | tasks | 是 | 否 | quota允许 | 否 | 否 | not_found→已完成 | retryable_abort→重试 | 删除task+异步补写focusSession.taskSnapshot.deletedAt |
| 18 | createCalendarEvent | calendarEvents | 是 | 否 | 否 | 否 | 否 | not_found→cancelled | constraint→id冲突 | N/A |
| 19 | deleteCalendarEventWithUndo | calendarEvents | 是 | 否 | 否 | 否 | 否 | not_found→cancelled | version_conflict→重试 | 设置pending_delete+deleteToken+deleteExpiresAt |
| 20 | undoDeleteCalendarEvent | calendarEvents | 是 | 否 | 否 | 否 | 否 | not_found→cancelled | version_conflict→冲突提示 | 恢复recordStatus=active |
| 21 | hardDeleteCalendarEvent | calendarEvents | 是 | 否 | quota允许 | 否 | 否 | not_found→已完成 | retryable_abort→重试 | 删除event |

**额外操作（非高层事务操作）**：

| # | 操作 | 说明 | 需要lease | quota允许 |
|---|---|---|---|---|
| 22 | createMoodEntry | addNew moodEntries | 是 | 否 |
| 23 | deleteMoodEntryWithUndo | 设置pending_delete | 是 | 否 |
| 24 | undoDeleteMoodEntry | 恢复recordStatus=active | 是 | 否 |
| 25 | hardDeleteMoodEntry | 删除moodEntry | 是 | quota允许 |
| 26 | createHabit | addNew habits | 是 | 否 |
| 27 | deleteHabit | hard delete+确认对话框 | 是 | quota允许 |
| 28 | createHabitCheckin | addNew habitCheckins | 是 | 否 |
| 29 | deleteHabitCheckin | 删除habitCheckin | 是 | 否 |
| 30 | createFocusSession | addNew focusSessions | 是 | 否 |
| 31 | quotaDeleteFocusSessions | 按时间范围删除+preview+二次确认 | 是 | 是 |
| 32 | bestEffortPatchFocusSessionTaskDeletedAt | 异步CAS补写，不参与SaveJob | 否 | 跳过 |

**Panel创建合同**（v2.0必须）：

```typescript
async function createPanel(input: {
  name: string
  width?: number
  height?: number
}): Promise<PanelRecord>
```

- storeNames: panels
- 需要lease
- id生成：crypto.randomUUID()
- 默认值：width=800, height=600, offsetX=0, offsetY=0, zIndex=maxZIndex+1, createdAt=ctx.now(), schemaVersion=1
- name为空时默认"新面板"
- 创建事务：单条addNew
- 失败恢复：constraint(id冲突)→重新生成id重试一次；retryable_abort→重试
- 创建后不创建SaveJob（addNew已是持久化）
- 创建后自动acquire lease（如果尚未持有）
- **首次启动无panel时自动创建默认panel**：name="我的面板"，使用默认布局值
- **删除最后一个panel**：禁止。UI提示"至少保留一个面板"。deletePanel执行前检查panels store count，count<=1时拒绝
- zIndex分配：扫描当前所有panel的zIndex，取max+1。无panel时zIndex=1

**高层操作storeNames清单表**（v2.0必须）：

| 操作 | storeNames |
|---|---|
| createWidget | widgetRecords, widgetStates |
| deleteWidgetWithUndo | widgetRecords |
| hardDeleteWidget | widgetRecords, widgetStates |
| undoDeleteWidget | widgetRecords |
| deletePanel | panels, widgetRecords, widgetStates, tasks, calendarEvents |
| deleteCorruptPanel | panels, widgetRecords, widgetStates, tasks, calendarEvents |
| importPanelAsNew | panels, widgetRecords, widgetStates, tasks, calendarEvents, importStaging |
| quotaHardDeletePanel | panels, widgetRecords, widgetStates, tasks, calendarEvents |
| compressLegacyRaw | widgetStates |
| repairWidgetStatePrimaryKey | widgetStates |
| recoverOpaqueUnknownWidget | widgetStates |
| cleanupPendingDelete | 按ResourceKind分多个独立事务（见cleanup分资源事务规则） |

**cleanupPendingDelete分资源事务规则**（v2.0必须）：

- cleanup按ResourceKind分多个独立事务
- 每个事务只处理一种资源
- widget hard delete事务：widgetRecords + widgetStates
- task hard delete事务：tasks
- calendarEvent hard delete事务：calendarEvents
- moodEntry hard delete事务：moodEntries
- 一个记录冲突不影响其他资源cleanup
- Blob清理在widget hard delete事务成功后执行

### SaveJob状态机

```typescript
type SaveJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'conflicted' | 'stale' | 'cancelled'

type ResourceSaveState = 'clean' | 'dirty' | 'saving' | 'save_failed' | 'conflicted' | 'queued_after_save'

interface SaveJob<T = unknown> {
  id: string
  resourceKind: ResourceKind
  entityId: string
  reason: 'edit' | 'dragEnd' | 'resizeEnd' | 'visibilitychange' | 'manual'
  createdAt: number
  updatedAt: number
  attempt: number
  status: SaveJobStatus
  baseVersion: number
  payload: { kind: 'replace'; snapshot: T }
  latestQueuedSnapshot?: T
}

const SAVE_JOB_MAX_ATTEMPTS = 3
```

- v2.0只允许`replace`payload，携带完整用户意图snapshot
- 失败重试必须重试同一个snapshot，不从DB重新读取
- version conflict时进入冲突状态，不自动覆盖
- 同一resourceKind+entityId只允许一个active job
- 新job到来时旧job标记stale
- stale job不执行

**panel SaveJob与deletePanel冲突**（v2.0必须）：

- panel没有recordStatus字段，panel存在即active，删除panel是hard delete
- panel SaveJob不检查recordStatus，只检查panel record存在与schema可用
- panel SaveJob执行前检查lease
- panel not_found时job cancelled
- UI提示"面板已删除"
- **panel SaveJob保存内容定义**（v2.0必须）：
  - panel record的data字段包含：name, zIndex, width, height, offsetX, offsetY, schemaVersion
  - panel SaveJob的snapshot是完整的PanelData（包含上述全部字段）
  - panel SaveJob执行时：parent guard检查panel record存在→putCas写入完整PanelData
  - panel布局变更（拖拽/resize/重命名）触发panel SaveJob
  - panel SaveJob不包含子数据（widgetRecords/widgetStates/tasks/calendarEvents由各自SaveJob管理）

**pending_delete期间SaveJob处理**：

- SaveJob执行前必须检查对应记录的recordStatus===active（适用于所有extends DeletableEntityData的ResourceKind：widgetRecord/task/calendarEvent/moodEntry）
- 若recordStatus=pending_delete，则job取消(stale)，不得写入
- pending_delete写入成功后version+1
- **pending_delete状态下禁止任何普通/诊断写入该record**（除undo和cleanup hard delete外，禁止SaveJob/补写/诊断修复/legacyRaw压缩等一切写入）。这保证pending_delete后version不会变化，undo可安全使用expectedVersion
- undo使用deleteChecked with expectedFields={'data.recordStatus':'pending_delete'}+expectedVersion=pending_delete时的version（因为禁止其他写入，version不会变化）。undo成功后recordStatus恢复为'active'（通过putCas写入恢复后的完整数据，version递增）
- cleanup hard delete校验version（deleteChecked with predicate）
- 重复delete no-op返回当前pending_delete记录

**widgetState SaveJob parent guard**（v2.0必须）：

所有ResourceKind=widgetState的SaveJob执行前必须通过parent guard检查：

1. 读取父widgetRecord：不存在→job stale/cancelled；recordStatus=pending_delete→job stale/cancelled；recordStatus=active→继续
2. 检查panel是否存在：不存在→job stale/cancelled

**ResourceKind→parent guard表格**：

| ResourceKind | parent guard检查 |
|---|---|
| panel | 无（顶层实体） |
| widgetRecord | panel存在 |
| widgetState | widgetRecord存在且active + panel存在 |
| task | panel存在 |
| calendarEvent | panel存在 |
| focusSession | 无（workspace级） |
| habit | 无（workspace级） |
| habitCheckin | habit存在 |
| moodEntry | 无（workspace级） |

**SaveJob事务storeNames表**（v2.0必须）：

SaveJob执行时parent guard与putCas必须在同一readwrite transaction内完成：

| ResourceKind | SaveJob readwrite stores |
|---|---|
| panel | panels |
| widgetRecord | panels, widgetRecords |
| widgetState | panels, widgetRecords, widgetStates |
| task | panels, tasks |
| calendarEvent | panels, calendarEvents |
| habitCheckin | habits, habitCheckins |
| moodEntry | moodEntries |
| habit | habits |

**focusSession不参与SaveJob**：focusSession创建后不可编辑，只通过createFocusSession(addNew)创建，bestEffortPatchFocusSessionTaskDeletedAt异步补写。不创建SaveJob，不参与ResourceSaveState。

**SaveJob状态转换表**：

| 当前状态 | 新snapshot到来 | 行为 |
|---|---|---|
| pending | 替换snapshot或stale旧job | 新snapshot替换pending job的snapshot，或旧job标记stale后创建新job |
| running | 写入latestQueuedSnapshot | 不创建新job，只更新running job的latestQueuedSnapshot |
| failed | 保留failed snapshot，新snapshot进入queued | failed job保留其snapshot用于重试，新snapshot写入latestQueuedSnapshot |
| conflicted | 不再自动保存，等待用户刷新 | conflicted状态不自动保存，用户刷新后重新加载最新数据。保留snapshot用于手动恢复 |
| stale | 不执行 | stale job直接跳过 |
| succeeded | 可创建新job | succeeded是终态，新snapshot创建新job |

**dirty=false判定规则**（修正：不再简单"保存成功后dirty=false"）：

- 只有当running job成功 AND 不存在latestQueuedSnapshot AND 当前内存snapshot与已持久化snapshot一致时，才允许dirty=false（ResourceSaveState='clean'）
- 如果running job成功但存在latestQueuedSnapshot，立即创建新job（baseVersion=刚成功的version），保持dirty=true, ResourceSaveState='queued_after_save'
- 如果running job成功但内存snapshot已变化，保持dirty=true, ResourceSaveState='dirty'
- 保存失败：ResourceSaveState='save_failed'
- CAS version_conflict：ResourceSaveState='conflicted'

**保存状态UI对应**：

| ResourceSaveState | UI表现 |
|---|---|
| clean | 无提示 |
| dirty | 显示未保存角标/状态点，不弹toast |
| saving | 旋转图标 |
| queued_after_save | 旋转图标+可选"还有未保存更改" |
| save_failed | 红色toast+重试按钮 |
| conflicted | toast"数据冲突，请刷新" |

**SaveJob手动重试顺序**：

- failed状态下点击重试：如果存在latestQueuedSnapshot，UI提示"将保存最新编辑内容"，使用latestQueuedSnapshot创建新job
- 丢弃failed旧snapshot
- baseVersion取当前内存已知版本，若CAS冲突则进入conflicted

**snapshot equality定义**：

- 每个组件提供`normalizeStateForSave(state)`方法
- dirty比较基于canonical JSON（key排序+去除transient字段+统一undefined为null策略）
- v2.0a要求16组件实现此方法

### 单资源保存队列（同标签页自冲突解决）

同一资源（resourceKind+entityId）同一时间只允许一个running SaveJob：

1. **running期间新snapshot只更新latestQueuedSnapshot**：新编辑产生的新snapshot不创建新job，只更新当前running job的`latestQueuedSnapshot`字段
2. **running成功后用新version保存latestQueuedSnapshot**：如果latestQueuedSnapshot存在，立即创建新job（baseVersion=刚成功的version）并执行
3. **running失败后不丢queued snapshot**：latestQueuedSnapshot保留，失败job重试同一snapshot；重试耗尽后latestQueuedSnapshot仍可用于手动重试
4. **只有外部版本不匹配才提示冲突**：CAS version_conflict说明是其他标签页写入，提示冲突toast；本标签页连续保存不应产生冲突toast
5. **本标签页连续保存不应产生冲突toast**：同一标签页的连续编辑→保存→编辑→保存，version始终由本标签页维护，不触发冲突

### Dirty Draft策略（v2.0）

debounce窗口内刷新，未保存内容可能丢失。v2.0使用sessionStorage尽力保存文本草稿：

```typescript
const DRAFT_KEY_PREFIX = 'draft:'

function saveDraft(resourceKind: ResourceKind, entityId: string, snapshot: unknown): void {
  try {
    sessionStorage.setItem(`${DRAFT_KEY_PREFIX}${resourceKind}:${entityId}`, JSON.stringify(snapshot))
  } catch { /* quota exceeded, silently fail */ }
}

function loadDraft(resourceKind: ResourceKind, entityId: string): unknown | null {
  try {
    const raw = sessionStorage.getItem(`${DRAFT_KEY_PREFIX}${resourceKind}:${entityId}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function clearDraft(resourceKind: ResourceKind, entityId: string): void {
  sessionStorage.removeItem(`${DRAFT_KEY_PREFIX}${resourceKind}:${entityId}`)
}
```

- 保存成功后清除draft
- 页面加载时检测draft，提示"检测到未保存草稿，是否恢复？"
- sessionStorage关闭标签页后丢失，这是可接受的
- 非文本组件（clock/sticker等）不保存draft

### 保存状态UI

见SaveJob状态机中**保存状态UI对应**表格。

### 多标签页策略

v2不支持多标签页并发编辑。EditorLease是best-effort提示，CAS是最终防线。**两个标签页短时间内都进入可编辑状态是允许的，最终由CAS冲突兜底**。

```typescript
interface EditorLease {
  ownerId: string
  acquiredAt: number
  heartbeatAt: number
  expiresAt: number
}
```

- 页面启动先尝试acquire lease（存localStorage）
- lease存在且未过期（8秒内heartbeat）则提示"另一个标签页正在编辑"，进入只读模式
- editor tab每2秒heartbeat
- 超过8秒无heartbeat允许抢占
- 关闭页面尝试release
- BroadcastChannel同步状态变化
- 所有写API执行前检查lease owner（best-effort，不保证强一致）
- import前检查lease owner
- 如果lease检测失败（如localStorage被清），CAS兜底防止数据覆盖
- **用户触发写必须持有lease**
- **cleanup lease策略统一为方案B**：
  - 用户写操作必须持有lease
  - 后台cleanup可以无lease，但必须deleteChecked/CAS条件删除，且必须幂等
  - 导入commit、deletePanel、quota hard delete必须持有lease
  - 启动后台cleanup无需等待lease，直接执行（使用deleteChecked/CAS保证安全）

**EditorLease cleanup跨tab toast失效**（v2.0必须）：

- undo失败显示"删除已完成，无法恢复"
- BroadcastChannel通知hard delete事件
- 收到通知的tab关闭相关pending_delete toast

### EditorLease只读模式边界

当检测到其他标签页持有lease时，当前标签页进入只读模式：

- **允许**：浏览查看、导出数据、创建sessionStorage draft、复制内容
- **禁止**：创建widget、编辑widget state、拖拽/resize保存、导入、删除widget、删除panel、删除实体、hard cleanup、pending_delete标记
- 如需执行写操作必须先拿到lease
- **只读模式下draft边界**：只读模式下不进入正式编辑态，可以在独立"复制/草稿"区域编辑，draft恢复必须重新拿lease并经过CAS，不能自动写入

### Quota受限模式完整合同

当IndexedDB写入空间不足时进入quota受限模式：

**进入条件**：runIdbTransaction内的QuotaExceededError——统一通过classifyToIdbTransactionError识别（返回IdbTransactionError(kind='quota_exceeded')时触发全局quota模式）

**Quota模式墓碑死锁兜底**（v2.0必须）：

Chrome Blink引擎底层使用LevelDB，delete操作写入墓碑记录（Tombstone），可能导致磁盘占用短暂增加。在极端quota溢出状态下，delete操作本身可能抛出QuotaExceededError，形成"无法删除→无法释放空间→无法退出quota"的死锁。

兜底策略（按优先级）：

1. **先尝试quota_delete_focus_sessions**：focusSessions是时间序列数据，通常量大且用户最不敏感。按时间范围（最旧30%）分批删除，每批单独事务
2. **分批删除**：每次只删除少量记录（10条），避免单次事务写入过多墓碑
3. **如果delete也抛QuotaExceededError**：
   - 不重试delete
   - UI提示"存储空间严重不足，浏览器无法执行删除操作。请尝试：1) 关闭其他标签页释放内存 2) 在浏览器设置中清除站点数据 3) 导出数据后在浏览器设置中清除所有站点数据再重新导入"
   - 提供"清除站点数据"按钮（跳转chrome://settings/content/all）
4. **浏览器级别清除**：如果前端完全无法自救，用户必须通过浏览器设置清除站点数据。这是最后的兜底，v2.0不实现自动化（风险过高）
5. **预防措施**：v2.0b实现存储使用量监控，在达到80%时提前警告用户

**退出条件**：
1. 用户hard delete成功
2. 系统执行一次quota probe：
   - 使用importStaging store写入一个QuotaProbeData record（kind='quota_probe'）
   - 立即删除
   - 两步在同一事务中完成
3. probe成功：退出quota模式
4. probe失败：保持quota模式
5. **quota probe脆弱性兜底**（v2.0必须）：
   - quota probe只允许写importStaging store的QuotaProbeData record
   - 如果importStaging写入也失败：保持quota模式，不向其他业务store写probe
   - **禁止向业务store写probe record**：不同store有不同schema/索引/业务语义，写probe可能污染数据、触发约束错误、在programming_error_after_commit异常下留下脏记录
   - 用户手动清理数据后，任何后续写操作成功都自动触发一次probe尝试退出quota模式
   - **不假设probe一定能成功**：quota模式退出是best-effort，不作为功能验收的硬性前提

**UI表现**：全局banner"存储空间不足"，持续显示直到退出quota模式

**允许操作**：
- 浏览查看
- 导出数据
- hard delete（跳过pending_delete直接删除，需二次确认，事务内条件删除）

**禁止操作**：
- 新建widget/panel
- 编辑widget state
- 标记pending_delete（逻辑删除）
- 导入

**quota模式下focusSession删除**：
- quota模式允许删除历史focusSessions（quota-only入口）
- 删除粒度：按时间范围（"删除X天前的记录"）
- 必须preview数量
- 必须建议导出
- 二次确认
- 单事务删除
- 删除后statsPanel重新聚合
- 不产生pending_delete
- 不可撤销
- console/debug记录

**quota模式删除panel合同**：
- 允许quota模式删除panel
- 必须二次确认+建议导出
- 必须持有lease
- 直接hard delete（不写pending_delete）
- 包含active和pending_delete子记录
- 单事务执行，成功全部删除，失败全部回滚
- 失败时toast只显示"删除失败，未删除任何数据"
- 不创建toast撤销

**hard delete特殊规则**：
- quota模式hard delete只能删除：已pending_delete且deleteExpiresAt<=now的记录，或用户二次确认的当前可见记录
- 必须持有当前有效lease
- 如果lease不可确认，只允许导出，不允许hard delete
- **quota模式hard delete不做version递增，但必须在同一readwrite事务内条件删除**：
  1. get当前record
  2. 校验id/version/recordStatus/deleteToken/deleteExpiresAt
  3. 校验通过才delete
  4. 校验失败返回version_conflict或state_changed
  5. 不允许盲删
- hard delete部分失败时toast提示"删除失败，未删除任何数据"（单事务保证原子性，不存在部分删除）
- pending_delete未过期记录在quota模式下可加速hard delete（二次确认后跳过等待期直接删除）

### 自动保存规则

- 拖拽/resize过程中不写DB，只在end后保存
- 文本输入debounce >= 1000ms
- layout保存与widgetState保存分离
- Zustand selector按widgetId订阅
- beforeunload/visibilitychange/pagehide只做最后flush（不保证完成）
- **beforeunload flush与SaveJob交互**：
  - 绕过debounce
  - 创建SaveJob（如果当前无running job）
  - 如果已有running job，更新latestQueuedSnapshot
  - 写sessionStorage draft
  - 不使用sendBeacon
  - pagehide时强制saveDraft
- dirty state标记+UI展示
- 中文输入法composition期间不触发保存
- compositionend后触发debounce保存

---

## WidgetStateEnvelope（v2.0必须引入）

```typescript
interface WidgetStateEnvelope<T = unknown> {
  widgetType: string
  widgetVersion: string
  stateVersion: number
  updatedAt: number
  state: T
}
```

- v2.0所有16个组件的widgetState必须包装在Envelope中
- 加载时校验widgetType+stateVersion
- 不匹配则走validateState
- `PersistedRecord.updatedAt`：存储层写入时间，仅用于同步/排序（UI排序用PersistedRecord.updatedAt）
- `Envelope.updatedAt`：业务状态修改时间，仅用于组件内部展示
- 冲突判断只看`version`，不看任一`updatedAt`
- 导入时保留Envelope.updatedAt，PersistedRecord.updatedAt由写入层重新生成

### Legacy数据兼容（v2.0）

v2.0首次启动时，旧数据没有Envelope包装。定义加载时识别策略：

**widgetStates legacy加载pipeline**（v2.0必须）：

```
1. 尝试校验PersistedRecord外壳（id/version/updatedAt/data字段存在且类型正确）
2. 如果外壳不符合当前PersistedRecord但符合legacy widgetState外壳：
   - legacy widgetState外壳特征：有id字段、有data字段、data是plain object
   - 进入legacy path
3. 如果外壳符合PersistedRecord：
   a. data.schemaVersion存在：走当前StoreSchemaContract校验
   b. data.schemaVersion缺失但可识别为legacy widgetState：进入legacy path
   c. 否则bad_state
4. legacy path：
   - 识别legacy shape（支持的legacy shape：旧版直接存state对象，无WidgetStateData包装）
   - 生成syntheticEnvelope（widgetType从widgetRecord.data.type获取，widgetVersion='0.0.0'，stateVersion=1）
   - 不写DB（lazy migration，不批量迁移）
5. 首次编辑保存时写入当前WidgetStateData（含envelope + legacyRaw + legacyWrappedAt）
```

- StoreSchemaContract.readCompatValidateRecord负责识别legacy shape
- legacy识别属于StoreSchemaContract职责
- LoadedWidgetState在readCompatValidateRecord之后产生

```typescript
type LoadedWidgetState =
  | { kind: 'envelope'; envelope: WidgetStateEnvelope }
  | { kind: 'legacy'; raw: unknown; syntheticEnvelope: WidgetStateEnvelope }
  | { kind: 'missing' }
  | { kind: 'invalid'; raw: unknown }
```

- **LoadedWidgetState是UI派生状态，不是schema层权威结果**。权威结果来自ReadCompatResult<WidgetStateData>和WidgetState加载判定树
- **LoadedWidgetState由ReadCompatResult转换而来**：`ReadCompatResult<WidgetStateData>` → `LoadedWidgetState`的转换规则：`{ok:true, kind:'current'}` → `{kind:'envelope'}`；`{ok:true, kind:'legacy'}` → `{kind:'legacy'}`；`{ok:false}` → `{kind:'invalid'}`；locator返回missing → `{kind:'missing'}`
- **业务层不得直接根据LoadedWidgetState写DB**。写DB必须通过SaveJob，SaveJob使用normalizeStateForSave后的envelope.state
- LoadedWidgetState只用于渲染分发和UI展示逻辑

- legacy数据：读取时自动包装为Envelope（lazy migration，不批量迁移），生成syntheticEnvelope
- **load legacy不立即写DB**：只在内存中持有syntheticEnvelope，不触发DB写入
- **首次用户编辑成功保存时**写入envelope + legacyRaw + legacyWrappedAt
- **未编辑直接导出时**导出synthetic WidgetStateData（含syntheticEnvelope + legacyRaw）
- 包装前保留raw backup到`WidgetStateData.legacyRaw`，记录`legacyWrappedAt`
- 包装后正常渲染
- **legacyRaw和legacyWrappedAt是WidgetStateData的字段，不属于WidgetStateEnvelope**
- **禁止将legacy字段塞入envelope**
- **导出WidgetStateData时完整保留legacyRaw/legacyWrappedAt**
- **legacy validate失败时原始DB不覆盖**：进入invalid状态，显示placeholder，raw state保留
- 用户编辑后保存时Envelope写入DB，legacyRaw和legacyWrappedAt保留
- 导入legacy数据时走importState
- 包装失败则进入invalid状态，显示placeholder
- legacyRaw永久保留，不主动清理（占用空间有限，安全性优先）
- legacyRaw参与导出（作为envelope的附加字段）
- legacyRaw受prototype pollution扫描保护
- **legacyRaw超2MB处理**：
  - legacy读取不受2MB新建限制
  - 首次编辑保存前估算WidgetStateData大小
  - 超过2MB时禁止保存并提示导出后压缩legacyRaw
  - 普通模式也允许用户显式压缩legacyRaw（设置/诊断入口）
- **旧数据WidgetStateRecord.id不一致处理**：如果旧widgetStates.id !== data.widgetId，以data.widgetId为准。lazy repair按repairWidgetStatePrimaryKey事务步骤执行（见ID生成规则章节）。导出时使用data.widgetId作为id。不进入invalid状态。
- **普通模式legacyRaw不主动清理**
- **quota模式压缩legacyRaw完整合同**：
  - 必须持有lease
  - widgetRecord存在且active
  - WidgetStateRecord按CAS version+1
  - 只删除legacyRaw/legacyWrappedAt
  - 设置legacyRawDroppedAt
  - 不调用validateState
  - pending_delete widget禁止压缩
  - **legacyRaw压缩使用独立DiagnosticCleanupJob**：不复用普通SaveJob语义。独立Job，不参与ResourceSaveState。压缩前不需要quota probe。压缩失败保持quota banner。压缩成功后自动probe尝试退出quota模式
  - **quota模式legacyRaw压缩硬规则**：不允许修改envelope.state，不允许触发normalizeStateForSave，不允许ResourceSaveState变更，不允许与普通SaveJob合并
  - 允许在quota模式写widgetStates（特例，仅删除字段）
  - 写失败toast提示"压缩失败"
  - 必须先导出备份（自动触发）
  - 按widget粒度压缩，不批量
  - **legacyRaw压缩是best-effort**：主要释放空间路径仍然是hard delete。压缩失败不得阻塞导出和删除
  - **压缩后设置legacyRawDroppedAt时间戳**：标记legacyRaw已被删除的时间
  - **导出时如果legacyRawDroppedAt存在，不声称完整保留legacyRaw**
  - **placeholder导出raw时raw=envelope.state**
  - **修复失败时如果legacyRaw已删除，导出envelope.state作为备份**

### legacyRaw诊断UI（v2.0）

v2.0提供诊断UI（设置/诊断中正式入口）：
- 哪些widget有legacyRaw
- 大致JSON size
- legacyRaw占用统计
- 是否可导出后压缩
- 允许用户导出后压缩（非只读隐藏功能）

---

## Widget生命周期接口（v2.0最小版）

```typescript
type ValidationResult<T> =
  | { ok: true; state: T; repaired?: boolean; warnings?: string[] }
  | { ok: false; fallbackState: T; errors: string[] }

interface ExportContext {
  widgetId: string
  panelId: string
  includeEntities: boolean
}

interface ImportContext {
  oldWidgetId: string
  newWidgetId: string
  oldPanelId: string
  newPanelId: string
  widgetIdMap: Record<string, string>
  panelIdMap: Record<string, string>
  entityIdMap: Record<string, string>
  addWarning(message: string): void
}

**importState addWarning受控副作用**（v2.0必须）：

- warning顺序稳定（按发现顺序）
- warning去重（同一message只出现一次）
- 重复调用允许重复warning但去重
- preview重新生成时warning清空重建
- warning不参与deterministic derived payload（仅展示用）

interface WidgetDefinitionV2A<T = unknown> {
  type: string
  widgetVersion: string
  stateVersion: number
  createDefaultState(): T
  validateState(raw: unknown): ValidationResult<T>
  normalizeStateForSave(state: T): JSONValue
}

interface ExportableWidgetDefinition<T = unknown> extends WidgetDefinitionV2A<T> {
  exportState(state: T, context: ExportContext): unknown
  importState(raw: unknown, context: ImportContext): ValidationResult<T>
}
```

v2.0a注册WidgetDefinitionV2A（6个成员，其中3个方法：validateState/createDefaultState/normalizeStateForSave必须真实实现）。v2.0c引入ExportableWidgetDefinition（exportState/importState必须进入完整验收）。**v2.0总验收必须包含导入导出**：v2.0a/v2.0b/v2.0c是内部里程碑，v2.0c完成后才等于v2.0验收通过。v2.0a阶段不验收导入导出，但v2.0最终必须全部通过。migrateState/cloneState等v2.1再加。
16个组件必须全部实现WidgetDefinitionV2A接口。

**normalizeStateForSave JSON-safe合同**（v2.0必须）：

- normalizeStateForSave必须返回JSONValue，禁止返回Date/Map/Set/function/symbol/undefined/cyclic object
- validateState必须保证state是JSON-safe
- JSONValue定义：string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue }

### validateState失败处理（v2.0）

- 原raw state必须保留在widgetStates store中，不覆盖
- fallbackState只用于构造WidgetDisplayMode=render/bad_state时的错误信息（如显示errors数组），不渲染真实组件，不写回DB
- **禁止编辑**：validateState失败时不渲染真实组件，只渲染error placeholder
- 用户只能导出raw state或删除组件
- placeholder显示"组件数据异常"+导出按钮+删除按钮
- 不静默reset

---

## Widget渲染状态分层

ErrorBoundary只负责render_error。其他降级状态由不同层处理：

```typescript
type WidgetRenderStatus =
  | 'ok'
  | 'missing_state'
  | 'unknown_type'
  | 'bad_state'
  | 'incompatible_state_version'
  | 'mcp_disabled'
  | 'render_error'
```

| 层 | 负责状态 | 处理方式 |
|---|---|---|
| Registry resolve | unknown_type, mcp_disabled | placeholder（不进入组件渲染） |
| State load | missing_state | placeholder"组件数据缺失"+导出按钮 |
| Envelope validate | incompatible_state_version | placeholder"组件版本不兼容"+导出按钮 |
| WidgetDefinition.validateState | bad_state | placeholder"组件数据异常"+导出按钮+删除按钮 |
| ErrorBoundary | render_error | 错误类型+重试+导出按钮+删除按钮 |

每层产生明确状态，不混在一起。

### WidgetDisplayMode统一模型（v2.0必须）

所有widget渲染状态统一为WidgetDisplayMode：

```typescript
type WidgetDisplayMode =
  | { kind: 'render'; status: WidgetRenderStatus }
  | { kind: 'diagnostic'; issue: DiagnosticIssueKind }
  | { kind: 'opaque_recover_required' }
```

- `render`：正常渲染路径，status为WidgetRenderStatus
- `diagnostic`：诊断路径，issue为DiagnosticIssueKind，显示诊断placeholder
- `opaque_recover_required`：importedAsOpaqueUnknown=true的widget，需显式修复
- 所有widget渲染入口必须先计算WidgetDisplayMode，再根据kind分发

### PanelLoadStatus（v2.0必须）

```typescript
type PanelLoadStatus =
  | 'ok'
  | 'missing'
  | 'bad_record'
  | 'incompatible_schema'

type WriteCapability =
  | 'normal_write'
  | 'import_commit'
  | 'delete_panel'
  | 'quota_hard_delete_panel'
  | 'quota_delete_focus_sessions'
  | 'quota_delete_habit'
  | 'diagnostic_delete_corrupt_panel'
  | 'diagnostic_compress_legacy_raw'
  | 'diagnostic_delete_orphan'
  | 'diagnostic_delete_import_staging'
  | 'diagnostic_delete_duplicate_widget_states'
  | 'diagnostic_delete_widget_record'
```

- `ok`：正常加载和显示
- `missing`：panel record不存在，不显示
- `bad_record`：panel record结构损坏或校验失败。显示panel名称（通过safeOwnDataProp读取，name最大长度100，含控制字符时显示"（含特殊字符）"），允许导出raw panel bundle，允许hard delete，不加载子数据，进入只读模式。panel record不是plain object时仍允许导出raw backup
- **raw panel bundle定义**：包含损坏panel record + 可按id关联的子数据（widgetRecords by panelId + widgetStates + tasks + events）。panelId从record.id获取（不依赖data字段）。子数据按panelId索引扫描
- **corrupt child边界声明**：v2.0的panel删除和raw panel bundle只覆盖可通过data.panelId索引关联的子记录。无法解析panelId的损坏记录不随panel删除，归类为workspace orphan，由v2.1完整性检查器处理。
- **bad_record panel删除后orphan残留UI提示**（v2.0必须）：deleteCorruptPanel成功后，如果通过诊断扫描发现仍存在无法关联到任何panel的orphan记录（widgetRecord/widgetState/task/calendarEvent中data.panelId指向已删除panelId但该panelId不在任何panel record中），在诊断面板中显示orphan条目，提供export_raw_widget_state和delete_orphan_widget_state_or_record能力。用户可通过诊断面板手动清理。v2.0不做自动orphan清理。**UI文案**："检测到数据库中存在无法关联到任何面板的孤儿记录，可能与历史损坏数据有关。"（不得暗示"由本次删除残留"）
- `incompatible_schema`：panel schemaVersion不在supportedSchemaVersions中。显示panel名称（如可读），允许导出raw panel bundle，允许hard delete，不加载子数据，进入只读模式

**WriteCapability权限矩阵**：

| 模式 | normal_write | import_commit | delete_panel | quota_hard_delete_panel | quota_delete_focus_sessions | quota_delete_habit | diagnostic_delete_corrupt_panel | diagnostic_compress_legacy_raw | diagnostic_delete_orphan | diagnostic_delete_import_staging | diagnostic_delete_duplicate_widget_states | diagnostic_delete_widget_record |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| normal editable | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| readonly lease lost | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| quota | ❌ | ❌ | ❌(走quota_hard_delete_panel) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| bad panel readonly | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |

- quota模式下删除panel走quota_hard_delete流程（二次确认+建议导出+直接hard delete）
- diagnostic操作必须持有lease+二次确认+条件删除

### 诊断状态统一模型（v2.0必须）

所有诊断场景使用统一的DiagnosticIssueKind类型：

```typescript
type DiagnosticIssueKind =
  | 'import_recovery_error'
  | 'duplicate_widget_state'
  | 'widget_state_repair_failed'
  | 'bad_panel_record'
  | 'opaque_recover_failed'
  | 'legacy_raw_oversized'
  | 'create_widget_partial_commit'
  | 'orphan_widget_state'
  | 'widget_record_missing'
  | 'widget_state_missing'
  | 'orphan_widget_record'
  | 'inconsistent_cross_store_commit'
```

- 每种DiagnosticIssueKind对应明确的UI处理策略
- 诊断入口统一在设置/诊断面板中展示
- 诊断操作必须持有lease+二次确认

**DiagnosticIssueKind与Capability映射表**（v2.0必须）：

| IssueKind | Capabilities |
|---|---|
| duplicate_widget_state | export_all_widget_state_candidates, delete_duplicate_widget_states |
| widget_state_repair_failed | export_raw_widget_state, repair_widget_state_primary_key |
| import_recovery_error | export_import_staging_diagnostics, delete_import_staging |
| bad_panel_record | export_raw_panel_bundle, delete_corrupt_panel |
| opaque_recover_failed | export_raw_widget_state, recover_opaque_unknown_widget |
| legacy_raw_oversized | export_raw_widget_state, compress_legacy_raw |
| create_widget_partial_commit | export_raw_widget_state, delete_orphan_widget_state_or_record |
| orphan_widget_state | export_raw_widget_state, delete_orphan_widget_state |
| widget_record_missing | export_raw_widget_state, delete_orphan_widget_state |
| widget_state_missing | export_widget_record, delete_widget_record |
| orphan_widget_record | export_raw_widget_record, delete_orphan_widget_record |
| inconsistent_cross_store_commit | export_import_staging_diagnostics, delete_import_staging |

**DiagnosticCapability矩阵**（v2.0必须）：

```typescript
type DiagnosticCapability =
  | 'export_raw_widget_state'
  | 'export_all_widget_state_candidates'
  | 'export_raw_panel_bundle'
  | 'export_raw_widget_record'
  | 'export_widget_record'
  | 'delete_duplicate_widget_states'
  | 'repair_widget_state_primary_key'
  | 'delete_import_staging'
  | 'export_import_staging_diagnostics'
  | 'recover_opaque_unknown_widget'
  | 'compress_legacy_raw'
  | 'delete_corrupt_panel'
  | 'delete_orphan_widget_state'
  | 'delete_orphan_widget_record'
  | 'delete_widget_record'
  | 'delete_orphan_widget_state_or_record'
```

| DiagnosticCapability | 需要lease | 允许readonly | 允许quota | 允许bad panel | 需要二次确认 | 需要自动备份 |
|---|---|---|---|---|---|---|
| export_raw_widget_state | 否 | 是 | 是 | 是 | 否 | 否 |
| export_all_widget_state_candidates | 否 | 是 | 是 | 是 | 否 | 否 |
| export_raw_panel_bundle | 否 | 是 | 是 | 是 | 否 | 否 |
| export_raw_widget_record | 否 | 是 | 是 | 是 | 否 | 否 |
| export_widget_record | 否 | 是 | 是 | 是 | 否 | 否 |
| delete_duplicate_widget_states | 是 | 否 | 否 | 否 | 是 | 是 |
| repair_widget_state_primary_key | 是 | 否 | 否 | 否 | 是 | 是 |
| delete_import_staging | 是 | 否 | 是 | 否 | 是 | 否 |
| export_import_staging_diagnostics | 否 | 是 | 是 | 是 | 否 | 否 |
| recover_opaque_unknown_widget | 是 | 否 | 否 | 否 | 是 | 是 |
| compress_legacy_raw | 是 | 否 | 是 | 否 | 是 | 是 |
| delete_corrupt_panel | 是 | 否 | 是 | 是 | 是 | 是 |
| delete_orphan_widget_state | 是 | 否 | 是 | 否 | 是 | 是 |
| delete_orphan_widget_record | 是 | 否 | 是 | 否 | 是 | 是 |
| delete_widget_record | 是 | 否 | 是 | 否 | 是 | 是 |
| delete_orphan_widget_state_or_record | 是 | 否 | 是 | 否 | 是 | 是 |

**诊断操作统一备份规则**（v2.0必须）：

所有需要自动备份的diagnostic capability必须遵守以下统一规则：
- 备份成功前不得执行写操作
- 备份失败时显示统一错误"无法创建备份，操作已取消"
- 备份大小超20MB时禁止操作，或走unsafe diagnostic export（UnsafeRawDiagnosticExport格式）
- 用户手动确认"我已自行备份"允许（需二次确认+记录到console.warn）
- 备份格式统一使用DiagnosticExport类型

**DiagnosticOperationContract统一模板**（v2.0必须）：

```typescript
interface DiagnosticOperationContract {
  capability: DiagnosticCapability
  requiresLease: boolean
  requiresBackup: boolean
  allowedInQuota: boolean
  allowedInReadonly: boolean
  preflight(): Promise<DiagnosticPreflightResult>
  backup(): Promise<BackupResult>
  execute(): Promise<DiagnosticExecuteResult>
  recover(error: unknown): Promise<void>
}
```

- 所有diagnostic操作必须实现DiagnosticOperationContract
- preflight检查前置条件（lease/backup/状态）
- backup在execute前执行，失败则中止
- execute执行实际操作
- recover处理execute失败后的恢复

**DiagnosticExport统一格式**（v2.0必须）：

```typescript
type DiagnosticExport =
  | RawWidgetStateDiagnosticExport
  | UnsafeRawDiagnosticExport
  | RawPanelBundleDiagnosticExport
  | ImportStagingDiagnosticExport
  | LegacyJsonDiagnosticBackupExport
```

- 统一20MB大小限制
- 统一pollution scan规则
- 统一stringify failure处理（记录error，不中断）
- 统一blockedKeys（最多100）
- 统一truncation规则（超限时截断内容而非整个JSON）

**deleteCorruptPanel独立操作合同**（v2.0必须）：

```typescript
async function deleteCorruptPanel(panelId: string): Promise<void>
```

- storeNames: panels, widgetRecords, widgetStates, tasks, calendarEvents
- panelId从record.id获取
- 子数据按panelId索引扫描（只处理可索引的）
- Blob清理按widgetIds
- quota模式允许
- 生成diagnostic issue

**deleteCorruptPanel独立恢复表**（不照搬deletePanel）：

| 步骤 | 说明 |
|---|---|
| panel是否存在 | 通过get('panels', panelId) |
| panel名称 | safeOwnDataProp读取或"未知面板" |
| 子资源统计 | 按索引扫描（可索引部分） |
| pending_delete toast | 无（corrupt panel无pending_delete流程） |
| draft恢复 | 无 |
| SaveJob cancel | 按panelId扫描并cancel |
| 失败恢复 | 重新读取panel是否存在 |

### schemaVersion加载判定pipeline

**WidgetState加载判定顺序**：见StoreSchemaContract校验层级中的唯一权威判定树（8步），不另立pipeline。

**WidgetRecord加载判定**：检查WidgetRecordData.schemaVersion → 不支持则widget整体placeholder。

### unknown_type与mcp_disabled边界

- **mcp_disabled**：widgetType以`mcp-`前缀开头的组件，走MCP禁用placeholder（"此组件需要动态执行，当前版本不支持"）
- **unknown_type**：widgetType不以`mcp-`前缀开头的未注册组件，走未知类型placeholder（"未知组件类型"+导出按钮）
- 判断规则：`widgetType.startsWith('mcp-')` → mcp_disabled，否则 → unknown_type
- 两种placeholder都保留raw state，都支持导出

### unknown widget opaque恢复最小合同

- `importedAsOpaqueUnknown=true`的widget，registry识别到type时不直接渲染
- 显示placeholder"此组件需要数据修复"+导出按钮+修复按钮
- 修复按钮触发流程：
  1. 自动导出当前raw state备份
  2. 调用组件的`importState(context)`，context包含widgetIdMap等remap信息（优先使用opaqueImportContext中的映射）
  3. importState必须处理：尝试remap opaque内部旧id（通过context.widgetIdMap等）；无法remap的引用清空
  4. 调用`validateState`校验
  5. 成功则：删除legacyRaw（可选，设置legacyRawDroppedAt）；设置新envelope.updatedAt；清除importedAsOpaqueUnknown标记和opaqueImportContext并正常渲染
  6. 修复失败回到opaque placeholder
- 修复前自动导出备份
- **自动导出备份失败时禁止继续修复**：显示"无法创建备份，请先释放空间或检查下载设置"
- **raw state超过导出上限时禁止修复**：如果raw state超过20MB导出上限，修复被禁止，显示"组件数据过大，无法创建备份，只能删除组件"

---

## 导入导出边界声明

### Manifest类型拆分

```typescript
interface ExportManifest {
  panelName: string
  originalWidgetCount: number
  exportedWidgetCount: number
  skippedWidgetCount: number
  originalTaskCount: number
  exportedTaskCount: number
  skippedTaskCount: number
  originalCalendarEventCount: number
  exportedCalendarEventCount: number
  skippedCalendarEventCount: number
}

interface ImportPreviewManifest {
  originalWidgetCount: number
  importedWidgetCount: number
  skippedWidgetCount: number
  warnings: string[]
  schemaVersion: number
}

interface BlobAssetManifest {
  widgetId: string
  fileName: string
  mimeType: string
  size?: number
}

interface DisabledMcpComponentManifest {
  id: string
  name: string
  version: string
  sandbox: 'disabled'
}
```

三种manifest分别校验，不混用。v2.0 MCP完全禁用，DisabledMcpComponentManifest不保留entry和permissions字段，避免误导实现者。

### 导出类型语义

**导出时pending_delete提示**：普通导出时如果panel有待删除项目，UI提示"当前有待删除项目，导出将不包含它们"。诊断导出包含pending_delete记录。删除toast提供导出入口。

**导出前大小校验**：

```typescript
interface ExportSizeEstimate {
  recordCount: number
  estimatedBytes: number
  oversizedRecords: Array<{ storeName: string; id: string; estimatedBytes: number }>
}
```

- 先做快速estimate用于提前提示用户
- **导出构造期间累计UTF-8长度预算**：单记录序列化时累加到累计预算，超限早停，不允许为了测大小构造远超上限的完整字符串
- 最终写文件前必须以实际UTF-8 byte length校验
- 超过20MB不得触发下载
- Estimate只用于提前提示，不作为最终判定
- **导出截断算法**（v2.0必须，单panel导出，widget原子单位，两阶段构造）：
  - **Phase 1（dry-run选取）**：遍历所有widget/task/event，计算每个bundle的UTF-8字节大小，累计预算内可导出的record id列表+最终manifest（含original/exported/skipped count）。超限的widget整组跳过
  - **Phase 2（序列化输出）**：按Phase 1决定的id列表序列化，构造完整ExportBundleV1 JSON。manifest已在Phase 1确定，不需要回写
  - **widget是原子单位**：WidgetRecord + WidgetState + 可选BlobAssetManifest + 可选DisabledMcpComponentManifest要么整组写入，要么整组跳过。不允许出现有WidgetRecord但无WidgetState的半损坏导出
  - UTF-8字节长度计算：`new TextEncoder().encode(jsonString).length`
  - 累计预算阈值：20 * 1024 * 1024字节（20MB）
  - 超限后立即停止，不尝试压缩或截断单条record内容
  - **v2.0只支持单panel导出**：ExportBundleV1包含一个panel的全部数据
  - oversizedWidgetIds：记录因单widget bundle本身超20MB而被跳过的widgetId

**导出的是WidgetStateData（含legacyRaw/legacyWrappedAt），不是纯Envelope。** WidgetStateData包含widgetId、panelId、envelope以及可选的legacyRaw/legacyWrappedAt字段，导出时完整保留。

**raw state导出统一合同**（v2.0必须）：

- 单组件raw导出也受20MB限制
- raw导出做pollution scan
- raw导出文件格式：WidgetStateData JSON
- render_error时导出WidgetStateData（含envelope+legacyRaw）
- legacyRawDroppedAt存在时导出提示"旧版备份已压缩"
- unknown opaque超20MB时禁止修复和raw导出，只能删除
- **raw导出pollution scan失败UX**：pollution scan失败时唯一导出格式为安全诊断JSON，禁止导出原始可解析对象：
  ```typescript
  interface UnsafeRawDiagnosticExport {
    kind: 'unsafe_raw_diagnostic'
    unsafeRawString: string
    stringifyFailed: boolean
    stringifyErrorName?: string
    stringifyErrorMessage?: string
    blockedKeys: string[]
    truncated: boolean
    originalSize?: number
  }
  ```

- JSON.stringify成功：unsafeRawString为结果
- JSON.stringify失败：unsafeRawString=''，写入stringifyErrorName+stringifyErrorMessage
- blockedKeys最多100
- 输出JSON本身必须小于20MB
- 超限时截断unsafeRawString，不是截断整个JSON

| 组件类型 | 导出内容 | 导入行为 |
|---|---|---|
| 纯widget state（richText/clock/sticker/countdownCard/quoteCard/markdownEditor/noteBlock/breathingWidget） | envelope完整导出 | remap widgetId后恢复 |
| panel entity widget（taskList/agendaList） | 导出panel entity+widget配置 | remap entityId+widgetId后恢复 |
| workspace entity widget（focusTimer/habitTracker/moodTracker） | 只导widget配置，不导workspace数据。导出时exportState必须移除workspace entity引用（selectedHabitId/selectedMoodEntryId/currentTaskId/lastSessionId等） | 导入后显示空状态+提示"历史数据不包含在导出中"。导入时importState再次强制清空workspace entity引用。导入时经过exportState->importState->validateState->envelope后再写DB。被清除的引用字段不保留到legacyRaw。导入后组件不显示dirty（因为写DB的state就是最终state） |

**workspace组件legacyRaw引用清除合同**（v2.0必须）：
- workspace entity widget的legacyRaw中可能包含workspace entity引用字段
- 导出时如果legacyRaw存在且包含引用字段，exportState必须在legacyRaw副本中清除这些字段（不修改DB中的legacyRaw，只修改导出副本）
- 清除规则与envelope.state一致：currentTaskId/lastSessionId/activeSessionId/selectedHabitId/selectedMoodEntryId等引用字段置为undefined
- 导入时importState对legacyRaw中的引用字段同样强制清空
- **DB中的legacyRaw不做修改**：legacyRaw是历史备份，保持原样。只有导出副本和导入后的写入才清除引用
- **unknown opaque widget不解释legacyRaw**：导入时unknown widget的legacyRaw只做安全扫描（大小+深度+prototype pollution），不尝试清除引用字段，标记为opaque
- **mcp-disabled widget不解释legacyRaw**：只提取DisabledMcpComponentManifest，legacyRaw中引用字段不清除

**workspace组件exportState字段白名单**（白名单外字段全部丢弃）：

- focusTimer exportState:
  - remove currentTaskId, lastSessionId, activeSessionId
  - keep durationPreset, soundEnabled, theme
- habitTracker exportState:
  - remove selectedHabitId
  - keep displayMode
- moodTracker exportState:
  - remove selectedMoodEntryId
  - keep theme
- statsPanel exportState:
  - remove all workspace references
  - keep displayMode, chartType
| 只读聚合widget（statsPanel） | 只导widget配置 | 导入后重新聚合当前workspace数据 |
| Blob widget（pdfViewer/musicPlayer） | 导出BlobAssetManifest（文件名+类型） | 导入后提示需重新选择本地文件 |
| unknown widget | 导出WidgetStateData原样 | 导入时remap外层record id + data.widgetId + data.panelId，envelope内部state不做任何处理（标记opaque），设置importedAsOpaqueUnknown=true，写入opaqueImportContext（包含oldWidgetId/newWidgetId/oldPanelId/newPanelId/widgetIdMap/panelIdMap/entityIdMap）。未来registry识别到该type时，如果importedAsOpaqueUnknown=true，必须走显式修复流程（explicitRecoverImportedUnknownState），不能直接渲染 |

**exportState/importState验收断言**：

每个组件的exportState/importState必须通过以下断言：

| 组件 | exportState断言 | importState断言 |
|---|---|---|
| focusTimer | 不得包含currentTaskId/lastSessionId/activeSessionId | 引用字段必须清空 |
| habitTracker | 不得包含selectedHabitId | 引用字段必须清空 |
| moodTracker | 不得包含selectedMoodEntryId | 引用字段必须清空 |
| statsPanel | 不得包含任何workspace refs | 引用字段必须清空 |
| pdfViewer | 必须只保留placeholder meta，不得保留Blob | placeholder恢复 |
| musicPlayer | 必须只保留placeholder meta，不得保留Blob | placeholder恢复 |
| unknown widget | 不得调用importState | N/A（标记opaque） |
| taskList | N/A | 必须remap entity ids |
| agendaList | N/A | 必须remap entity ids |

### 导入流程（用户视角步骤）

> **本段落仅为用户可见步骤概述，不是状态机权威定义。** 所有状态流转、事件、前置条件、事务边界、成功后状态、失败后状态、runtime recovery、crash recovery、quota行为、readonly行为的权威定义见"导入状态机唯一权威（ImportStagingStateMachine）"章节。本段落不得另写状态行为。实现者应只引用唯一权威章节。

1. 检测其他标签页→提示关闭
2. **检查File.size <= 20MB**（先于任何解析）
3. 读取文本
4. JSON parse
5. 校验ExportBundleV1顶层字段（kind/exportVersion/exportedAt/appVersion）+ ExportManifest字段（panelName/widgetCount/taskCount/calendarEventCount）。ImportPreviewManifest字段（originalWidgetCount/importedWidgetCount/skippedWidgetCount/warnings）不在导出文件中，由导入流程在remap阶段生成
5a. **导入入口分流**：
    - parse JSON
    - pollution scan
    - 判断exportVersion：
      a. exportVersion === 1：走v2 schema严格校验
      b. exportVersion缺失或0：走legacy schema（缺失version修复为1，缺失字段容错）
      c. 其他：拒绝导入

**导入parse期间UX（Web Worker方案）**：

- 导入parse在Web Worker中执行
- 主线程设置30秒timeout，超时后terminate worker
- 用户取消时terminate worker
- worker返回parse后对象或错误
- pollution scan可在worker内完成
- parse前检查File.size <= 20MB
- parse失败try/catch，提示"文件格式错误"
- parse期间显示loading状态
- import按钮防重复点击
- parse失败后恢复import UI
6. **迭代式**递归扫描JSON对象key（非递归，用栈模拟避免栈溢出），拒绝`__proto__`、`prototype`、`constructor`，限制总节点数<=100000
7. 限制单字符串长度<=10MB
8. 校验depth limit(10层)+count limit(500 widgets)
9. 写入importStaging store（status='created'，expiresAt=1小时后）。**staging写入quota失败时提示"存储空间不足，无法导入"**，不降低文件大小限制，不预估剩余空间，staging payload不压缩
10. 完整性检查→status改为'validated'
11. widgetId remap + panelId remap + entityId remap + BlobAssetManifest.widgetId remap→status改为'remapped'
12. widgetState内部引用widgetId的字段重写（通过每个组件的importState(context)处理）
12a. **remap完成后、commit前必须更新importStaging的targetPanelId/targetWidgetIds/targetTaskIds/targetCalendarEventIds**
13. 生成import preview（组件数量+类型+缺失数据提示，排序使用widget zIndex、task dueAt、event startAt、panelName，不依赖updatedAt）→status改为'previewed'。**preview不作为权威数据持久化**，可由staging.payload+manifest+remap ids重建。warnings/skippedWidgets可确定性重算。previewed状态不依赖内存对象
13a. **import preview hash绑定**（v2.0必须）：

    ```typescript
    interface ImportPreviewDigest {
      schemaVersion: 1
      batchId: string
      sourcePayloadHash: string
      remapContextHash: string
      derivedPayloadHash: string
      generatedAt: number
    }
    ```

    - preview生成时计算ImportPreviewDigest并持久化到staging.previewDigest
    - commit时必须校验hash一致（sourcePayloadHash+remapContextHash+derivedPayloadHash）
    - hash不一致则拒绝commit，提示"预览数据已变化，请重新确认"
    - RealImportStagingData必须包含previewDigest字段（可选，previewed后必填）
    - **generatedAt不参与hash**：只用于展示和过期判断，不参与确定性校验

    **Canonical JSON与Hash算法定义**（v2.0必须）：

    ```typescript
    type CanonicalJsonRule = {
      objectKeys: 'lexicographic_ascending'
      undefined: 'omit_key'
      number: 'JSON.stringify_finite_only'
      stringEncoding: 'UTF-8'
      arrayOrder: 'preserve'
      disallowNonJson: true
      hash: 'SHA-256'
    }
    ```

    - **canonicalize(value)**：递归序列化为确定性JSON字符串。object key按字典序升序排列；undefined值的key直接省略；number只允许有限数（NaN/Infinity抛错）；数组保持原始顺序；不允许function/symbol/BigInt/Date/undefined值
    - **sha256Hex(canonicalString)**：使用WebCrypto API `crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalString))`，输出hex字符串
    - **sourcePayloadHash**：`sha256Hex(canonicalize(validatedPayload))`，validatedPayload是校验后的ValidatedImportPayload（remap前的原始数据，不含ExportBundleV1顶层外壳字段）
    - **remapContextHash**：`sha256Hex(canonicalize(remapContext))`，remapContext包含entityIdMap（sorted by originalId）
    - **derivedPayloadHash**：`sha256Hex(canonicalize(derivedPayload))`，derivedPayload是remap后的完整写入数据（panel+widgets+states+tasks+events，按写入顺序排列，每个record的id/version/updatedAt不参与hash——因为这些字段在commit时由ctx生成）
    - **BlobAssetManifest排序**：按widgetId字典序排列后再canonicalize
    - **widgets/tasks/events排序**：按原始导出文件中的顺序排列（preserve array order）
    - **skipped widgets不参与derivedPayloadHash**（它们不会被写入DB）
    - **opaque unknown raw state**：canonicalize时视为不可解释JSON-safe value，仍执行canonicalize（key排序），不解释业务字段
    - **legacyRaw**：canonicalize时视为plain object，按key排序

    **canonicalize可执行伪代码**（v2.0必须）：

    ```typescript
    function canonicalize(value: unknown): string {
      if (value === null) return 'null'
      if (typeof value === 'string') return JSON.stringify(value)
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('canonicalize: NaN/Infinity not allowed')
        return JSON.stringify(value)
      }
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (typeof value === 'undefined') throw new Error('canonicalize: undefined value not allowed')
      if (typeof value === 'symbol') throw new Error('canonicalize: symbol not allowed')
      if (typeof value === 'bigint') throw new Error('canonicalize: bigint not allowed')
      if (typeof value === 'function') throw new Error('canonicalize: function not allowed')
      if (value instanceof Date) throw new Error('canonicalize: Date not allowed')
      
      if (Array.isArray(value)) {
        const items = value.map(item => {
          if (item === undefined) throw new Error('canonicalize: undefined in array not allowed')
          return canonicalize(item)
        })
        return '[' + items.join(',') + ']'
      }
      
      if (typeof value === 'object' && value !== null) {
        const proto = Object.getPrototypeOf(value)
        if (proto !== Object.prototype && proto !== null) {
          throw new Error('canonicalize: non-plain object not allowed')
        }
        const keys = Object.keys(value).sort()
        const pairs = keys
          .filter(key => (value as Record<string, unknown>)[key] !== undefined)
          .map(key => JSON.stringify(key) + ':' + canonicalize((value as Record<string, unknown>)[key]))
        return '{' + pairs.join(',') + '}'
      }
      
      throw new Error('canonicalize: unsupported type')
    }
    ```

    - **sparse array**：`Array.isArray`检测后逐项canonicalize，undefined项抛错（不允许稀疏数组）
    - **-0**：`JSON.stringify(-0)`返回`"0"`，canonicalize结果为`0`（与+0不可区分，这是可接受的）
    - **Object.create(null)**：`proto === null`通过，允许
    - **symbol key**：`Object.keys`不返回symbol key，symbol key的对象静默忽略（不抛错，因为Object.keys不暴露它们）
    - **cyclic**：无环检测，调用方保证无环（导入数据已通过depth limit保证）
    - **getter/accessor**：`Object.keys`只返回own enumerable string keys，不触发getter。但`value[key]`会触发getter。**安全处理**：canonicalize前必须先通过safeOwnDataProp读取所有值，构建plain snapshot后再canonicalize
13b. **import preview warnings确定性**：
    - importState在导入阶段必须是纯函数，不得依赖当前时间、workspace、随机数
    - warnings要么持久化到staging，要么定义为非权威展示且确认前必须重新生成并展示
    - v2.0选择：确认前重新生成并展示
14. 用户确认→**三段式commit**：
    - 确认按钮点击时重新生成preview，弹出最终确认摘要，用户确认后commit使用该摘要对应的deterministic derived payload
    A. 单独事务：previewed -> committing
       - 写targetPanelId/target*Ids/status=committing
       - 成功后才进入B
    B. 单事务commit：
       - add panel/widgets/states/tasks/events
       - **同一事务内所有record使用同一个Date.now()值作为updatedAt**（事务开始时取一次now，所有addNew/putCas使用该值）
       - update staging status=committed
       - 任一失败整体abort
    C. 单独事务cleanup：
       - delete staging
    commit前不写panels store，panel在UI不可见；commit事务内一次性写入最终PanelRecord（普通panel，不带importStatus字段）。importBatchId可选保留用于审计，但绝不用于UI过滤。UI展示所有存在于panels store的panel。
15. 失败按错误类型处理，不笼统清理staging（见staging commit quota失败处理）
16. **严禁默认清空当前数据**
17. **只允许导入为新panel，不做合并、不做覆盖**

### importStaging状态机（严格可观察）

> **本段落是ImportStagingStateMachine唯一权威章节的展开说明，不是独立规则。** 如果本段落与"导入状态机唯一权威（ImportStagingStateMachine）"章节冲突，以唯一权威章节为准。实现者应只引用唯一权威章节。

```
created -> validated -> remapped -> previewed -> committing -> committed
                                                  \
                                                   -> recovery_error
```

- 每个状态都是可观察的，UI可查询当前staging状态
- **committing→committed**：事务内写入目标数据+将staging status改为committed，不删除staging
- **committing→recovery_error**：committing状态下panel missing+有target child存在，或target ids缺失/损坏时进入recovery_error
- **recovery_error状态**：staging保留，不允许自动重试，只允许导出诊断信息或删除staging。UI显示"导入恢复异常"+导出诊断按钮+删除staging按钮。v2.1完整性检查器处理
- **recovery_error写入失败态**：如果无法写入recovery_error状态到staging，必须以内存derived diagnostic issue展示
- **ImportRecoveryDerivedState**（v2.0必须）：

```typescript
type ImportRecoveryDerivedState =
  | 'committing_panel_exists'
  | 'committing_no_panel_no_child'
  | 'committing_no_panel_has_child'
  | 'committing_corrupt_target_ids'
  | 'recovery_error_persist_failed'
```

- 允许导出staging诊断
- 允许用户删除staging
- 下次启动重复检测同样结果
- 不允许自动重试commit
- classifyToIdbTransactionError后进入quota/readonly/retry明确分支
- **committing状态允许事件**：detectCommittedNow（panel存在则标记committed并cleanup staging；panel不存在则扫描target*Ids对应正式store，有child则recovery_error，无child则删除staging，target ids缺失/损坏也recovery_error）
- **committed后允许删除staging**：staging记录不存在即cleanup完成
- **启动时恢复**：
  - `committed`状态的staging：只清理staging记录，不动已commit的目标数据
  - `committing`状态的staging：按targetPanelId查panel
    - 存在：视为committed，清理staging
    - 不存在：使用targetWidgetIds/targetTaskIds/targetCalendarEventIds扫描正式store
      - 如果任何target child存在：staging状态改为recovery_error，不允许自动重试，只允许导出诊断信息或删除staging
      - 如果确认无target child存在：删除staging（用户需重新导入）
      - 如果target ids缺失或损坏：staging状态改为recovery_error
    - 如发现target child ids已存在于正式store：不自动删除，进入recovery_error诊断，仅允许导出诊断信息，v2.1完整性检查器处理
  - created/validated/remapped/previewed状态：一律删除staging，不恢复导入流程
  - expiresAt只用于运行时清理长时间滞留staging，不参与crash恢复判断
  - 不存在staging记录=无需处理

### 导入Staging崩溃恢复（方案A：安全优先）

> **本段落是ImportStagingStateMachine唯一权威章节的展开说明，不是独立规则。如果本段落与ImportStagingStateMachine唯一权威章节冲突，以唯一权威章节为准。实现者应只引用ImportStagingStateMachine唯一权威章节。**

- 启动时扫描importStaging（跳过kind='quota_probe'的记录，仅处理kind='import_staging'的记录）
- created/validated/remapped/previewed状态：一律删除staging，不恢复导入流程
- 'committed'状态的记录：只清理staging记录，不动已commit的目标数据
- 'committing'状态的记录：按targetPanelId查panel
  - 存在：视为committed，清理staging
  - 不存在：使用targetWidgetIds/targetTaskIds/targetCalendarEventIds扫描正式store
    - 如果任何target child存在：staging状态改为recovery_error，不允许自动重试，只允许导出诊断信息或删除staging
    - 只有确认无target child存在，才允许删除staging
    - 如果target ids缺失或损坏，staging状态改为recovery_error
- 如发现target child ids已存在于正式store：进入recovery_error诊断，仅允许导出诊断信息，v2.1完整性检查器处理
- expiresAt只用于运行时清理长时间滞留staging，不参与crash恢复判断
- 不存在staging记录=无需处理

### importStaging target*Ids可靠性

每个状态下target*Ids的可靠性：

| 状态 | target*Ids可靠性 | 说明 |
|---|---|---|
| created | 不可靠 | target*Ids为空 |
| validated | 不可靠 | target*Ids为空 |
| remapped | 可靠（planned ids） | target*Ids已写入，但此时是计划写入的id，正式store中不存在对应数据 |
| previewed | 可靠（planned ids） | target*Ids可靠，但此时是计划写入的id，正式store中不存在对应数据 |
| committing | 可靠 | target*Ids可靠 |
| committed | 可靠 | target*Ids可靠 |
| recovery_error | 可靠 | target*Ids可靠（用于诊断），不允许自动重试 |

崩溃恢复：remapped/previewed阶段crash时，正式store中不存在任何panel/widgets/tasks/events，只需删除staging。committing及之后状态可依赖target*Ids和panel存在性判断。created/validated状态无部分数据需要清理。

### staging commit quota失败处理

- B段任何失败（包括quota）：staging保持committing，不运行时重试B段，下次启动按方案A恢复（panel存在→视为committed清理staging；panel不存在→强制child扫描，有child则recovery_error，无child则删除staging）
- A段失败：staging保持previewed，用户可重试
- C段失败：staging已committed，下次启动时清理staging记录
- quota模式禁止新导入，也不允许重试已有staging的commit

**quota模式下staging处理规则**：

- quota模式禁止从previewed重新执行新增型commit
- 允许清理staging
- 允许当targetPanelId已存在时完成committed cleanup
- 允许用户导出staging payload
- 用户释放空间并probe成功后，才允许重新导入（非重试旧staging）
- **quota模式下staging清理补充**：quota模式下扫描importStaging，如果存在未committed的大payload，提供"删除未完成导入缓存"入口。删除前允许导出staging payload。删除staging需要lease
- **quota模式下staging删除失败处理**：
  - 删除staging失败分类为quota_exceeded/transaction_abort/unknown
  - quota_exceeded：保持banner，提示用户关闭其他标签页或浏览器站点数据清理
  - transaction_abort：重试一次
  - unknown：保持banner

### import commit恢复规则（方案A：安全优先）

> **本段落是ImportStagingStateMachine唯一权威章节的展开说明，不是独立规则。如果本段落与ImportStagingStateMachine唯一权威章节冲突，以唯一权威章节为准。实现者应只引用ImportStagingStateMachine唯一权威章节。**

- 如果panel存在（targetPanelId在panels store中找到），视为成功，清理staging
- 如果panel不存在：使用targetWidgetIds/targetTaskIds/targetCalendarEventIds扫描正式store。如果任何target child存在，staging状态改为recovery_error，不允许自动重试，只允许导出诊断信息或删除staging；如果确认无target child存在，删除staging（用户需重新导入）；如果target ids缺失或损坏，staging状态改为recovery_error
- 正式store中出现目标id冲突，一律abort（不做same-batch skip，不做importBatchId匹配判断）
- committing恢复以panel是否存在为准：panel存在则视为committed；panel不存在则强制child扫描，按扫描结果决定

### 导入状态机唯一权威（ImportStagingStateMachine）

以下定义是导入状态机的唯一权威。所有其他段落提及导入状态机时只引用本节，不得另写行为。ImportStagingStateMachine包含：唯一枚举、唯一事件表、唯一恢复表、唯一错误表、唯一runtime event表。

**唯一枚举**：

```typescript
type ImportStagingState =
  | 'created'
  | 'validated'
  | 'remapped'
  | 'previewed'
  | 'committing'
  | 'committed'
  | 'recovery_error'
```

**唯一事件表**：见下方"完整状态转移表"。

**唯一恢复表**：见下方"crash恢复规则（唯一权威）"。

**唯一错误表**：见下方ImportRecoveryDerivedState定义。

**唯一runtime event表**：见下方"import B段运行时失败状态机"。

### 导入状态机权威附录

本附录合并所有散落的导入相关规则，为唯一权威段落。其他位置提及导入状态机时以本附录为准。

**完整状态转移表**（含前置条件/事务边界/成功后状态/失败后状态/runtime recovery/crash recovery/quota行为/readonly行为）：

| 状态 | 允许事件 | 前置条件 | 事务边界 | 成功后状态 | 失败后状态 | runtime recovery | crash recovery | quota行为 | readonly行为 |
|---|---|---|---|---|---|---|---|---|---|
| created | validate | staging写入成功 | 单条staging update | validated | 保留created，用户可重试 | N/A | 删除staging | 禁止新导入 | 禁止导入 |
| validated | remap | 校验通过 | 单条staging update | remapped | 保留validated，用户可重试 | N/A | 删除staging | 禁止新导入 | 禁止导入 |
| remapped | preview | remap完成，target*Ids已写入 | 单条staging update | previewed | 保留remapped，用户可重试 | N/A | 删除staging（正式store无数据） | 禁止新导入 | 禁止导入 |
| previewed | commit（用户确认） | preview展示完成+hash校验通过 | 三段式事务（A/B/C） | committed | A段失败→保留previewed可重试；B段失败→保留committing按错误类型处理 | B段失败按ImportRuntimeEvent处理 | panel存在→committed；panel不存在→扫描target*Ids，有child→recovery_error，无child→删除staging | B段quota→进入quota模式保留staging；禁止从previewed重新执行新增型commit | 禁止导入 |
| committing | detectCommittedNow, scanAndDecide | A段成功 | B段单事务commit | committed | B段失败按错误类型处理 | detectCommittedNow: panel存在→committed；scanAndDecide: 有child→recovery_error，无child→删除staging | 同runtime recovery | quota模式禁止重试B段 | 禁止导入 |
| committed | cleanup | B段成功 | 单条staging delete | (staging删除) | C段失败下次启动清理 | N/A | 清理staging记录 | 允许cleanup | 允许cleanup |
| recovery_error | exportDiagnostics, deleteStaging | committing+panel missing+有target child，或target ids缺失/损坏 | 单条staging update/delete | (staging删除) | N/A | N/A | staging保留，只允许导出诊断或删除 | 允许导出诊断和删除staging | 允许导出诊断 |

**幂等性声明**：所有状态转移均为幂等。重复validate不产生副作用；重复remap生成相同id映射（UUID v5确定性）；panel存在视为committed。

**crash恢复规则（唯一权威）**：

| crash时状态 | 正式store中是否存在数据 | 恢复动作 |
|---|---|---|
| created | 否 | 删除staging，不恢复导入流程 |
| validated | 否 | 删除staging，不恢复导入流程 |
| remapped | 否（target*Ids是planned ids，未写入正式store） | 删除staging，不恢复导入流程 |
| previewed | 否（同remapped） | 删除staging，不恢复导入流程 |
| committing | 不确定（按panel存在性判断） | panel存在→视为committed，清理staging；panel不存在→使用targetWidgetIds/targetTaskIds/targetCalendarEventIds扫描正式store，有child则recovery_error，无child则删除staging，target ids缺失或损坏则recovery_error |
| committed | 是 | 清理staging记录 |
| recovery_error | 可能存在部分child | staging保留，只允许导出诊断信息或删除staging，v2.1完整性检查器处理 |

**staging扫描必须使用`if (record.data.kind !== 'import_staging') continue`跳过非import_staging记录**。

### import B段运行时失败状态机（v2.0必须）

```typescript
type ImportRuntimeEvent =
  | 'commitSucceeded'
  | 'commitFailedQuota'
  | 'commitFailedAbort'
  | 'commitFailedUnknown'
  | 'detectCommittedNow'
  | 'deleteUncommittedStaging'
  | 'exportStagingPayload'
```

| 当前状态 | 事件 | 动作 |
|---|---|---|
| committing | commitSucceeded | committed→cleanup |
| committing | commitFailedQuota | 进入quota模式，保留staging，显示导出/删除缓存入口 |
| committing | commitFailedAbort | 立即执行detectCommittedNow |
| committing | commitFailedUnknown | 进入readonly，允许导出staging诊断 |
| committing | detectCommittedNow且panel存在 | 标记committed并cleanup |
| committing | detectCommittedNow且panel不存在且无child | 删除staging |
| committing | detectCommittedNow且有child | recovery_error |

### 导入安全

- 导入JSON永远不执行代码
- prototype pollution防护：迭代式扫描所有对象key，拒绝`__proto__`、`prototype`、`constructor`
- **prototype pollution后续构造约束**：
  - 导入对象不得直接Object.assign到普通对象
  - remap/repair过程中必须创建null-prototype plain object（Object.create(null)）或显式白名单构造
  - unknown state不得被merge到默认state
- 超大文件拒绝（File.size > 20MB，在parse前检查）
- JSON parse包裹try/catch，parse失败提示"文件格式错误"
- parse后立即节点计数（<=100000），超过拒绝导入
- 承认parse期间无法防止内存膨胀，但20MB文件大小限制大幅降低风险
- 深层嵌套拒绝（10层）
- 单字符串长度限制（10MB）
- 字段白名单严格校验
- unknown widgetType只显示placeholder，raw state保留
- DisabledMcpComponentManifest校验：白名单字段、字符串长度限制(256)、version非semver置0.0.0、name非法用widgetType、id非UUID时widgetId是UUID则用widgetId替代，widgetId也非UUID则生成稳定hash UUID（基于widgetId的UUID v5）。**DB旧数据读取时容忍非UUID；任何新生成、导入后持久化、导出输出中的DisabledMcpComponentManifest.id必须是UUID**
- BlobAssetManifest校验：fileName非空、mimeType合法
- **ExportBundleV1 schema版本兼容**：panel/task/calendarEvent的schemaVersion不支持时，整个导入拒绝并提示具体不兼容版本

### 导入schema强校验规则

导入时所有字段必须通过以下校验，不通过则拒绝导入：

| 字段/类型 | 校验规则 |
|---|---|
| 所有number字段 | `Number.isFinite`（拒绝NaN/Infinity） |
| width/height | 最小值20 |
| x/y | 范围-10000到10000 |
| zIndex | 范围0到9999 |
| timestamp（createdAt/updatedAt/startedAt/dueAt非null时等） | 范围0到4102444800000（2100年）。dueAt允许null，非null时才按范围校验。endedAt等可空时间字段同理：null合法，非null时按范围校验 |
| mood | 范围1-5 |
| date | 格式YYYY-MM-DD |
| title/note/description | 最大长度10000 |
| taskStatus | 只允许'todo'/'in_progress'/'done' |
| recordStatus | 只允许'active'/'pending_delete' |
| schemaVersion | 必须是正整数 |
| version（app v2导出的bundle） | 必须是正整数，非法拒绝导入 |
| version（legacy bundle，exportVersion不存在或为0） | 缺失或非法时修复为1而非拒绝 |
| unknown字段 | 已知结构层unknown字段拒绝；组件state内部由对应WidgetDefinition.validateState决定；unknown widget opaque state不做业务字段白名单 |
| 导入记录的PersistedRecord.version | 重置为1 |
| 导入记录的PersistedRecord.updatedAt | 由写入层重新生成 |
| 单个WidgetStateData JSON序列化后大小 | <= 2MB（包括unknown opaque state和legacyRaw），超过2MB的widget state在导入时剪枝规则：跳过widgetRecord、widgetState、BlobAssetManifest、DisabledMcpComponentManifest；targetWidgetIds不得包含该widget；preview显示originalWidgetCount和importedWidgetCount，新panel name提示"部分组件因数据过大已跳过"；manifest.originalWidgetCount保持原值用于审计；skippedWidgetCount记录跳过数；panel entity（tasks/events）不受影响（它们属于panel不属于widget）；addWarning；**taskList/agendaList被2MB剪枝时panel entity处理**：preview明确提示"任务/日程数据已导入，但入口组件被跳过，请手动添加taskList/agendaList"；v2.1再做自动补入口 |

### 导入校验边界

导入校验按区域采用不同策略，严格白名单仅适用于已知结构层：

| 区域 | 校验策略 |
|---|---|
| ExportBundle顶层结构 | 严格白名单，unknown字段拒绝 |
| PersistedRecord外壳 | 严格白名单 |
| 已注册widget的envelope.state | 调用对应importState/validateState |
| unknown widget的envelope.state | 不做结构白名单，只做安全扫描+大小限制+深度限制+prototype pollution扫描 |
| legacyRaw | 不做业务字段白名单，只做安全扫描+大小限制+深度限制+prototype pollution扫描 |
| DisabledMcpComponentManifest | 严格白名单 |

- prototype pollution scan对所有对象生效
- unknown字段拒绝只适用于已知结构层（ExportBundle顶层、PersistedRecord外壳、已注册widget的envelope.state、DisabledMcpComponentManifest）
- unknown widget的envelope.state和legacyRaw只做安全扫描，不做业务字段白名单校验
- **组件state内部的unknown字段由每个组件自己的importState/validateState处理**：全局扫描不适用于组件state内部

### 导入Remap硬规则

导入时所有id必须remap，禁止保留导入文件中的原始id作为正式id：

- **所有PersistedRecord.id都必须remap**：通过idMap映射，原始id不进入正式数据库
- **禁止保留导入文件中的原始id作为正式id**
- **所有data内引用字段同步remap**
- **WidgetStateRecord.id必须等于WidgetStateData.widgetId**（remap后两者保持一致）

需要remap的完整字段清单：

| 记录类型 | 需remap字段 |
|---|---|
| PanelRecord | panel.id |
| WidgetRecord | widgetRecord.id, widgetRecord.data.panelId |
| WidgetStateRecord | widgetState.id, widgetState.data.widgetId, widgetState.data.panelId |
| TaskRecord | task.id, task.data.panelId |
| CalendarEventRecord | calendarEvent.id, calendarEvent.data.panelId |
| BlobAssetManifest | BlobAssetManifest.widgetId |

**unknown widget opaque state与remap边界**：

- Remap硬规则仅适用于已知结构层和已知引用字段
- unknown widget opaque state视为不可解释payload，不承诺内部id remap
- opaque state不得参与任何运行时引用解析、查询、渲染或权限判断
- 显式修复前，内部原始id不得被当作正式id使用

---

## MCP权限与沙箱模型（v2.0：完全禁用模型）

v2.0 MCP策略：**完全不可执行placeholder**。不做半套沙箱。

- 已存在动态组件识别（通过widgetType前缀`mcp-`识别）
- placeholder展示（"此组件需要动态执行，当前版本不支持"）
- 不加载entry，不执行任何代码
- raw state保留在widgetStates store
- 导出保留DisabledMcpComponentManifest metadata（不含entry/permissions）
- 导入后仍禁用
- 不做iframe/worker执行沙箱
- 不做权限运行时检查（因为没有执行）

v2.0所有DisabledMcpComponentManifest的sandbox固定为'disabled'。iframe/worker沙箱放到v3+单独RFC。

### DisabledMcpComponentManifest来源

- 从widgetState中提取，提取优先级：WidgetStateData.legacyRaw?.mcpManifest > WidgetStateData.envelope.state?.mcpManifest > WidgetStateData.envelope.state?.manifest > fallback generated
- 提取过程只读，不得深merge，不得执行getter，不得保留额外字段
- **提取时禁止任何点访问式读取未知对象属性**，必须通过安全函数：
  ```typescript
  function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
    if (typeof value !== 'object' || value === null) return false
    if (Array.isArray(value)) return false
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
  }

  function safeOwnDataProp(obj: unknown, key: string): unknown | undefined {
    if (!isPlainObject(obj)) return undefined
    const desc = Object.getOwnPropertyDescriptor(obj, key)
    if (!desc) return undefined
    if ('get' in desc || 'set' in desc) return undefined
    return desc.value
  }
  ```
- **所有来源提取都必须通过safeOwnDataProp函数**，禁止直接点访问或方括号访问未知对象属性
- **提取只对plain object处理**（isPlainObject校验）：
  - typeof value === 'object' && value !== null 才处理
  - Array拒绝
  - Date/boxed object拒绝
  - prototype非Object.prototype或null拒绝
- 否则生成最小placeholder（id=widgetId, name=widgetType, version='0.0.0'）
- 提取规则：
  - 白名单字段：只提取id、name、version、sandbox，忽略其他字段
  - 字符串长度限制：所有字符串字段不超过256字符，超出截断
  - version非semver格式时置为'0.0.0'
  - name非法（空字符串或含控制字符）时用widgetType替代
  - id非UUID格式时：如果widgetId也是非UUID，生成稳定hash UUID（基于widgetId的UUID v5）；如果widgetId是UUID则用widgetId替代
- **normalizeDisabledMcpManifestId统一函数**（v2.0必须）：定义唯一函数处理所有路径的manifest id规范化：

  ```typescript
  function normalizeDisabledMcpManifestId(rawId: unknown, widgetId: string): string {
    if (typeof rawId === 'string' && isUuid(rawId)) return rawId
    if (isUuid(widgetId)) return widgetId
    return uuidV5(widgetId, MCP_LEGACY_WIDGET_ID_NAMESPACE)
  }
  ```

  - `isUuid`接受UUID v4和v5（检查格式8-4-4-4-12+variant/version bits合法）
  - 所有DisabledMcpComponentManifest.id生成/校验/导入规范化统一使用此函数
  - DB内旧数据允许非UUID（读取时容忍）
  - 新生成/新导出必须UUID
  - 导入legacy manifest立即规范化为UUID
  - 导出时必须规范化为UUID（非UUID的legacy id在导出时通过此函数转换）

---

## 16组件State Schema定义（v2.0必须）

每个组件的WidgetStateEnvelope.state必须符合以下schema。stateVersion=1。

```typescript
interface RichTextStateV1 {
  content: string
  schemaVersion: 1
}

interface ClockStateV1 {
  timezone: string
  format24h: boolean
  showSeconds: boolean
  schemaVersion: 1
}

interface PdfViewerStateV1 {
  fileName: string
  mimeType: string | null
  size: number | null
  lastPage: number
  needsReselect: boolean
  schemaVersion: 1
}

interface MusicPlayerStateV1 {
  playlistName: string
  fileName: string | null
  mimeType: string | null
  size: number | null
  needsReselect: boolean
  schemaVersion: 1
}

interface MarkdownEditorStateV1 {
  content: string
  schemaVersion: 1
}

interface StickerStateV1 {
  emoji: string
  label: string
  schemaVersion: 1
}

interface CountdownCardStateV1 {
  title: string
  targetDate: number
  schemaVersion: 1
}

interface QuoteCardStateV1 {
  text: string
  author: string
  schemaVersion: 1
}

interface FocusTimerStateV1 {
  currentTaskId: string | null
  lastSessionId: string | null
  activeSessionId: string | null
  displayMode: 'timer' | 'history'
  durationPreset: number
  soundEnabled: boolean
  theme: string
  schemaVersion: 1
}

interface TaskListStateV1 {
  displayMode: 'list' | 'board'
  filterTag: string | null
  schemaVersion: 1
}

interface NoteBlockStateV1 {
  content: string
  color: string
  schemaVersion: 1
}

interface StatsPanelStateV1 {
  displayMode: 'overview' | 'focus' | 'habits' | 'mood'
  chartType: 'bar' | 'line' | 'heatmap'
  selectedHabitId: string | null
  selectedMoodEntryId: string | null
  schemaVersion: 1
}

interface HabitTrackerStateV1 {
  selectedHabitId: string | null
  displayMode: 'grid' | 'list'
  schemaVersion: 1
}

interface MoodTrackerStateV1 {
  selectedMoodEntryId: string | null
  displayMode: 'calendar' | 'timeline'
  theme: string
  schemaVersion: 1
}

interface BreathingWidgetStateV1 {
  pattern: '4-7-8' | 'box' | 'relaxing'
  schemaVersion: 1
}

interface AgendaListStateV1 {
  displayMode: 'day' | 'week' | 'month'
  filterTag: string | null
  schemaVersion: 1
}
```

**workspace引用字段清除规则**（exportState/importState必须移除/清空）：
- FocusTimerStateV1：currentTaskId, lastSessionId, activeSessionId
- StatsPanelStateV1：selectedHabitId, selectedMoodEntryId
- HabitTrackerStateV1：selectedHabitId
- MoodTrackerStateV1：selectedMoodEntryId

**normalizeStateForSave规则**：title/label/author/emoji等短文本字段trim；**content类字段（richText.content/markdownEditor.content/noteBlock.content）不得trim**（会破坏前导空格/尾随换行/Markdown缩进/代码块）；emoji字段限制10字符；timezone必须是IANA标识符。

**validateState规则**：schemaVersion必须存在且为1；workspace引用字段允许null；displayMode必须是枚举值之一；content允许空字符串。**timezone校验**：使用`Intl.supportedValuesOf('timeZone')`校验（Chrome 99+支持）；不支持该API时接受任何非空string；允许`UTC`；非法timezone时validateState返回fallbackState（timezone='Asia/Shanghai'）+warning。

## 组件验收矩阵（按版本拆分）

### v2.0验收

| 组件 | 创建 | 编辑 | 刷新恢复 | 导出 | 导入 | 损坏降级 | Blob | workspace引用 |
|---|---|---|---|---|---|---|---|---|
| richText | ✅ | ✅ | ✅ | ✅ | ✅ | placeholder+保留raw | 无 | 无 |
| clock | ✅ | ✅ | ✅ | ✅ | ✅ | placeholder+保留raw | 无 | 无 |
| pdfViewer | ✅ | ✅ | placeholder(需重选) | manifest | 提示重选文件 | placeholder+保留raw | 有(内存) | 无 |
| musicPlayer | ✅ | ✅ | placeholder(需重选) | manifest | 提示重选文件 | placeholder+保留raw | 有(内存) | 无 |
| markdownEditor | ✅ | ✅ | ✅ | ✅ | ✅ | placeholder+保留raw | 无 | 无 |
| sticker | ✅ | ✅ | ✅ | ✅ | ✅ | placeholder+保留raw | 无 | 无 |
| countdownCard | ✅ | ✅ | ✅ | ✅ | ✅ | placeholder+保留raw | 无 | 无 |
| quoteCard | ✅ | ✅ | ✅ | ✅ | ✅ | placeholder+保留raw | 无 | 无 |
| focusTimer | ✅ | ✅ | ✅ | 配置only | 空状态+提示 | placeholder+保留raw | 无 | focusSessions(不导出) |
| taskList | ✅ | ✅ | ✅ | ✅含tasks | ✅含tasks | placeholder+保留raw | 无 | tasks(panel,导出) |
| noteBlock | ✅ | ✅ | ✅ | ✅ | ✅ | placeholder+保留raw | 无 | 无 |
| statsPanel | ✅ | 只读 | ✅ | 配置only | 重新聚合 | placeholder+保留raw | 无 | focusSessions(只读,不导出) |
| habitTracker | ✅ | ✅ | ✅ | 配置only | 空状态+提示 | placeholder+保留raw | 无 | habits(不导出) |
| moodTracker | ✅ | ✅ | ✅ | 配置only | 空状态+提示 | placeholder+保留raw | 无 | moodEntries(不导出) |
| breathingWidget | ✅ | ✅ | ✅ | ✅ | ✅ | placeholder+保留raw | 无 | 无 |
| agendaList | ✅ | ✅ | ✅ | ✅含events | ✅含events | placeholder+保留raw | 无 | calendarEvents(panel,导出) |

### v2.0删除行为

- **删除widget**：CAS把widgetRecord.recordStatus改为`pending_delete`，生成deleteToken+设置deleteExpiresAt(10秒后)。UI隐藏组件，显示10秒toast"已删除{组件名}"+撤销按钮。**撤销条件**（唯一权威）：record存在 + data.recordStatus==='pending_delete' + data.deleteToken===token + panel仍存在 + expectedVersion匹配（pending_delete后version不变，因为禁止其他写入）。cleanup hard delete必须读取当前记录，确认recordStatus=pending_delete且deleteExpiresAt<=now。deleteToken不匹配时撤销失败并提示"删除状态已变化"。同一记录pending_delete期间再次delete是no-op。10秒后background cleanup hard delete record+state+Blob。cleanup失败可重试。
- **删除panel**：删除panel优先级高于pending_delete撤销窗口。用户确认删除panel后，panel下所有active/pending_delete记录全部hard delete。**确认对话框必须包含**：panel名称、widget数量、task数量、calendar event数量、建议导出提示（quota模式下强制建议导出）。不要求输入panel名称确认（保持流畅）。**删除panel前dirty保护**：如果存在dirty/save_failed/conflicted状态，确认框必须要求用户选择：
  - 继续删除并放弃未保存修改
  - 取消删除
  - 先尝试保存
  sessionStorage draft标记pendingPanelDelete:{panelId}而非立即清除。事务成功后再清除draft。事务失败后可恢复draft。**panel删除事务前先关闭相关pending_delete toast**（标记为不可撤销）。**deletePanel确认后立即取消该panel下所有active SaveJob、清除debounce timer**。后续SaveJob执行前必须检查panel存在。确认后在同一个IndexedDB readwrite事务（storeNames: panels, widgetRecords, widgetStates, tasks, calendarEvents）中执行以下步骤：（1）ctx.get('panels', panelId)校验panel存在；（2）ctx.indexGetAll('widgetRecords', 'data.panelId', panelId)获取所有widgetRecords→收集widgetIds；（3）对每个widgetId调用locateWidgetStateByWidgetId(ctx, widgetId)：found→收集primaryKey，duplicate_conflict→收集全部candidates的primaryKey，missing→跳过；（3a）**额外扫描orphan widgetStates**：ctx.indexGetAll('widgetStates', 'data.panelId', panelId)获取所有按panelId索引的widgetStates→与步骤3收集的primaryKeys去重→未被覆盖的widgetState也收集primaryKey（这些是orphan：有panelId但无对应widgetRecord）；（4）ctx.deleteChecked('panels', {id: panelId})删除panel record；（5）批量deleteChecked widgetRecords（by widgetIds）；（6）批量deleteChecked widgetStates（按步骤3+3a收集的全部primaryKeys去重后删除）；（7）ctx.indexGetAll('tasks', 'data.panelId', panelId)+批量deleteChecked；（8）ctx.indexGetAll('calendarEvents', 'data.panelId', panelId)+批量deleteChecked。事务失败则整体回滚。事务只处理panel级数据（panel+widgetRecords+widgetStates+tasks+calendarEvents），不包含focusSession操作。**undo操作必须先检查panel存在**：panel不存在时undo失败，toast显示"面板已删除，无法恢复"。**panel删除失败后恢复toast**：重新扫描该panel的pending_delete记录，恢复仍未过期的撤销toast；如无未过期记录则显示明确toast"面板删除失败，部分组件仍处于待删除状态"。**toast关闭到事务执行之间存在短暂窗口**：页面崩溃时toast状态只在内存，启动cleanup会恢复或hard delete pending_delete记录。这是可接受窗口。
- **deletePanel大数据场景**：v2.0删除panel不做分批（分批违反原子性），性能不达标不blocking（数据安全优先于性能）。E2E测试覆盖50 widgets + 100 tasks + 100 events的删除场景。补充非性能阻断的数据安全测试：500 widgets+5000 tasks+5000 events删除事务完整性、中途abort回滚、quota下删除panel回滚。不要求P95，只要求事务完整性和页面不崩溃。**性能测试使用标准小状态fixture**（每条widgetState <10KB）。大状态（单条>100KB）只验事务完整性，不验30秒上限。Chrome latest下标准fixture允许耗时上限30秒。超过30秒算失败。UI显示loading+禁用关闭
- **panel删除失败后SaveJob/draft恢复**：panel删除事务失败时，被取消的SaveJob不恢复（用户需重新编辑），draft可从pendingPanelDelete标记恢复，提示"面板删除失败，草稿已恢复"
- **deletePanel事务失败精确恢复**：
  1. 重新读取panel是否存在
  2. 若panel存在：重新扫描pending_delete子项并恢复toast
  3. 若panel不存在：重新加载panel列表
  4. draft恢复策略：pendingPanelDelete标记的draft可恢复
  5. 错误分类进入retry/readonly/quota（通过classifyToIdbTransactionError统一分类）
- workspace级实体永远不随panel/widget删除
- 删除panel时，引用被删task的focusSessions保留，taskSnapshot.title保留快照（focusSession创建时必须永久写入taskSnapshot.title，不依赖删除时补写），taskSnapshot.deletedAt**可能**被异步补写（best-effort，不保证存在）
- **task删除补写策略统一合同**：所有task hard delete后（无论是panel删除还是单独删除）都走同一个合同：
  - task删除事务只删除task
  - 事务成功后异步CAS补写focusSessions的taskSnapshot.deletedAt=Date.now()
  - **taskSnapshot.deletedAt会在事务成功后尝试异步补写；可能缺失；仅用于展示增强**
  - **UI不得依赖该字段判断task是否存在，只能作为历史展示增强信息**
  - **补写失败不阻断任何操作**
  - **v2.0补写重试队列存内存（不建新store），刷新后丢失可接受**
  - **v2.1完整性检查器会兜底**
  - CAS version_conflict时跳过并加入内存重试队列
  - 补写失败不回滚task删除
  - startup cleanup中hard delete task时同理
  - **quota模式下taskSnapshot.deletedAt补写直接跳过**，仅console/debug记录，不进入用户保存失败状态
- 导入后workspace实体引用清空：focusTimer/habitTracker/moodTracker导入后所有workspace entity引用字段清空，显示空状态

### 实体删除合同

| 操作 | v2.0要求 |
|---|---|
| 删除task | toast撤销10秒（pending_delete状态） |
| 删除calendarEvent | toast撤销10秒（pending_delete状态） |
| 删除habit | 确认对话框，提示"历史打卡记录会保留在本地数据库中，但v2.0不提供查看入口"。hard delete habit记录（单事务，只删habits store），habitCheckins保留（habitId变dangling），statsPanel聚合时跳过dangling habitId，v2.1完整性检查器处理dangling checkins。需要lease。quota模式允许。**habit无recordStatus字段，quota模式hard delete使用deleteChecked with expectedFields={'id':habitId}（只校验id存在，不校验recordStatus）**。 |
| 删除moodEntry | toast撤销10秒（pending_delete状态） |
| 删除focusSession | 普通模式不提供删除入口（历史记录不可改）。quota模式允许按时间范围删除（需preview数量+建议导出+二次确认+单事务+不可撤销）。 |

**focusSession生命周期边界**（v2.0必须）：
- focusSession是历史权威数据，创建后不可编辑内容（只读展示）
- focusTimer组件编辑的是WidgetState（displayMode等配置），不直接编辑focusSession
- focusSession SaveJob不存在——focusSession只在focusTimer组件"结束专注"时创建（addNew），创建后不修改
- focusSession补写（taskSnapshot.deletedAt）是唯一写操作，独立异步，不创建SaveJob
- 普通模式不提供删除入口，quota模式允许按时间范围删除
- 用户不能编辑历史focusSession的任何字段

### 启动时pending_delete清理算法

应用启动时执行以下清理：

1. **扫描widgetRecords**：查询所有`recordStatus='pending_delete'`的记录
2. **检查deleteExpiresAt**：
   - 未过期（`deleteExpiresAt > Date.now()`）：保留记录，UI显示剩余撤销时间的toast
   - 已过期（`deleteExpiresAt <= Date.now()`）：执行hard delete
3. **扫描实体stores**（tasks/calendarEvents/moodEntries）：查询所有`recordStatus='pending_delete'`的记录
4. **检查deleteExpiresAt**：
   - 未过期：保留记录，UI显示撤销toast
   - 已过期：执行hard delete
5. **hard delete步骤**（widget）：删除widgetRecord + widgetState + 内存Blob引用
6. **hard delete步骤**（实体）：删除实体记录本身。如果是task，事务只删除task，事务成功后异步best-effort CAS补写focusSessions.taskSnapshot.deletedAt（quota模式跳过补写）

**focusSession.taskSnapshot.deletedAt补写操作合同**：
- 触发者：task hard delete事务成功后的异步回调
- 何时触发：task hard delete成功后立即调度
- 是否CAS：是，必须putCas，version_conflict时跳过
- 是否需要lease：否（后台异步操作）
- 是否进入SaveJob：否（独立异步操作，不参与ResourceSaveState）
- quota模式：跳过补写
- 失败处理：console.error记录，加入内存retry queue（刷新后丢失可接受）
- 多标签冲突：CAS兜底
- UI不得依赖该字段判断task是否存在
- **focusSession补写并发边界**（v2.0必须）：
  - focusSession不存在SaveJob（创建后不可编辑，补写是唯一写操作）
  - 补写操作可能与其他tab的补写操作并发（多标签页同时检测到task hard delete）
  - 补写使用putCas，只修改taskSnapshot.deletedAt字段，不修改其他字段
  - 如果补写时version_conflict：跳过，加入内存retry queue，等下次用户操作时重试
  - **补写是best-effort**：如果补写永远失败（持续version_conflict），不影响任何功能，仅缺失展示增强信息
7. **清理失败**：记录到console.error，下次启动重试

### pending_delete全局查询规则

| 场景 | 是否包含pending_delete |
|---|---|
| 普通UI列表 | 否 |
| widget渲染 | 否 |
| taskList/agendaList/moodTracker | 否 |
| statsPanel聚合 | 否 |
| 导出 | 否（普通导出排除pending_delete，诊断导出包含） |
| 删除panel | 是 |
| 启动cleanup | 是 |
| 撤销toast | 是 |
| 完整性检查 | 是 |

### v2.2验收（延后项）

- softDelete+回收站
- 删除恢复
- 布局级撤销

---

## 测试矩阵（含expected behavior）

### v2.0必测失败路径

| 场景 | 前置 | 预期 |
|---|---|---|
| IndexedDB open失败 | mock idb.open抛出 | 全局提示"无法访问本地存储"，进入只读模式 |
| IndexedDB put失败 | widget A编辑到S2，mock put抛出 | UI显示"保存失败"，widget显示S2，dirty=true，version不变，重试后成功（重试用同一snapshot） |
| IndexedDB upgrade失败 | mock IDBDatabase.onupgradeneeded抛出 | 进入只读模式，提示"数据库升级失败" |
| JSON parse失败 | 导入损坏JSON | 提示"文件格式错误"，不影响现有数据 |
| 导入文件超大 | File.size > 20MB | 拒绝导入，提示"文件过大"，不进入parse |
| widgetState缺失 | widgetRecord存在但state不存在 | 显示placeholder"组件数据缺失"+导出按钮 |
| widgetType未注册 | widgetState的widgetType不在registry | 显示placeholder"未知组件类型"+导出按钮，raw state保留 |
| stateVersion不支持 | envelope的stateVersion > 当前代码版本 | 显示placeholder"组件版本不兼容"+导出按钮，raw state保留 |
| import文件字段缺失 | JSON缺少必要字段 | 提示具体缺失字段，拒绝导入 |
| import文件ID冲突 | 导入文件widgetId与现有重复 | 自动remap，不影响现有数据 |
| 组件render throw | mock组件throw | ErrorBoundary捕获，显示render_error+重试+导出按钮+删除按钮，其他组件不受影响 |
| 页面刷新时有dirty state | 编辑后1秒内刷新 | 刷新后从IndexedDB恢复最新保存的state，检测sessionStorage draft提示恢复 |
| composition期间快捷键 | 中文输入法composing时按Delete | 不触发删除操作 |
| prototype pollution | 导入JSON含__proto__键 | 拒绝导入，提示"文件包含不安全字段" |
| 删除widget后撤销 | 删除widget后10秒内点撤销 | widget恢复原位置和state（status改回active） |
| 删除widget后刷新 | 删除widget(pending_delete)后刷新 | pending_delete记录仍在DB，启动时检查deleteExpiresAt，未过期继续显示toast，已过期执行hard delete |
| 删除panel | 点击删除panel | 弹出确认对话框，确认后删除 |
| legacy数据加载 | 旧版widgetState无Envelope | 自动包装为Envelope，保留legacyRaw，正常渲染 |
| legacy数据包装失败 | 旧版widgetState无法包装 | 进入invalid状态，显示placeholder+导出按钮 |
| 两标签页同时保存 | 标签页A和B同时编辑同一widget | 后提交者CAS冲突，toast提示"数据冲突，请刷新" |
| 创建widget部分失败 | widgetRecord写入成功、widgetState写入失败 | 事务回滚，widget不存在 |
| 导入staging崩溃 | staging写入后浏览器崩溃 | 下次启动扫描清理orphan staging |
| 删除task | taskList中删除task | toast撤销10秒 |
| 删除habit | habitTracker中删除habit | 确认对话框，habitCheckins保留 |
| Blob刷新丢失 | pdfViewer选择文件后刷新 | 显示placeholder"请重新选择文件"+文件名提示 |
| validateState fallback不写回 | validateState失败后 | raw state保留在DB，fallbackState只用于渲染placeholder，不写回DB |
| ErrorBoundary导出raw | render_error时点导出 | 成功导出raw state |
| quota exceeded | IndexedDB写入超限 | 全局banner"存储空间不足"，进入quota受限模式：允许hard delete（事务内条件删除，需二次确认）和导出，禁止新建/编辑/pending_delete/导入 |

### deleteChecked测试矩阵（v2.0必测）

| 场景 | 前置 | 预期 |
|---|---|---|
| deleteChecked正常删除 | record存在，expectedFields匹配 | 删除成功，无错误 |
| deleteChecked expectedFields不匹配 | record存在，data.recordStatus!='pending_delete' | throw DeleteCheckedError(kind='field_mismatch')，记录保留 |
| deleteChecked record不存在 | id对应的record不存在 | throw DeleteCheckedError(kind='not_found') |
| deleteChecked version不匹配 | expectedVersion与record.version不同 | throw DeleteCheckedError(kind='version_mismatch') |
| deleteChecked fieldPredicates lte | deleteExpiresAt=1000, fieldPredicates={'data.deleteExpiresAt':{op:'lte',value:2000}} | 删除成功（1000<=2000） |
| deleteChecked fieldPredicates lte不满足 | deleteExpiresAt=3000, fieldPredicates={'data.deleteExpiresAt':{op:'lte',value:2000}} | throw DeleteCheckedError(kind='field_mismatch')，记录保留 |
| deleteChecked嵌套字段访问 | expectedFields={'data.recordStatus':'pending_delete'} | 正确读取嵌套字段，匹配则删除 |
| deleteChecked中间路径非plain object | data.field是数组，expectedFields={'data.field.sub':'value'} | 视为不匹配，throw DeleteCheckedError(kind='field_mismatch') |
| deleteChecked undo场景 | pending_delete后undo，deleteChecked with expectedFields={'data.recordStatus':'pending_delete'} | 删除成功（undo通过putCas恢复active） |
| deleteChecked cleanup过期记录 | deleteExpiresAt<=now，fieldPredicates lte通过 | 删除成功 |
| deleteChecked cleanup未过期记录 | deleteExpiresAt>now，fieldPredicates lte不通过 | throw DeleteCheckedError(kind='field_mismatch')，记录保留，toast继续显示 |

### orphan state诊断测试场景（v2.0必测）

| 场景 | 预期 |
|---|---|
| widgetState.primaryKey!=data.widgetId | locateWidgetStateByWidgetId返回found+needsRepair=true，显示诊断placeholder |
| canonical+duplicate同时存在 | locateWidgetStateByWidgetId返回duplicate_conflict，显示诊断placeholder"组件数据冲突" |
| deleteWidget删除全部候选 | locateWidgetStateByWidgetId返回duplicate_conflict→确认后删除全部candidates的primaryKey |
| deletePanel删除全部候选 | deletePanel对每个widgetId调用locateWidgetStateByWidgetId，found/duplicate_conflict/missing全部正确处理 |
| export检测duplicate_conflict走诊断导出 | 导出时检测到duplicate_conflict走诊断导出路径，导出全部候选记录 |

### v2.0必测正常路径

- 16组件创建/编辑/刷新恢复
- 导出当前panel为JSON
- 导入JSON为新panel
- 拖拽/resize不触发输入冲突
- 保存失败可重试
- 损坏widgetState显示placeholder+保留raw
- legacy数据自动迁移为Envelope
- sessionStorage draft恢复

### 导入崩溃恢复测试场景（v2.0必测）

| 场景 | 预期 |
|---|---|
| created -> crash | 下次启动清理staging，无部分数据 |
| validated -> crash | 下次启动清理staging，无部分数据 |
| remapped -> crash | 下次启动删除staging（remapped阶段正式store中不存在任何panel/widgets/tasks/events，无正式数据需要清理） |
| previewed -> crash | 下次启动删除staging（previewed阶段正式store中不存在任何panel/widgets/tasks/events，无正式数据需要清理） |
| committing before commit -> crash | 下次启动检查targetPanelId不存在，扫描target*Ids对应正式store，无child则删除staging，有child则进入recovery_error |
| commit success before staging delete -> crash | 下次启动targetPanelId存在，视为committed，清理staging |
| commit quota abort -> crash | 下次启动staging为committing，targetPanelId不存在，扫描target*Ids对应正式store，无child则删除staging，有child则recovery_error |
| committing + targetPanelId exists | 视为committed，清理staging |
| committing + targetPanelId missing | 扫描target*Ids对应正式store，无child则删除staging，有child则recovery_error |
| target*Ids corrupted | 进入recovery_error诊断，仅允许导出诊断信息，v2.1完整性检查器处理 |
| staging expiresAt expired while committing | 仍按committing状态恢复（expiresAt不覆盖committing状态的恢复逻辑） |

### 测试环境定义

- 设备：主流笔记本（8GB+ RAM，SSD）
- 浏览器：Chrome latest stable（v2.0仅以桌面Chrome latest stable作为支持目标，仅支持mouse/pointer primary button交互，touch交互不作为验收范围。high DPI下坐标normalize。其他浏览器不作为发布阻断验收对象）
- build：production build
- React StrictMode：开启
- FPS采样：requestAnimationFrame计算，5秒平均
- P95样本数：>=20次操作
- IndexedDB：不mock（E2E），mock（单元测试用fake-indexeddb）
- 30组件组合：8richText+4clock+2taskList+2markdownEditor+2noteBlock+2sticker+2countdownCard+2quoteCard+1focusTimer+1habitTracker+1moodTracker+1statsPanel+1breathingWidget+1agendaList
- 性能不达标=blocking，不得发布

---

## 运行时数量上限（v2.0）

- 单panel widget上限：500（数据安全上限，不是性能承诺。v2.0性能承诺仅覆盖30组件组合）
- 单panel task上限：5000
- 单panel calendarEvent上限：5000
- 单widgetState JSON序列化后上限：2MB
- 单panel导出文件上限：20MB

超出上限时创建操作toast提示"已达上限"。

---

## 性能底线（v2.0）

| 指标 | 目标 | 测量方式 | 不达标处理 |
|---|---|---|---|
| 菜单打开 | P95 < 100ms | 从点击到菜单可见 | blocking |
| 添加组件 | P95 < 300ms | 从点击到组件渲染 | blocking |
| 文本输入延迟 | P95 < 50ms | 从按键到字符显示 | blocking |
| 30组件拖拽FPS | >= 45 | 5秒平均，上述组件组合 | blocking |
| 保存状态切换 | < 200ms | 从dirty到saved的UI更新 | blocking |

---

## 实现复杂度预算

> 以下为各核心合同的预估实现代码行数（不含测试），用于评估v2.0总体工作量合理性。

| 合同 | 预估行数 | 说明 |
|---|---|---|
| IdbTxContext + runIdbTransaction | 300-400 | 核心事务封装，含ctx方法+错误分类+fnResolved检测 |
| StoreSchemaContract × 10 stores | 200-300 | 每个store约20-30行，validateData+readCompat |
| WidgetDefinitionV2A × 16 widgets | 400-600 | 每个widget约25-40行，validateState+normalizeStateForSave |
| SaveJob + ResourceSaveState | 200-300 | 状态机+队列+conflict恢复 |
| EditorLease | 100-150 | heartbeat+acquire+release |
| 导入导出（staging+remap+commit） | 400-600 | 7态状态机+UUID v5+canonical JSON+hash |
| CAS + toStorageWriteOutcome | 50-80 | 适配器+映射 |
| deleteChecked + getNestedValue | 80-120 | 路径解析+校验+DeleteCheckedError |
| WidgetStateLocator | 100-150 | 双索引查询+缓存+primaryKey强校验 |
| 诊断系统 | 150-250 | DiagnosticIssueKind+OperationCapability+canExecute |
| UI层（ErrorBoundary+placeholder+toast+diff） | 300-500 | 渲染层+用户交互 |
| **总计** | **2300-3300** | 不含测试代码（测试约等量） |

- **复杂度控制原则**：任何单个合同超过500行需拆分；任何单个函数超过50行需拆分
- **v2.0a最核心**：IdbTxContext + StoreSchemaContract + WidgetDefinitionV2A ≈ 900-1300行
- **v2.0b增量**：SaveJob + EditorLease + CAS + deleteChecked ≈ 430-530行
- **v2.0c增量**：导入导出 + WidgetStateLocator + 诊断 ≈ 650-1000行
- **v2.0d增量**：UI层 + 全验收 ≈ 300-500行

## 版本内容

**v2.0阶段发布策略**：v2.0a/b/c/d都是内部里程碑，不可用户发布。只有v2.0d验收通过后才可发布。

**v2.0分阶段验收边界表**：

| 阶段 | 必须完成 | 不验收 |
|---|---|---|
| v2.0a | 16组件创建/编辑/validate/normalize/envelope保存/legacy migration/ErrorBoundary | 导入导出 |
| v2.0b | IDB事务/CAS/SaveJob/dirty/draft/delete/pending_delete/EditorLease | 复杂导入 |
| v2.0c | 导入导出/staging/recovery/opaque/ExportableWidgetDefinition | MCP执行 |
| v2.0d | 全验收矩阵通过/E2E/性能/production build | AI/MCP执行/连线/绘画 |

> "v2.0必须"条款按阶段拆分：v2.0a只验收存储合同，v2.0b只验收保存合同，v2.0c只验收导入导出合同，v2.0d验收全部。

### v2.0a：存储合同（3-4周）
- WidgetStateEnvelope（16组件全部包装）
- WidgetDefinitionV2A最小版（6个成员，其中3个方法，16组件全部实现）
  - validateState/createDefaultState/normalizeStateForSave必须真实实现
- StoreSchemaContract（每个实体store定义currentSchemaVersion+supportedSchemaVersions+version gate）
- PersistedRecord + 完整Record类型（含WidgetStatus/ImportStagingData）
- Legacy数据lazy migration（LoadedWidgetState联合类型，legacyRaw显式字段）
- WidgetRenderStatus分层（5层，ErrorBoundary只负责render_error）
- 单widget ErrorBoundary
- MCP完全禁用模型（DisabledMcpComponentManifest，不含entry/permissions）
- 最小IndexedDB migration（onupgradeneeded+幂等+失败只读）
- 只支持现有数据加载，不做导入导出

### v2.0b：保存合同（3-5周）
- CAS协议
- 跨Store事务API（runIdbTransaction+高层操作封装，方案B允许await ctx方法）
- 事务安全测试覆盖（连续await读写/事务abort/事务超时）
- SaveJob状态机（只允许replace payload，重试用同一snapshot，状态转换表）
- dirty UI + 保存状态展示
- sessionStorage draft策略
- 多标签best-effort EditorLease
- 自动保存规则（debounce/composition/layout-state分离）
- 修复noteBlock + 菜单滚动搜索分类 + 透明组件标识 + 鼠标反馈
- 最小输入事件守卫

### v2.0c：导入导出合同（5-8周）
- ExportManifest/BlobAssetManifest/DisabledMcpComponentManifest拆分
- 导出当前panel为JSON
- 导入JSON为新panel（File.size→parse→迭代式pollution扫描→staging→remap→preview→确认）
- importStaging含严格可观察状态机（created→validated→remapped→previewed→committing→committed→recovery_error，7态）
- **ExportableWidgetDefinition升级**（v2.0a只实现WidgetDefinitionV2A（6成员3方法，不含exportState/importState）。v2.0c新增exportState/importState两个方法，升级为ExportableWidgetDefinition。注册表拆分为runtimeWidgetRegistry和exportableWidgetRegistry，v2.0c验收时要求16个组件全部进入exportableWidgetRegistry。测试禁止stub函数名——exportState/importState必须是真实实现，不得以函数名stub方式通过验收）
- 导入schema强校验规则（Number.isFinite/范围/枚举/unknown字段拒绝/版本重置）
- 删除widget pending_delete机制（10秒撤销+background cleanup）
- 删除panel确认对话框（跨Store事务+toast竞态处理）
- 实体删除合同（task/event toast撤销，habit确认，moodEntry toast撤销）
- workspace实体引用降级（taskSnapshot创建时写入/导入后引用清空）
- Blob策略（内存only，刷新后placeholder）+ RuntimeBlobRegistry生命周期合同
- unknown widget opaque恢复最小合同（importedAsOpaqueUnknown+修复流程）

### v2.0d：验收（3-4周）
- 16组件验收矩阵全部通过
- 测试矩阵全部通过（含并发/崩溃路径）
- 性能底线全部通过
- E2E测试
- production build验证

### v2.1：数据可靠性（6-10周）
- migrateState/cloneState
- IndexedDB migration框架完整版（backup+dry-run+verify+rollback+幂等，基于StoreSchemaContract.migrateToCurrentWithPlan）
- staging import完善
- 完整性检查器
- 损坏隔离（先备份raw再placeholder）
- 孤儿清理

### v2.2：操作安全（6-8周）
- softDelete + 回收站（删除widget只softDelete record保留state；删除panel softDelete record保留state和workspace实体；workspace实体永远不随panel删除；自动purge默认关闭需用户手动开启；purge log保留30天；恢复时status改回active；原panel不存在时提示选择目标panel）
- purgeLogs store在此版本migration中创建
- 布局级撤销（只做拖拽/resize短期布局撤销，不碰state）
- 删除操作通过回收站恢复（不做通用state undo）
- 快捷键路由器
- 命令面板极简版

### v2.3：性能体验（3-5周）
- 性能基线（50组件FPS>=30）
- 懒加载
- 轻量引导
- 生活平衡模板

---

## 远期探索

v3+功能一律另立RFC，不进入v2设计约束。

---

## 排期总览

| 版本 | 估算 |
|---|---|
| v2.0a | 3-4 周 |
| v2.0b | 3-5 周 |
| v2.0c | 5-8 周 |
| v2.0d | 3-4 周 |
| v2.1 | 6-10 周 |
| v2.2 | 6-8 周 |
| v2.3 | 3-5 周 |
| **总计** | **30-43 周** |

---

## 审核历程

| 轮次 | 结论 | 主要问题 |
|---|---|---|
| 第1轮 | ❌ | MVP过大、AI/绘画/连线/学习组件同时做风险太高 |
| 第2轮 | ❌ | 仍贪心，DrawingBoard/连线/AI应全砍 |
| 第3轮 | ❌ | 缺数据ownership模型、缺组件验收、缺migration策略 |
| 第4轮 | ❌ | v2仍试图同时做7件事，必须拆版本 |
| 第5轮 | ❌ | 导出自相矛盾、v2.0缺Envelope必返工、MCP安全不完整、自动保存缺版本/队列/冲突策略、测试不足、排期偏乐观、导入合并覆盖过早、撤销定义混乱、多标签页缺失、验收矩阵无标准 |
| 第6轮 | ❌ | SaveJob缺状态机/payload、CAS协议未定义、v2.0/v2.1边界不闭合、导入导出语义与验收矩阵冲突、MCP半套安全模型比没有更危险、ErrorBoundary降级未定义、unknown widget导入策略不完整、manifest缺安全schema、导入缺size/depth/count limit、性能指标缺测试环境、workspace数据权限模型不足、validate失败可能静默丢数据、v2.0 MCP应完全禁用不做半套、冻结升级缺依赖治理、测试矩阵缺expected behavior、验收矩阵应按版本拆分 |
| 第7轮 | ❌ | "不丢数据"与hard delete无确认冲突、manifest模型混乱、v2.0缺legacy数据迁移路径、validateState失败时编辑处理未定义、exportState/importState缺上下文、DataScope太粗、workspace实体引用dangling、purgeLogs违反按需引入、ErrorBoundary与状态降级混在一起、导入size检查顺序错、prototype pollution缺具体规则、性能指标缺失败处理、技术栈缺版本快照、排期4-6周严重不可信 |
| 第8轮 | ❌ | Blob持久化/刷新恢复矛盾、SavePayload.latest会丢用户编辑、dirty draft恢复不可实现、CAS缺create/delete/batch跨store事务、删除widget先删再靠内存恢复不可靠、WidgetStatus缺pending_delete、legacyRaw类型定义冲突、staging缺崩溃恢复、MCP manifest保留entry无意义、实体删除缺撤销/确认、focusSession taskSnapshot维护时机不明、updatedAt双字段排序语义不明、测试矩阵缺并发/崩溃路径 |
| 第9轮 | ❌ | 实体删除schema缺EntityStatus/deleteToken/deleteExpiresAt/deletedAt、TaskData的taskStatus与recordStatus未分开、所有实体缺schemaVersion、ExportBundleV1未定义完整结构、ImportStaging缺崩溃恢复可判定字段、SaveJob缺同标签页自冲突解决、CAS缺事务内create/update/delete API、deletePanel缺workspace引用补全（focusSession.taskSnapshot.deletedAt）、ResourceKind含blobAsset但v2.0 Blob不持久化、quota exceeded应改为写入受限模式、unknown widget与MCP disabled widget边界不明、缺startup pending_delete cleanup算法、EditorLease只读模式边界不明、导出应含WidgetStateData非纯Envelope、ImportStagingData.payload类型为unknown不安全 |
| 第10轮 | ✅ | IndexedDB索引路径未加data.前缀、实体状态字段命名不统一（WidgetStatus/EntityStatus/recordStatus/entityStatus混用）、EditorLease只读模式允许删除操作矛盾、导入commit未明确单事务原子性、WidgetStateRecord.id与widgetId关系未强制、legacy lazy migration缺状态机（何时写DB/何时导出/validate失败处理）、quota受限模式缺具体行为定义、DisabledMcpComponentManifest来源未定义、BlobAssetManifest.widgetId导入未remap、unknown widget导出导入语义不完整、ExportBundleV1缺schema版本兼容策略、updatedAt排序语义未区分UI/组件、focusSession taskSnapshot.deletedAt更新无best-effort声明 |
| 第11轮 | ✅ | 导入panel可见性依赖importBatchId过滤（commit前panel不应写入、importBatchId仅审计用）、createRecordInTx缺id参数（id应由调用方生成）、导入remap规则不完整（缺硬规则和完整字段清单）、legacyWrappedAt误归入envelope（属于WidgetStateData）、删除panel事务含focusSession操作（应异步补写）、runIdbTransaction缺实现约束（禁止非IDB异步操作）、quota受限模式缺完整合同（进入/退出条件/允许禁止操作/hard delete规则）、导入安全File.size限制过大(50MB→20MB)、DisabledMcpComponentManifest提取缺白名单和容错规则、DeletableEntityData创建缺recordStatus:'active'默认值、updatedAt排序语义未按资源类型区分、panel存在即active无recordStatus（删除"active panel"说法） |
| 第12轮 | ✅ | SaveJob dirty状态机在有latestQueuedSnapshot时误报已保存（需ResourceSaveState六态+严格dirty=false判定）、unknown widget导入envelope内部引用未隔离（需importedAsOpaqueUnknown+opaque标记+显式修复流程）、IndexedDB事务暴露裸IDBTransaction给业务层（改为IdbTxContext封装+ctx.add用IDBObjectStore.add）、quota hard delete缺并发保护（需lease+version确认+限定可删除范围）、createRecordInTx重复id行为未定义（ctx.add id已存在事务abort）、pending_delete全局查询规则未统一（补完整9场景表格）、panel删除未覆盖pending_delete子记录（优先级高于撤销窗口+toast必须关闭）、deleteToken语义未闭环（undo需匹配id+version+token+cleanup需确认状态+重复delete no-op）、importStaging的created*Ids生命周期未更新（remap后commit前必须更新）、focusSession补写缺CAS（version_conflict跳过+加入重试队列）、legacyRaw与quota模式未定义（普通不清理/quota允许显式压缩需二次确认+导出提示）、DisabledMcpComponentManifest提取优先级未定义（4级优先级+只读不深merge）、workspace组件导出时引用未清空（exportState移除+importState强制清空）、v2.0a exportState/importState边界不清（stub不得接入UI/v2.0c必须完整验收） |
| 第13轮 | ✅ | 硬目标"不丢数据"不可验收改为可验证合同列表、实体store缺StoreSchemaContract（v2.0必须定义currentSchemaVersion+supportedSchemaVersions+version gate）、IndexedDB事务模型未闭合（改为方案B允许await ctx方法+microtask约束+事务安全测试覆盖）、importStaging状态机不严格（改为7态可观察状态机created→validated→remapped→previewed→committing→committed→cleanup_done）、SaveJob缺状态转换表（补6状态转换表）、task删除补写策略不统一（panel删除和单独删除统一合同）、quota模式压缩legacyRaw缺完整合同（CAS+仅删字段+按widget粒度+自动备份）、WidgetDefinition缺类型层隔离（拆为WidgetDefinitionV2A+ExportableWidgetDefinition分阶段）、unknown widget opaque恢复缺最小合同（修复流程+自动备份）、导入缺schema强校验规则（Number.isFinite/范围/枚举/unknown字段拒绝/版本重置）、Blob缺独立生命周期合同（RuntimeBlobRegistry+pending_delete保留+hard delete清除）、panel删除toast竞态未处理（事务前关闭toast+undo检查panel存在+失败不恢复toast） |
| 第14轮 | ✅ | WidgetRecordData/WidgetStateData缺schemaVersion（补齐所有store的schemaVersion字段）、导入校验边界未拆分（新增6区域校验策略表：ExportBundle顶层/PersistedRecord外壳严格白名单、已注册widget envelope走importState/validateState、unknown widget envelope/legacyRaw只做安全扫描+大小+深度+prototype pollution、DisabledMcpComponentManifest严格白名单）、IndexedDB事务API缺强制保障（Branded TxPromise类型+runtime tx.active guard+validator必须在事务前执行+eslint rule禁止await非TxPromise+事务闭包禁止外部async测试覆盖）、importStaging cleanup_done状态冗余（删除cleanup_done改为6态、committed后允许删除staging、staging不存在即cleanup完成）、focusSession.taskSnapshot.deletedAt暗示强一致（改为best-effort异步补写字段+UI不得依赖+补写失败不阻断+v2.0内存重试队列+v2.1完整性检查器兜底）、缺统一IDB错误分类（新增IdbErrorKind 6种+classifyIdbError函数+所有写路径统一分类进入对应模式）、v2.0a文案"5个方法"错误（改为5个成员其中2个方法）、ExportableWidgetDefinition缺分阶段CI检查（注册表拆分runtimeWidgetRegistry+exportableWidgetRegistry+v2.0c验收16组件全部进入exportableWidgetRegistry+测试禁止stub函数名）、panel删除失败后toast恢复策略不明（重新扫描pending_delete恢复未过期撤销toast或显示明确失败toast）、quota模式缺删除panel合同（允许quota模式删除panel+二次确认+建议导出+持有lease+直接hard delete+含active和pending_delete子记录+失败部分失败toast+不创建撤销toast）、legacyRaw压缩非best-effort（压缩是best-effort+主要释放路径仍是hard delete+压缩失败不得阻塞导出和删除）、EditorLease暗示强互斥（明确两个标签页短时间都进入可编辑状态允许+CAS兜底）、ID生成规则未定义（crypto.randomUUID+降级timestamp+random+旧数据非UUID首次编辑重写+DisabledMcpComponentManifest id校验一致）、旧数据WidgetStateRecord.id不一致处理缺失（以data.widgetId为准+lazy repair首次编辑重写+导出用data.widgetId+不进入invalid）、importStaging payload空间压力未定义（staging写入quota失败提示存储不足+不降低文件大小限制+不预估剩余空间+不压缩payload）、quota模式错误识别路径不全（runIdbTransaction内QuotaExceededError也必须触发全局quota模式+通过classifyIdbError统一处理） |
| 第15轮 | ✅ | 致命5+严重14：旧数据ID自动重写改为legacy id兼容（legacy id允许存在+不做跨实体自动ID重写+新数据必须UUID+导入必须remap为UUID+只有WidgetStateRecord.id与data.widgetId不一致允许lazy repair+ID生成降级为RFC4122 v4 fallback+crypto.getRandomValues也没有则只读模式）、Migration preflight协议（完整upgrade preflight流程5步+删除"可选导出备份"模糊说法）、IndexedDB事务API虚假保障（tx.active是内部自定义flag不是浏览器属性+静态保障依赖ESLint+运行时只能捕获部分违规+tx.oncomplete早于fn resolve视为事务闭包违规进入transaction_failed+删除branded TxPromise过度声明+明确TypeScript类型系统无法完全阻止违规await）、Quota hard delete改为事务内条件删除（不做version递增但必须在同一readwrite事务内get+校验+delete+校验失败返回version_conflict或state_changed+不允许盲删+删除"不要求CAS直接delete"说法）、version导入校验顺序（非法→拒绝导入+合法→重置为1+先校验后重置）、ctx方法microtask表述修正（删除microtask保证说法+改为事务闭包只允许线性await ctx方法+ESLint+CI强制）、schemaVersion加载判定pipeline（WidgetState 7步判定+WidgetRecord判定）、importStaging created*Ids可靠性（6状态可靠性表+崩溃恢复规则）、staging commit quota失败处理（保留staging+进入quota模式+可重试commit）、SaveJob手动重试顺序（latestQueuedSnapshot优先+baseVersion取内存版本）、snapshot equality定义（normalizeStateForSave+canonical JSON+v2.0a要求16组件实现）、legacyRaw压缩后状态标记（legacyRawDroppedAt时间戳+导出声明+placeholder导出+修复失败备份）、unknown widget opaque恢复备份失败处理（备份失败禁止继续修复+显示提示）、DisabledMcpComponentManifest提取不得执行getter（Object.getOwnPropertyDescriptor+拒绝accessor descriptor）、prototype pollution后续构造约束（不得Object.assign到普通对象+null-prototype plain object+unknown state不得merge到默认state）、v2.0阶段发布策略（a/b/c/d内部里程碑不可发布+d验收后才可发布）、panel删除toast窗口可接受（toast到事务间短暂窗口+崩溃时启动cleanup恢复）、focusSession旧数据无taskSnapshot（taskId存在补读title+不存在显示已删除任务） |
| 第16轮 | ✅ | 致命5+严重12：Migration preflight修正（indexedDB.databases()探测+currentVersion===/</>DB_VERSION三分支+不可用降级处理）、importStaging commit/quota/cleanup状态机闭合（三段式A.previewed→committing+B.单事务commit+C.cleanup+quota失败retry先查targetPanelId+按错误类型处理不笼统清理staging）、opaque widget加载顺序修正（importedAsOpaqueUnknown检查移至validateState之前+不调用validateState不渲染组件）、runIdbTransaction事务闭包规则收紧（fn内只允许直接await ctx方法+禁止async helper/Promise.all/then-catch-finally/setTimeout/fetch/React setState+ESLint AST检查+纯同步函数复用+TxPromise brand定位lint hint非安全机制）、SaveJobStatus加conflicted（新增conflicted状态+CAS version_conflict进入+保留snapshot手动恢复+SaveJobFailureReason 6种）、Quota模式退出条件（probe写入策略+importStaging store写入极小record+同事务删除+成功退出失败保持）、import commit重试幂等规则（panel存在视为成功+部分child存在清理后重试+id冲突importBatchId不匹配abort+同batch跳过）、panel删除确认内容（名称+widget/task/event数量+建议导出+quota强制建议导出+不要求输入名称）、legacyRaw诊断UI（只读+哪些widget有+JSON size+可否压缩）、focusSession旧数据补读title合同（补读不立即写DB+失败显示未知任务+编辑时CAS写入+pending_delete title可读）、导出时pending_delete提示（UI提示不包含待删除项目）、version导入legacy兼容（app v2 bundle version必须正整数+legacy bundle修复为1非拒绝）、导入preview排序（zIndex/dueAt/startAt/panelName不依赖updatedAt）、DisabledMcpComponentManifest提取只对plain object（typeof object+非null+Array拒绝+Date/boxed拒绝+prototype校验）、运行时数量上限（widget 500/task 5000/event 5000/state 2MB/导出20MB+toast提示）、habitCheckins dangling处理（提示历史打卡保留不再显示+v2.1完整性检查器处理）、导入崩溃恢复测试补全（11场景：created/validated/remapped/previewed/committing/commit success/quota abort/targetPanelId exists/missing/created*Ids corrupted/expiresAt expired） |
| 第17轮 | ✅ | 致命5+严重15：硬目标改为可验收不自相矛盾版本（权威数据跨store正式提交单事务原子+staging/非权威展示增强字段/诊断性清理允许分段执行但须满足5条件+focusSession.taskSnapshot.deletedAt明确为非权威展示增强字段允许异步best-effort补写）、importStaging崩溃恢复规则修正（committing状态按targetPanelId查panel存在视为成功不存在视为未执行删除staging+单事务commit保证原子性不存在部分数据+浏览器bug残留v2.1完整性检查器兜底+删除"可能的部分数据"表述）、unknown opaque state与remap规则边界明确（Remap硬规则仅适用已知结构层和已知引用字段+opaque state视为不可解释payload不承诺内部id remap+不得参与运行时引用解析/查询/渲染/权限判断+显式修复前内部原始id不得当正式id使用）、IdbTxContext API修改避免业务层伪造metadata（addNew/putCas/deleteChecked替代add/put/delete+version和updatedAt由ctx内部生成+业务层不再直接传完整PersistedRecord）、quota模式下staging处理（禁止从previewed重新执行新增型commit+允许清理staging+允许targetPanelId已存在时完成committed cleanup+允许导出staging payload+释放空间probe成功后才允许继续commit）、v2.0c排期调整为6-10周+总排期32-48周、ESLint规则级规范（事务闭包必须内联函数+合法await仅限ctx方法+其他AwaitExpression报错+禁止CallExpression调用返回Promise函数除ctx方法外）、v2.0仅支持Chrome latest stable、VersionConflictError内部业务错误类型+classifyIdbError处理DOMException和内部错误不误判、pending_delete期间SaveJob处理（执行前检查recordStatus+pending_delete则job取消stale+pending_delete写入后version+1+undo用pending_delete后version+cleanup用deleteChecked+重复delete no-op）、panel删除前取消SaveJob（确认后立即取消active SaveJob+清除debounce timer+清除sessionStorage draft+后续SaveJob执行前检查panel存在）、导出前大小估算（ExportSizeEstimate+超20MB拒绝构造bundle）、导入parse期间UX（loading状态+防重复点击+30秒超时+失败恢复UI+关闭/再次导入取消当前parse）、StoreSchemaContract.migrate改名migrateToCurrent+v2.0不得自动调用写回DB仅用于加载兼容校验不产生持久化副作用、workspace组件exportState字段白名单（focusTimer/habitTracker/moodTracker/statsPanel按组件列出remove/keep）、unknown字段拒绝由组件importState/validateState执行（全局扫描不适用于组件state内部）、500 widgets是数据安全上限不是性能承诺（v2.0性能承诺仅覆盖30组件组合）、quota模式下focusSession删除（quota-only入口+二次确认不可恢复）、legacyRaw诊断正式入口（设置/诊断中显示占用+允许导出后压缩非只读隐藏功能） |
| 第18轮 | ✅ | 致命5+严重12：导入child幂等规则简化（删除same-batch skip+正式store id冲突一律abort+committing恢复只以panel存在为准）、remapped/previewed crash预期修正（正式store不存在数据+只需删除staging+target*Ids是planned ids不是已创建ids+created*Ids重命名为targetWidgetIds/targetTaskIds/targetCalendarEventIds）、dirty UI修正（dirty显示未保存角标/状态点不弹toast+queued_after_save旋转图标+可选提示）、quota probe合法数据结构（ImportStagingData改为RealImportStagingData|QuotaProbeData联合类型+staging扫描跳过quota_probe）、legacy import分流顺序（exportVersion===1走v2严格校验+缺失或0走legacy容错+其他拒绝）、created*Ids重命名+committedAt/commitAttempt字段、导入状态机权威附录（合并散落规则为唯一权威段落+完整状态转移表+crash恢复规则）、ESLint规则可执行定义（@typescript-eslint/parser+type information+parserOptions.project+保守处理）、deletePanel大数据场景（不做分批+性能不达标不blocking+E2E覆盖50w+100t+100e）、quota模式focusSession补写跳过（仅console/debug记录不进入保存失败状态）、habit删除确认文案（历史打卡记录会保留在本地数据库中但v2.0不提供查看入口）、workspace entity widget导入后状态（exportState->importState->validateState->envelope后写DB+清除引用不保留legacyRaw+导入后不显示dirty）、unknown widget opaque恢复备份超限（超过导出上限禁止修复+只能删除组件）、导入时单个WidgetStateData受2MB限制（含opaque state和legacyRaw+超限拒绝该组件addWarning）、panel删除失败后SaveJob/draft恢复（取消的SaveJob不恢复+draft不可逆丢失+提示未保存编辑可能已丢失）、事务abort cause传递（runIdbTransaction保存abortCause+VersionConflictError时保存→abort→onabort优先reject abortCause）、只读模式下draft边界（不进入正式编辑态+独立草稿区域+恢复须重新拿lease经CAS） |
| 第19轮 | ✅ | 致命5+严重12：导入恢复不删除正式child records（committing恢复targetPanelId不存在时只删staging不删正式store child records+发现target child ids已存在进入recovery_error诊断+v2.1完整性检查器处理+删除"清理后重试B段"）、quota模式panel删除无部分失败（改为单事务成功全部删除失败全部回滚+toast只显示"删除失败，未删除任何数据"）、统一task hard delete补写合同（startup cleanup中task hard delete事务只删除task+事务成功后异步best-effort CAS补写+quota模式跳过+删除"同事务更新focusSessions"文字）、importStaging crash恢复策略统一方案A（created/validated/remapped/previewed一律删除staging不恢复导入流程+expiresAt只用于运行时清理不参与crash恢复判断+committing/committed按targetPanelId判断）、WidgetState主键lazy repair事务步骤补充完整（repairWidgetStatePrimaryKey:单store readwrite事务+get oldId+校验widgetId+get newId不存在+addNew+deleteChecked+失败进诊断不覆盖）、超2MB widgetState剪枝规则（跳过widgetRecord/widgetState/BlobAssetManifest/DisabledMcpComponentManifest+targetWidgetIds不含该widget+preview显示skippedWidgets+panel entity不受影响）、导出大小从estimate改为exact final check（先estimate提前提示+最终写文件前UTF-8 byte length校验+超20MB不得触发下载）、exportState/importState验收断言（9组件断言表：focusTimer/habitTracker/moodTracker/statsPanel/pdfViewer/musicPlayer/unknown/taskList/agendaList）、StoreSchemaContract覆盖范围改为"每个IndexedDB store"、quota模式legacyRaw压缩完整规则（必须持有lease+widgetRecord存在且active+CAS version+1+只删legacyRaw/legacyWrappedAt+设置legacyRawDroppedAt+不调用validateState+pending_delete禁止压缩+压缩失败进save_failed）、panel删除前dirty保护（dirty/save_failed/conflicted确认框额外提示+sessionStorage draft标记pendingPanelDelete+事务成功后清除+失败可恢复）、opaque widget修复后ID remap（importState必须处理remap opaque内部旧id+无法remap清空+修复成功可选删除legacyRaw设置legacyRawDroppedAt+设置新envelope.updatedAt+清除importedAsOpaqueUnknown）、import preview不持久化（可由staging.payload+manifest+remap ids重建+warnings/skippedWidgets可确定性重算+previewed状态不依赖内存对象）、classifyIdbError增加操作上下文（IdbOperationContext 6种+constraint按context不同处理）、panel导入排序文案（导入后是新panel排序按导入时间+原导出时间在manifest查看）、v2.0仅支持桌面Chrome+mouse/pointer primary button（touch交互不验收+high DPI坐标normalize） |
| 第20轮 | ✅ | 致命5+严重12：importStaging crash恢复策略统一方案A安全优先（committing+panel missing删除staging用户重新导入+committing+panel exists视为committed清理staging+quota abort后crash也删除staging+删除所有quota abort crash后可重试描述和测试+删除staging保持committing目标数据理论上不存在retry时先检查targetPanelId说法+权威附录崩溃恢复测试矩阵全部统一方案A）、RealImportStagingData加kind和schemaVersion（kind:'import_staging'+schemaVersion:1+所有staging扫描逻辑if record.data.kind!=='import_staging' continue）、导入parse取消/超时改为Web Worker（parse在Worker中执行+主线程30秒timeout超时terminate+用户取消terminate+worker返回parse后对象或错误+pollution scan可在worker内完成）、MCP manifest提取安全伪代码（禁止点访问式读取未知对象属性+isPlainObject+safeOwnDataProp安全函数+所有来源提取必须通过safeOwnDataProp）、测试矩阵清理旧规则（commit quota abort crash预期改为删除staging+targetIds corrupted预期改为进入recovery_error诊断+删除committing+panel missing自动重试旧表述）、importStaging状态表committing允许事件（detectCommitted+discardStaging）、dueAt校验允许null（非null时才按timestamp范围校验+endedAt等可空时间字段同理）、导出大小累计预算（构造期间累计UTF-8长度预算+单记录序列化时累加+超限早停）、panel删除前dirty保护加强（确认框必须三选一：继续删除并放弃/取消删除/先尝试保存）、legacyRaw压缩独立DiagnosticCleanupJob（不复用SaveJob语义+不参与ResourceSaveState+压缩前不需要quota probe+压缩失败保持quota banner+压缩成功后自动probe尝试退出quota模式）、focusSession.taskSnapshot.deletedAt文档去强一致暗示（可能缺失不能作为任务存在性判断依据）、WidgetState主键repair失败UI策略（继续用oldId渲染+后续保存用oldId+导出用data.widgetId+data.widgetId对应widgetRecord不存在显示missing_state placeholder+诊断状态不接入WidgetRenderStatus）、unknown widget超2MB剪枝manifest一致性（preview显示原始和实际widgetCount+新panel name提示部分组件因数据过大已跳过+manifest.widgetCount保持原值用于审计）、DisabledMcpComponentManifest.id非UUID处理（widgetId也非UUID时生成稳定hash UUID基于widgetId的UUID v5+允许legacy非UUID）、EditorLease与startup cleanup边界（用户触发写必须持有lease+启动后台cleanup无lease只扫描不写等用户操作触发lease后再执行+cleanup允许无lease但必须deleteChecked/CAS幂等）、ESLint规则验收定义（规则包名eslint-plugin-idb-tx-safety+触发范围识别runIdbTransaction调用+wrapper函数禁止+泛型ctx alias禁止+解构ctx禁止+同步helper白名单标注@idb-tx-safe） |
| 第21轮 | ✅ | 致命7+严重12：WidgetStateLocator统一定位（LocatedWidgetState接口+locateWidgetStateByWidgetId函数+先按id查再按data.widgetId查+matchedBy/needsRepair标记+渲染/保存/导出/删除/repair/diagnostic全部使用+删除widget按primaryKey删除）、cleanup lease策略统一为方案B（用户写操作必须持有lease+后台cleanup可以无lease但必须deleteChecked/CAS条件删除且必须幂等+导入commit/deletePanel/quota hard delete必须持有lease+删除"无lease只扫描不写"矛盾说法）、IndexedDB upgrade完整多标签阻塞协议（db.onversionchange关闭DB+showBlockingModal+releaseEditorLease+request.onblocked提示+blocked超时60秒只读模式+旧tab禁止继续写+upgrade前释放lease+upgrade后重新acquire）、事务违规错误分类（TransactionResultError:transaction_failed_before_commit可重试/programming_error_after_commit不可重试+runIdbTransaction检测+调用方不得重试programming_error_after_commit）、committing恢复强制child扫描（panel missing时必须用targetWidgetIds/targetTaskIds/targetCalendarEventIds扫描正式store+有child则recovery_error+无child才删除staging+target ids缺失或损坏也进入recovery_error）、PanelLoadStatus（ok/missing/bad_record/incompatible_schema+bad_record/incompatible_schema显示名称+允许导出raw panel bundle+允许hard delete+不加载子数据+进入只读模式+missing不显示）、normalizeStateForSave纳入WidgetDefinitionV2A接口（6个成员3个方法+v2.0a要求16组件全部实现）、SaveJob pending_delete检查泛化（所有extends DeletableEntityData的ResourceKind+执行前检查recordStatus===active+pending_delete时取消stale不得写入）、deleteChecked predicate改为内置条件对象（expectedFields替代自定义predicate+点分隔符访问嵌套字段+不允许自定义predicate函数）、StoreSchemaContract.migrateToCurrent改名为coerceForRead（v2.0只做读兼容校验不产生持久化副作用+v2.1引入migrateToCurrentWithPlan）、raw state导出统一合同（单组件raw导出受20MB限制+raw导出做pollution scan+文件格式WidgetStateData JSON+render_error导出含envelope+legacyRaw+legacyRawDroppedAt提示旧版备份已压缩+unknown opaque超20MB禁止修复和raw导出只能删除）、quota模式focusSession删除规格（按时间范围删除+必须preview数量+必须建议导出+二次确认+单事务删除）、import preview warnings确定性（importState导入阶段必须是纯函数+不得依赖当前时间/workspace/随机数+v2.0选择确认前重新生成并展示）、DisabledMcpComponentManifest.id规则区分读写（读取旧manifest允许legacy非UUID+新导出必须规范化为UUID/hash UUID）、同一事务内统一now（导入commit事务内所有record使用同一个Date.now()值作为updatedAt）、indexGetAll大数据策略（导出逐条游标+累计预算+cleanup游标扫描+deletePanel一次性getAll+最大读取不设硬限制导出20MB预算早停）、pending_delete诊断导出（普通导出排除pending_delete+诊断导出包含pending_delete记录+删除toast提供导出入口）、beforeunload flush与SaveJob交互（绕过debounce+创建SaveJob或更新latestQueuedSnapshot+写sessionStorage draft+不使用sendBeacon+pagehide强制saveDraft）、taskList/agendaList被2MB剪枝时panel entity处理（preview提示任务/日程已导入但对应组件被跳过+自动补默认taskList/agendaList widget+新建taskList自动显示已有panel tasks） |
| 第22轮 | ✅ | 致命7+严重12：importStaging增加recovery_error状态（committing+panel missing+有target child存在或target ids缺失/损坏时进入+staging保留不允许自动重试+只允许导出诊断信息或删除staging+UI显示导入恢复异常+v2.1完整性检查器处理）、IdbTxContext增加游标API（iterateIndex+iterateStore+countIndex+ESLint白名单同步扩展+导出用iterateIndex+累计预算+cleanup用iterateStore+deletePanel用indexGetAll）、WidgetStateLocator增加duplicate_conflict（LocatedWidgetState改为联合类型found/duplicate_conflict/missing+duplicate时不渲染真实组件+显示诊断placeholder组件数据冲突+导出全部候选按钮+删除全部按钮+禁止普通保存+删除widget必须删除全部候选）、2MB剪枝自动补widget纳入staging（remap阶段检测被剪枝taskList/agendaList+如果对应panel entity存在生成默认widgetRecord+widgetState+合并进payload.widgets/widgetStates+写入targetWidgetIds+参与preview计数和20MB预算+crash recovery按统一规则处理）、PanelLoadStatus只读模式与hard delete权限分开（WriteCapability类型6种+权限矩阵4模式×5能力+diagnostic操作必须持有lease+二次确认+条件删除）、programming_error_after_commit恢复策略（立即重新读取DB+内存snapshot与DB一致则clean+不一致则dirty+baseVersion=DB.version+latestQueuedSnapshot=当前内存snapshot+创建新SaveJob+显示非阻塞诊断warning）、opaque unknown remap context持久化（WidgetStateData增加opaqueImportContext+包含oldWidgetId/newWidgetId/oldPanelId/newPanelId/widgetIdMap/panelIdMap/entityIdMap+修复成功后清除importedAsOpaqueUnknown和opaqueImportContext）、quota模式staging清理（扫描importStaging+未committed大payload提供删除未完成导入缓存入口+删除前允许导出+删除staging需要lease）、deletePanel大数据测试补充（500 widgets+5000 tasks+5000 events删除事务完整性+中途abort回滚+quota下删除panel回滚）、导入preview确认绑定（确认按钮点击时重新生成preview+弹出最终确认摘要+用户确认后commit使用deterministic derived payload）、StoreSchemaContract.coerceForRead改名为readCompatValidate（更明确表示只做读兼容校验）、legacyRaw超2MB处理（legacy读取不受2MB新建限制+首次编辑保存前估算大小+超2MB禁止保存提示导出后压缩+普通模式也允许显式压缩）、UUID v5 namespace定义（MCP_LEGACY_WIDGET_ID_NAMESPACE常量）、Date.now()回拨声明（时间仅作本地弱语义+lease heartbeat容忍回拨+deleteExpiresAt检测回拨采用保守策略+v2.0不做monotonic clock）、EditorLease与upgrade失败关系（upgrade失败只读不acquire lease+blocked超时只读不acquire lease+version too new只读不acquire lease+open失败只读不acquire lease）、deleteChecked.expectedFields安全读取（safe own data property读取+缺失字段不匹配+中间路径非plain object不匹配+不支持数组下标+不触发getter）、raw导出pollution scan失败UX（拒绝下载可执行JSON+提供安全诊断导出格式+危险key转义为字符串路径列表+或导出为unsafeRawString）、focusSession quota删除补充（删除后statsPanel重新聚合+不产生pending_delete+不可撤销+console/debug记录）、诊断状态统一模型（DiagnosticIssueKind 6种+import_recovery_error/duplicate_widget_state/widget_state_repair_failed/bad_panel_record/opaque_recover_failed/legacy_raw_oversized+统一UI处理策略+设置/诊断面板展示）
| 第23轮 | ✅ | 致命5+严重12：WidgetStateLocator始终执行两类查询（同时查primaryKey和data.widgetId索引+合并去重+dedupeByPrimaryKey）、deletePanel必须使用WidgetStateLocator（对每个widgetId调用locateWidgetStateByWidgetId+found删除primaryKey+duplicate_conflict删除全部candidates+missing继续不失败+同一readwrite事务+增加storeNames清单表）、widgetState SaveJob增加parent guard（读取父widgetRecord不存在/pending_delete→job stale+检查panel不存在→job stale+ResourceKind→parent guard表格）、legacy主键不一致修复失败后禁止普通保存（方案A严格模式+repair失败后禁止普通保存+显示诊断placeholder+只允许导出raw/删除/再次repair+WidgetStateRecord.id MUST equal data.widgetId强合同）、import remap持久化完整映射表（RealImportStagingData增加remapContext含panelIdMap/widgetIdMap/taskIdMap/calendarEventIdMap+第一次remap生成后必须写入staging+后续全部使用持久化map+不允许重新随机生成+target*Ids只是map的派生结果）、deletePanel事务失败精确恢复（重新读取panel存在性+恢复pending_delete toast+重新加载panel列表+draft可恢复+错误分类进入retry/readonly/quota）、TxInternalPhase状态机（fn_running/fn_resolved_waiting_complete/fn_rejected_aborting/tx_completed_before_fn_resolved/done 5态）、ctx.now()统一事务时间（runIdbTransaction开始取一次Date.now()+ctx.now()返回固定值+addNew/putCas使用ctx.now()）、StoreSchemaContract校验层级（三层：PersistedRecord外壳→data.schemaVersion→widgetStates再校验envelope.stateVersion）、bad panel禁止compress legacyRaw（权限矩阵修正bad panel readonly下diagnostic_compress_legacy_raw为❌+只能导出raw panel bundle或diagnostic_delete_corrupt_panel）、taskSnapshot.deletedAt文案去强一致暗示（改为"会在事务成功后尝试异步补写；可能缺失；仅用于展示增强"）、2MB剪枝自动补widget规则明确化（每类panel entity widget最多补1个+仅当全部被剪枝且存在对应实体时补+deterministic layout slot+zIndex=max+1+补充后重新检查上限和预算+超限放弃补充+preview提示无法自动补充入口）、quota模式legacyRaw压缩硬规则（不允许修改envelope.state+不允许触发normalizeStateForSave+不允许ResourceSaveState变更+不允许与普通SaveJob合并）、raw导出pollution scan失败唯一格式（unsafe_raw_diagnostic JSON含kind/unsafeRawString/blockedKeys+禁止导出原始可解析对象）、UUID v5 namespace完整定义（RFC 4122 UUID v5算法+输入UTF-8编码+输出符合v5 variant/version bits）、高层操作storeNames清单表（createWidget/deleteWidgetWithUndo/hardDeleteWidget/deletePanel/importPanelAsNew/cleanupPendingDelete 6操作×对应storeNames）、orphan state诊断测试（5场景：primaryKey!=data.widgetId/canonical+duplicate/deleteWidget删除全部/deletePanel删除全部/export检测duplicate_conflict走诊断导出） |
| 第24轮 | ✅ | 致命5+严重12：事务helper矛盾解决（@idb-tx-helper标注允许async helper+约束参数含ctx+内部只await ctx白名单+不得调用未标注helper+不得捕获外部Promise+必须静态分析+locateWidgetStateByWidgetId标注@idb-tx-helper+wrapper函数禁止改为未标注@idb-tx-helper的wrapper函数禁止）、legacy加载pipeline定义（5步pipeline：校验外壳→legacy外壳识别→schemaVersion分支→legacy path生成syntheticEnvelope不写DB→首次编辑保存写入当前WidgetStateData+支持的legacy shape+StoreSchemaContract.readCompatValidate负责识别legacy+LoadedWidgetState在readCompatValidate之后产生）、SaveJob parent guard同事务原子约束（新增SaveJob事务storeNames表9种ResourceKind→readwrite stores+parent guard与putCas同一readwrite transaction）、deletePanel使用locator的事务可执行性（locateWidgetStateByWidgetId标注@idb-tx-helper+deletePanel完整8步事务步骤）、WidgetDefinitionV2A文案修正（v2.0a只要求6成员3方法+不要求exportState/importState+删除stub说法+v2.0c才引入ExportableWidgetDefinition）、readCompatValidate语义明确（负责识别legacy shape+legacy识别属于StoreSchemaContract职责+schemaVersion缺失进入legacy candidate+LoadedWidgetState在readCompatValidate之后产生）、DiagnosticCapability矩阵扩展（8种capability+6列权限矩阵）、programming_error_after_commit适用范围限定（只适用单资源SaveJob+跨store操作重新读取关键资源判断+不套用clean/dirty分支）、2MB剪枝自动补widget降级为v2.1（v2.0c不做自动补+超2MB剪枝+panel tasks/events仍导入+preview提示手动添加+v2.1再补+删除所有自动补widget规则）、deleteChecked.expectedFields精确定义（plain object+Object.create(null)接受+key path不允许空段+允许访问id/version/updatedAt+不允许undefined期望值+safeOwnDataProp读取）、quota模式staging删除失败处理（分类quota_exceeded/transaction_abort/unknown+quota_exceeded保持banner提示关闭标签页或清理+transaction_abort重试一次+unknown保持banner）、raw导出unsafeRawString尺寸处理（JSON.stringify失败标记stringifyFailed+超20MB截断标记truncated+originalSize+blockedKeys限100）、Panel bad_record raw bundle定义（损坏panel record+可按id关联子数据+panelId从record.id获取+子数据按panelId索引扫描）、DisabledMcpComponentManifest.id规则统一（DB旧数据允许非UUID+新生成/新导出必须UUID+导入legacy立即规范化+校验失败替换为UUID v5(widgetId)）、cleanupPendingDelete分资源事务（按ResourceKind分独立事务+每事务一种资源+widget hard delete事务widgetRecords+widgetStates+task hard delete事务tasks+calendarEvent hard delete事务calendarEvents+moodEntry hard delete事务moodEntries+一个记录冲突不影响其他+Blob清理在widget hard delete事务成功后执行）、v2.0c排期调整（6-10周→5-8周+总排期32-48周→30-43周）
| 第25轮 | ✅ | 致命5+严重12：跨store programming_error_after_commit恢复表（createWidget 4状态+hardDeleteWidget 3状态+deletePanel 2状态+importPanelAsNew按importStaging规则+cleanupPendingDelete重新读取判断）、StoreSchemaContract三层校验合并为唯一权威判定树（8步WidgetState加载判定顺序+readCompatValidate返回类型改为ReadCompatResult三态+删除"任一层校验失败则placeholder"绝对说法+schemaVersion加载判定pipeline指向唯一权威判定树）、import B段运行时失败状态机（ImportRuntimeEvent 7种事件+committing状态7种事件动作映射表）、corrupt child边界声明（v2.0 panel删除和raw panel bundle只覆盖可索引子记录+无法解析panelId的损坏记录归类为workspace orphan由v2.1处理）、unsafeRawString stringify失败修正（UnsafeRawDiagnosticExport接口+stringify失败写空串+错误摘要+blockedKeys限100+输出JSON限20MB+超限截断unsafeRawString非整个JSON）、WidgetStateLocator渲染缓存策略（面板加载批量readonly transaction+缓存到内存map+缓存失效规则）、deleteChecked返回错误语义（DeleteCheckedError 6种错误类型+undo按错误类型显示不同提示）、deleteCorruptPanel独立操作合同（async函数+storeNames+panelId从record.id+子数据按panelId索引扫描+quota允许+失败恢复同deletePanel+生成diagnostic issue）、focusSession创建时task状态处理表（5种task状态→taskSnapshot.title映射）、导入manifest widgetCount语义（ExportManifest改为originalWidgetCount+importedWidgetCount+skippedWidgetCount三字段）、importState addWarning受控副作用（顺序稳定+去重+preview重建清空+不参与deterministic derived payload）、IndexedDB upgrade fallback修正（open不带版本号+onsuccess读取db.version+关闭后比较+onupgradeneeded oldVersion=0误创建空库处理）、panel SaveJob与deletePanel冲突（执行前检查lease+not_found时cancelled+UI提示面板已删除）、workspace组件exportState严格白名单（白名单外字段全部丢弃+focusTimer补theme）、DiagnosticIssueKind与Capability映射表（6种IssueKind→对应Capabilities映射）、deletePanel大数据测试补充（不要求P95+只要求事务完整性和页面不崩溃+Chrome latest 30秒上限+UI显示loading+禁用关闭） |
| 第26轮 | ✅ | 致命6+严重13：migration前Raw DB Backup、widgetStates增加data.panelId索引、deleteChecked改为throw错误、import recovery_error写入失败态、导入状态机唯一权威、WidgetStateLocator缓存与一致性、WidgetDisplayMode统一模型、PanelLoadStatus.bad_record安全读取、deleteCorruptPanel独立恢复表、readCompatValidate泛型边界拆分、import preview hash绑定、normalizeStateForSave JSON-safe合同、诊断操作统一备份规则、EditorLease跨tab toast失效、focusSession补读title UI标注、normalizeDisabledMcpManifestId统一函数、DiagnosticOperationContract统一模板、DiagnosticExport统一格式、跨store操作恢复表补全 |
| 第27轮 | ✅ | 致命7+严重9：DiagnosticIssueKind枚举闭合（+6种跨store恢复issue）、WriteCapability矩阵补delete_panel列、ImportPreviewDigest加schemaVersion+RealImportStagingData加previewDigest字段、deleteChecked加fieldPredicates支持lte条件（用于deleteExpiresAt<=now）、ESLint规则统一@idb-tx-helper（删除矛盾的内联函数限制+合法await白名单扩展+helper标注函数允许调用）、导入流程段落加唯一权威引用声明、ExportableWidgetDefinition升级文案修正（删除stub说法+v2.0a不含exportState/importState） |
| 第28轮 | ✅ | 致命8+严重：原则25修正（v2不做用户可管理独立数据表视图，允许最小实体store）、导入remap改UUID v5保证确定性幂等（REMAP_NAMESPACE定义）、committing状态删除staging必须先detectCommittedNow（禁止直接discardStaging）、事务错误模型闭合（IdbTransactionError class 7种kind）、DiagnosticIssueKind与Capability映射修正语义（按issue类型区分capability）、ExportManifest与ImportPreviewManifest拆分（导出不含导入preview字段）、normalizeDisabledMcpManifestId接受UUID v4和v5、panel SaveJob不检查recordStatus（panel无recordStatus）、habit删除完整合同（hard delete+单事务+dangling checkins保留）、focusSession quota删除补充（按时间范围+preview+二次确认）、focusSession.taskSnapshot.deletedAt补写操作合同（独立异步+不参与SaveJob）、fallbackState语义修正（构造错误信息不渲染真实组件） |
| 第29轮 | ✅ | 致命9+严重10：WidgetStateReadResult与ReadCompatResult双模型合并（删除冗余WidgetStateReadResult统一使用ReadCompatResult<WidgetStateData>）、deleteChecked测试矩阵补全（11场景覆盖正常/不匹配/不存在/version/fieldPredicates/嵌套/undo/cleanup）、quota probe脆弱性兜底（importStaging写入也失败时尝试其他store+best-effort退出+后续写成功自动probe）、panel bad_record删除后orphan残留UI提示（诊断面板显示orphan+提供export/delete能力+v2.0不自动清理）、focusSession补写与SaveJob并发边界（补写CAS version_conflict跳过+等SaveJob完成重试+用户操作优先+best-effort）、workspace组件legacyRaw引用清除合同（导出副本清除引用+导入强制清空+DB中legacyRaw不改）、导出截断算法（流式累加+按panel逐条序列化+优先级排序+超限早停+单条超限跳过+manifest记录）、WidgetStateLocator缓存多标签一致性（per-tab内存+只读模式清空缓存+不使用缓存+lease互斥保证）、panel SaveJob保存内容定义（PanelData含name/zIndex/width/height/offsetX/offsetY/schemaVersion+不包含子数据） |
| 第30轮 | ✅ | 致命9+严重10：PanelData类型冲突修正（补齐zIndex/width/height/offsetX/offsetY布局字段+同步SaveJob/导入导出/schema校验）、ExportManifest与ImportPreviewManifest职责拆分（ExportManifest只含panelName/widgetCount/taskCount/calendarEventCount+ImportPreviewManifest由导入流程生成不在导出文件中+导入校验步骤修正为校验ExportBundleV1顶层字段+ExportManifest字段）、ExportBundleV1结构统一（加kind/exportVersion/exportedAt/appVersion顶层字段+truncated/oversizedWidgetIds/skippedWidgetCount截断元数据）、单panel导出截断算法修正（删除多panel循环/truncatedPanelCount+改为单panel流式累加+优先级排序+超限早停）、ImportStaging状态机重复定义修正（散落段落加"唯一权威展开说明"引用声明+冲突以唯一权威章节为准）、LoadedWidgetState与ReadCompatResult关系明确（LoadedWidgetState是UI派生+转换规则定义+业务层不得直接写DB）、文档截断限制增大到120KB确保MCP安全章节完整 |
| 第31轮 | ✅ | 致命6+严重8：deletePanel补orphan widgetStates扫描（步骤3a额外扫描widgetStates.data.panelId+去重后删除+不留orphan）、导出截断改为widget原子单位（WidgetRecord+WidgetState+BlobManifest+McpManifest整组写入或跳过+不允许半损坏导出+oversizedRecordIds改为oversizedWidgetIds）、ImportStagingStateMachine 6态残留修正为7态（+recovery_error）+committing事件修正（discardStaging改为scanAndDecide+panel不存在必须先扫描child再决定）、IdbTransactionError补齐condition_mismatch/accessor_rejected/key_path_invalid三种kind+cause字段保留原始错误、WriteCapability统一权限体系（+quota_delete_focus_sessions/quota_delete_habit/diagnostic_delete_orphan/diagnostic_delete_import_staging/diagnostic_delete_duplicate_widget_states/diagnostic_delete_widget_record+权限矩阵扩展12列）、focusSession.taskSnapshot.deletedAt语义统一（"记录删除时间"改为"可能被异步补写best-effort不保证存在"） |
| 第32轮 | ✅ | 致命6+严重10：undo与deleteChecked语义统一（undo改用expectedFields={'data.recordStatus':'pending_delete'}不使用expectedVersion+undo成功后putCas恢复active）、Raw DB Backup修正承诺（改名为LegacyJsonDiagnosticBackup+不承诺灾难恢复+不保证structured clone完整性+stringifyErrors数组）、IDB事务await模型补充实现约束（ctx方法同步enqueue IDBRequest+Promise resolve在success/error callback内+禁止复杂同步逻辑+tx.oncomplete flag检测+brand check+TransactionState flag双重检测+不依赖ESLint）、import preview hash定义canonical JSON+SHA-256（CanonicalJsonRule+canonicalize递归序列化+sha256Hex WebCrypto+payloadHash/remapContextHash/derivedPayloadHash精确定义+排序规则+opaque/legacyRaw处理）、16组件State Schema补齐（16个interface+workspace引用字段清除规则+normalizeStateForSave规则+validateState规则）、三套错误模型统一（IdbErrorKind废弃+SaveJobFailureReason废弃+StorageWriteOutcome统一归一化层+IdbTransactionError到StorageWriteOutcome映射）、habit quota删除（habit无recordStatus+deleteChecked with expectedFields={'id':habitId}）、focusSession生命周期边界（创建后不可编辑+不创建SaveJob+只读展示+补写是唯一写操作）、ExportManifest数量语义（original/exported/skipped三字段×3实体）、unknown字段拒绝修正（已知结构层拒绝+组件state内部由validateState决定+opaque不做白名单）、MCP id规则（DB读取容忍非UUID+新生成/导入持久化/导出必须UUID）、deletePanel性能测试fixture（标准小状态<10KB+大状态只验完整性不验30秒）、orphan UI文案修正（不得暗示由本次删除残留）、legacyRaw+unknown widget（unknown opaque不解释legacyRaw+mcp-disabled只提取manifest）、StoreSchemaContract加validateRecordShell（外壳校验所有store共用+validateData校验data+readCompatValidateRecord组合） |
| 第33轮 | ✅ | 致命5+严重7：focusSession SaveJob统一（不存在SaveJob+创建后不可编辑+补写并发边界修正为多标签补写并发而非SaveJob并发）、undo是否校验version统一（撤销条件唯一权威：record存在+recordStatus=pending_delete+deleteToken匹配+panel存在+不校验version）、v2.0是否必须exportState/importState统一（v2.0总验收必须包含导入导出+v2.0a/v2.0b/v2.0c是内部里程碑+v2.0c完成后才等于v2.0验收通过）、ImportPreviewDigest hash定义修正（payloadHash改为sourcePayloadHash+validatedPayload是remap前校验后数据+删除generatedAt参与hash的自引用+generatedAt只用于展示和过期判断）、blobManifestId与BlobAssetManifest映射断裂（删除blobManifestId+PdfViewerStateV1加mimeType/size/needsReselect+MusicPlayerStateV1删除blobManifestId+Blob运行时统一以widgetId为key）、事务安全性降级表述（运行时guard仅检测部分违规不构成完整安全边界+合法性主要由ESLint+CI+受控代码审查保证）、WidgetStateLocator缓存not_found重新定位（putCas not_found时必须重新locateWidgetStateByWidgetId+found重试CAS+duplicate进诊断+missing cancelled）、legacy导出区分普通/诊断（普通panel导出id=data.widgetId+诊断raw导出含primaryKey和原值）、habit原则修正（"删除不删实体"改为"删除widget不删除实体+实体只有用户显式删除时按实体删除合同处理"）、pending_delete version变化语义收敛（pending_delete状态下禁止任何普通/诊断写入+除undo和cleanup hard delete外禁止一切写入） |
| 第34轮 | ✅ | 致命8+严重15：数据归属表补panels行（panels/panel/workspace/N/A/否/是/remap panelId）、focusSession从SaveJob表删除（不参与SaveJob+只通过createFocusSession/bestEffortPatch独立操作）、UUID namespace修正（version nibble改为5+namespace不受isUuid业务校验限制）、canonicalize unknown opaque必须排序（删除"直接JSON.stringify"+改为"仍执行canonicalize不解释业务字段"）、导出截断算法改为两阶段（Phase1 dry-run选取+Phase2序列化+manifest在Phase1确定不需回写）、ExportBundleV1删除顶层skippedWidgetCount（所有count只在manifest）、组件schema与export白名单统一（FocusTimerStateV1加durationPreset/soundEnabled/theme+StatsPanelStateV1加chartType+MoodTrackerStateV1加theme）、MusicPlayerStateV1补齐Blob信息（fileName/mimeType/size/needsReselect）、content类字段不得trim（richText/markdownEditor/noteBlock的content不trim+短文本字段trim）、timezone校验策略（Intl.supportedValuesOf校验+不支持时接受非空string+允许UTC+非法fallback Asia/Shanghai）、pending_delete undo恢复校验version（禁止写入保证version不变+undo可安全使用expectedVersion） |
| 第35轮 | ❌ | 致命10+严重10：4个核心问题必须优先修复：(1)重做IDB事务模型（禁止await+显式callback queue或给出浏览器行为验证矩阵）(2)统一错误模型（删除putWithCas union+统一throw IdbTransactionError+toStorageWriteOutcome适配器）(3)导入状态机收敛为唯一权威表（删除重复段落+完整状态转移表含前置条件/事务边界/成功后状态/失败后状态/runtime recovery/crash recovery/quota行为/readonly行为）(4)补齐所有实体高层操作合同+权限裁决函数（21+操作+canWrite+EffectiveRuntimeMode）。其他致命：deleteChecked合同不完整、canonical JSON规则不精确（需可执行伪代码）、Panel创建合同缺失、WidgetStateLocator缓存与导出一致性漏洞（导出禁止只用缓存primaryKey）、programming_error_after_commit语义矛盾（需精确触发条件和数据状态）、模式组合优先级未定义、Blob生命周期不完整（widgetId repair后key迁移/import opaque recover/duplicate删除/widgetRecord missing但Blob存在/panel bad_record删除/quota hard delete panel） |
| 第36轮 | ❌ | 致命6最低限度必须修复：(1)文档截断（100KB限制截断核心内容→增大到120KB）(2)合并WriteCapability与DiagnosticCapability为统一权限系统（OperationCapability+canExecute+统一权限矩阵）(3)IDB事务H1假设错误（onsuccess不在microtask中执行→修正为event loop task）+删除方案C同接口承诺（方案C可能不同接口）(4)SaveJob缓存primaryKey强校验data.widgetId（写入前必须校验record.data.widgetId===widgetId+record.data.panelId===expectedPanelId）(5)StoreSchemaContract具体校验规则缺失（补全10个store的字段级校验规则+unknown策略+legacy候选）(6)quota probe禁止向业务store写probe（只允许importStaging store） |
| 第37轮 | ❌ | Gemini 3.5 Flash审核。致命4+严重3：(1)文档物理截断（80KB截断导致unknown widget opaque恢复合同缺失）(2)programming_error_after_commit事件循环认知错误（oncomplete是宏任务，fn的Promise在微任务resolve，不应制造竞争→改用确定性控制流标志fnResolved）(3)Scheme B事务在React 19/Fiber调度下可能失效（ESLint无法静态分析所有隐式微任务→补充H1假设验证+方案C不承诺同接口）(4)Quota模式墓碑死锁（Chrome LevelDB delete写墓碑导致磁盘不降反增→分批删除+浏览器级别清除兜底）。严重：(1)跨标签Blob内存不一致（v2.0已知限制，Blob仅内存+刷新丢失）(2)deleteChecked嵌套路径崩溃风险（补getNestedValue安全读取器+防原型链污染+防getter）(3)UUID v5下游校验击穿（禁止内部使用UUID v4-only校验+所有id字段宽松校验） |
| 第38轮 | ❌ | Grok 4.3审核。致命5+严重5：(1)文档截断（核心合同缺失）(2)过度工程化（补v2.0范围合理性论证+实现复杂度预算）(3)MCP残留字段与"v2.0不实现MCP"原则冲突（补MCP残留字段清理声明）(4)多标签并发EditorLease best-effort+CAS冲突后无明确恢复路径（补CAS冲突恢复7步路径）(5)Blob仅内存+刷新丢失。严重：(6)未使用的store与"不提前建"矛盾(7)Migration preflight过于脆弱（简化LegacyJsonDiagnosticBackup）(8)UUID v5 remap宽松校验风险(9)deleteChecked+getNestedValue复杂度(10)v2.0必须合同构成v2.1级别工作量（补实现复杂度预算） |
| 第39轮 | ❌ | Grok 4.3审核。致命4+严重5：(1)根本矛盾于设计原则——"轻盈不变"与极端复杂性直接冲突（补v2.0范围合理性论证+推迟到v2.1+的合同清单）(2)文档不完整——截断导致合同不可执行(3)事务模型对真实浏览器环境过度假设且不可靠（方案B依赖H1-H5假设+方案C破坏接口一致性）(4)MCP残留清理与legacy兼容逻辑过度复杂且自相矛盾。严重：(1)IndexedDB schema与migration协议过于精细化(2)多标签lease+CAS+quota+bad_panel多模式组合易产生竞态(3)Blob策略与实体store归属不一致(4)SaveJob与高层操作状态机细节过多(5)校验与错误分类层级冗余 |
| 第40轮 | ❌ | Grok 4.3审核。致命4+严重6：(1)事务模型核心假设H1-H5未经验证即写入合同(2)文档截断导致合同不可执行(3)复杂度远超合理客户端实现能力反而制造数据丢失风险(4)MCP残留字段清理声明与大量MCP相关定义矛盾。严重：(5)浏览器行为测试写进v2.0合同导致范围失控(6)deleteChecked/getNestedValue依赖ESLint+静态分析运行时guard不足(7)导入导出/CAS冲突/opaque unknown缺端到端幂等性测试(8)StoreSchemaContract与WidgetDefinition.validateState职责边界模糊(9)Blob仅内存与"数据安全"目标冲突(10)权限矩阵缺quota模式硬删除与诊断清理优先级冲突规则。修订：添加v2.0最小范围声明——大幅削减v2.0验收范围（删除staging状态机/诊断系统/DisabledMcpComponentManifest/canonical JSON hash/UUID v5 remap/跨store恢复表/getNestedValue/实现复杂度预算等13项合同推迟到v2.1+），v2.0导入简化为同步流程，MCP widget归入unknown widget opaque路径 |
| 第41轮 | ❌ | Grok 4.3审核。致命4+严重6：(1)文档截断(2)事务模型假设未验证(3)v2.0验收范围与"必须"条款严重冲突（大量"v2.0必须"条款与"推迟到v2.1+"列表重叠）(4)StoreSchemaContract+ReadCompatResult+legacy判定树过于复杂。严重：(5)30条"不做的事"与实际合同数量矛盾(6)恢复表依赖"重新读取DB"但未定义精确读取时序(7)MCP残留字段清理声明与"v2.0禁止MCP"冲突(8)Blob仅内存与"数据安全"冲突(9)权限矩阵未覆盖只读导出在quota/bad_panel模式下的UI入口。修订：review.mjs改为只发送最小范围+核心合同摘要 |
| 第42轮 | ❌ | Grok 4.3审核。致命3+严重4：(1)v2.0最小范围仍含完整CAS冲突恢复UI/EditorLease/SaveJob 7态/16组件normalize等复杂度，违背"轻盈"定位(2)事务安全模型存在致命逻辑漏洞——ESLint为主要保障但运行时guard不足(3)pending_delete+undo禁止写入后version不变假设在跨store操作下无法严格成立。严重：(4)toStorageWriteOutcome映射不完整(5)Blob策略与ExportBundleV1 blobAssets字段矛盾(6)StoreSchemaContract readCompatValidate简化与legacy candidate路径不一致(7)SaveJob与pending_delete parent guard在非DeletableEntity资源上覆盖不完整。修订：进一步削减v2.0范围——EditorLease推迟v2.1（v2.0单标签编辑）、SaveJob简化为dirty/clean/saving三态、CAS冲突只toast不做diff面板、EffectiveRuntimeMode简化为normal_editable+quota两模式、21个高层操作简化为5个核心操作 |
