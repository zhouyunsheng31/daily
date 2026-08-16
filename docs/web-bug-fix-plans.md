# Web 端用户反馈问题：根因与修复方案汇总（2026-08-16）

> 来源：DSH sub-agent 分析（表格/输入框 = dsh-msunxmxd；手势/滚动/新建 = dsh-msup2isb 复测成功）+ Operit 代码复核
> 适用范围：`client/shell-web/`（PWA 壳）
> 状态：分析完成，未实施。实施前请核对行号（工作区代码可能持续更新）。

---

## 问题 1：AI 输出的表格会吞掉第一条（首行数据丢失）

**根因**（✅已验证）：
- `client/shell-web/src/App.tsx` `renderMarkdown()` 识别表格后构造 `rows` 时**只放了表头行**（`const rows: string[] = [trimmed]`），然后从 `j = i + 2` 开始收集数据行——**漏掉了分隔行**。
- 而 `renderTable()` 用 `rows.slice(2)` 取数据行，其假设是 `[表头, 分隔行, 数据1, 数据2, ...]`。
- 实际传入的是 `[表头, 数据1, 数据2, ...]` → `rows.slice(2)` 从"数据2"开始，**第一条数据行被吞掉**；若表格只有一行数据，tbody 完全为空（看起来"表头/第一行不见了"）。
- 已排除：CSS 无 `thead{display:none}`、无 `tr:first-child` 隐藏；流式渲染是整段重新 render，不是逐 delta 渲染导致截断。

**修复方案**（二选一，推荐前者）：
```ts
// App.tsx renderMarkdown 表格分支，约 639 行
const rows: string[] = [trimmed, lines[i + 1].trim()]  // 把分隔行也放进 rows
```
这样 `renderTable` 的 `rows.slice(2)` 正好跳过"表头+分隔行"，保留全部数据行。
（等价方案：把 `renderTable` 的 `rows.slice(2)` 改为 `rows.slice(1)`。）

---

## 问题 2：输入框输入大量文字时不会向上延展

**根因**（✅已验证）：
- 自动增高逻辑 `resizeComposer`（App.tsx 约 1641-1645 行）：`el.style.height = Math.min(Math.max(el.scrollHeight, 44), 160)px`——**硬编码 160px 上限**。
- CSS `styles.css` `.assistant-composer textarea { min-height:22px; max-height:160px; overflow-y:auto }`——同样 160px。
- `resizeComposer` 只在 `onChange` 调用：切换会话/恢复长草稿/点击建议词等 `setDraft` 路径不会重新计算高度。
- 超过 160px 后只能内部滚动（WebView 滚动条不明显 → 用户看不到已输入内容）。

**修复方案**：
1. `styles.css`：`max-height: min(45vh, 320px)`（同时保留 `overflow-y:auto`）。
2. App.tsx：把 160 提取为常量或与 CSS 一致。
3. 增加 `useEffect(() => { resizeComposer() }, [draft])` 覆盖程序化设置 draft 的场景。
4. 可选：`resizeComposer` 里用 `requestAnimationFrame` 延迟读取 scrollHeight（WebView 兼容）。
5. 同步调整 `.assistant-scroll` 底部 padding（约 174px），避免更高输入区遮住最后几条消息。

---

## 问题 3：AI 输出的黑色代码区右滑导致切换到第二桌面

**根因**（✅DSH 复测确认）：
- 页面级横滑切页 = `useSwipeNavigation`（App.tsx 约 1131-1148 行）：只监听 `onTouchStart`/`onTouchEnd`，阈值 `|dx| >= 64 && |dx| >= |dy| * 1.25`，左滑（dx<0）→ `setView('desktop')`。
- `{...swipe}` 展开到整个 `.assistant-screen`（约 1773 行），**代码块内的横向滑动会冒泡到 section 的 touchend**。
- 黑色代码块 `.md-content pre`（styles.css 约 607 行）有 `overflow-x:auto`——用户横滑查看长代码时，手势被上层判定为页面横滑。
- 没有检查触摸起点是否在可横向滚动子元素内，也没有 onTouchMove 实时让渡。

**修复方案**：
```ts
// useSwipeNavigation.onTouchStart 增加排除：
const target = event.target as HTMLElement | null
if (target?.closest?.('.md-content pre, .md-table-wrap, .md-latex-block')) {
  startRef.current = null
  return
}
```
更稳妥：增加 `onTouchMove`，当手指进入可横向滚动容器（`scrollWidth > clientWidth`）时清空 `startRef.current`。
注意：不要简单给 `.assistant-screen` 设 `touch-action: pan-y`（会连代码块自身横向滚动一起禁掉）。

---

## 问题 4：从桌面切回对话页时，对话不自动滚到最新消息

**根因**（✅DSH 复测确认）：
- 滚动跟随逻辑（App.tsx 约 1741-1744 行）：`useEffect(() => { if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight }, [messages, streaming])`。
- 只在 `messages`/`streaming` 变化时触发，且受 `nearBottomRef` 限制；**切页回来（activeView 变化）不是触发条件**。
- 组件重挂后首帧 `scrollHeight` 可能被 `content-visibility: auto`（styles.css 约 417 行）低估，直接 `scrollTop = scrollHeight` 不一定到底。

**修复方案**：
```ts
// AssistantHome 内新增：
const activeView = useShellStore((state) => state.activeView)
useEffect(() => {
  if (activeView !== 'assistant') return
  const el = scrollRef.current
  if (!el) return
  const frame = requestAnimationFrame(() => {
    const last = el.querySelector('.conversation-list > :last-child') as HTMLElement | null
    if (last) last.scrollIntoView({ block: 'end' })
    else el.scrollTop = el.scrollHeight
  })
  return () => cancelAnimationFrame(frame)
}, [activeView])
```
保留原 `[messages, streaming]` effect（流式时仍只在用户位于底部附近才跟随）。

---

## 问题 5：新建对话入口太深（建议放到对话框加号旁边）

**现状**（✅DSH 复测确认）：
- `createConversation()` 在 `store.ts` 约 1281-1293 行。
- 当前路径：`composer-plus`（约 1799 行）→ 菜单"会话列表"（约 1790 行）→ `ChatSidebar` 右上角"新建"（约 1477 行）——太深。

**修复方案**（最小改动）：
1. AssistantHome 读取 `const createConversation = useShellStore((state) => state.createConversation)`。
2. composer 表单里现有 `composer-plus` 旁加一个按钮：
```tsx
<button type="button" className="composer-plus" aria-label="新建对话"
  onClick={() => { setComposerMenu(false); createConversation() }}>
  <Plus size={17} />
</button>
```
3. `Plus` 图标已从 lucide-react 导入，无需新增依赖；如担心两个圆形按钮难区分，可加 `.composer-new` 样式用蓝色 Plus。

---

## 问题 6：公告弹窗每次刷新都出现，"不再显示"无效

**结论**（✅Operit 复核）：
- **当前工作区代码已无公告功能**：`client/` 全目录搜 `announcement`/`不再显示` 0 匹配（`App.tsx` 的 `ANNOUNCEMENT_CACHE_KEY`/`CURRENT_ANNOUNCEMENT` 已不存在，`styles.css` 公告样式也已移除）。
- 用户线上仍看到公告 = **线上部署的是旧版本**，或 Service Worker 缓存了旧壳。

**处理建议**：
1. 确认线上部署了新构建（含已删除公告的代码）。
2. 若线上仍有公告代码：直接删除 `ANNOUNCEMENT_CACHE_KEY`/`CURRENT_ANNOUNCEMENT`/`AnnouncementModal` 相关代码 + 公告样式（用户已明确倾向删除公告功能）。
3. 通知用户硬刷新/清 SW 缓存验证。

---

## 实施建议

- 问题 1、2、3、4、5 都集中在 `client/shell-web/src/App.tsx` + `styles.css`，改动小、互不冲突，可一次提交。
- 提交前：`npx tsc --noEmit` + `vite build`；用 Playwright 验证表格渲染、代码块滑动、切页滚动、新建按钮。
- 行号以实施时实际代码为准（工作区会持续更新）。