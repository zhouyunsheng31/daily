# 搜索工具现状评估报告

## 一、背景

- **报告日期**：2026-06-29
- **背景**：用户尝试用系统内置的搜索工具搜索 "PhoneBuddy"，结果发现多个工具不可用或质量差，因此做本次评估
- **评估范围**：共 **4 个搜索工具、5 种搜索能力**——`local_search`（本地设备搜索）+ `web_search`（Bocha 网页搜索）+ `academic_search`（含 S2 / ArXiv 两种 mode）+ `github_search`（GitHub 搜索）
- **评估方法**：用 "PhoneBuddy" 作为测试关键词，实测各联网搜索工具的表现；`local_search` 走本地路由，不参与本次关键词实测

---

## 二、四个搜索工具实测结果

### 0. local_search（本地设备搜索）

- **状态**：✅ 可用（功能正常）
- **说明**：走 `DEVICE_SPECIFIC_TOOLS` 路由到客户端本地，搜索本地书签/历史/面板/笔记等已同步数据
- **注意**：不依赖外部 API，不受网络影响，但只能搜本地数据，无法搜索互联网内容
- **结论**：本地搜索功能正常，是四类搜索中唯一完全可控的工具

### 1. web_search（Bocha 网页搜索）

- **状态**：❌ 质量极差
- **实测表现**：搜 "PhoneBuddy" 返回大量不相关结果（CSDN 下载页、无关应用等），连"腾讯混元 PhoneBuddy"这么热门的内容都搜不到
- **进一步验证**：用 "PhoneBuddy GitHub" 搜索，10 条结果里只有 2 条 GitHub 链接，还都不是目标仓库
- **结论**：Bocha 搜索引擎对中文/技术内容覆盖差，不适合作为主要网页搜索来源

### 2. github_search（GitHub 搜索）

- **状态**：❌ 完全不可用
- **实测表现**：API 返回 401 Bad credentials，Token 已过期/被撤销
- **实际情况**：PhoneBuddy 的 GitHub 仓库 https://github.com/PhoneBuddyAI/phonebuddy 早就存在（6月11日就有提交），但因为 Key 失效搜不到
- **结论**：需要更新 GitHub Token

### 3. academic_search - Semantic Scholar

- **状态**：❌ 对新论文覆盖差
- **实测表现**：PhoneBuddy 论文 6月22日已发布在 ArXiv，但 S2 返回 0 篇结果
- **原因**：S2 索引速度慢，新论文需要时间才能被收录
- **结论**：S2 适合搜老论文，不适合搜最新研究

### 4. academic_search - ArXiv（mode='latest'）

- **状态**：✅ 可用
- **实测表现**：在服务器 Docker 环境中调用，成功搜到 PhoneBuddy 论文（2606.23049）
- **注意**：本地网络直接调用可能出现 fetch failed，需要在服务器网络环境中调用才稳定
- **结论**：ArXiv 是目前唯一可靠的学术搜索来源

---

## 三、PhoneBuddy 实际信息（用外部搜索验证）

以下信息证明我们搜索工具确实漏掉了重要内容：

- **GitHub**: https://github.com/PhoneBuddyAI/phonebuddy
- **项目主页**: https://phonebuddyai.github.io/
- **论文**: https://arxiv.org/abs/2606.23049
- **团队**: 腾讯混元（5 篇系列论文：PhoneWorld / PhoneBuddy / PhoneHarness / PhonePrivacy / PhoneSafety）
- **模型**: Hugging Face 上有 PhoneBuddy-4B / 4B-RealApp / 0.8B

---

## 四、问题总结与改进建议

### 问题总结

1. GitHub Token 过期 → 直接修
2. Bocha 搜索质量差 → 考虑换 Bing/Tavily/Google 等
3. S2 索引慢 → ArXiv 升为主渠道，S2 降为补充
4. 本地调用 ArXiv 不稳定 → 必须在服务器端执行搜索（这也是为什么工具应该走服务器）

### 改进建议（按优先级）

| 优先级 | 建议 | 说明 |
|--------|------|------|
| **P0** | 更新 GitHub Token | 立即修复，恢复 GitHub 搜索功能 |
| **P0** | 学术搜索切换为 ArXiv 主渠道 + S2 补充 | 调整调用顺序，先用 ArXiv 搜最新论文，S2 作为补充搜老论文 |
| **P1** | 评估更换网页搜索提供商（Bocha → Bing/Tavily/其他） | Bocha 对中文/技术内容覆盖不足，需寻找替代方案 |
| **P1** | 确保所有搜索都通过服务器执行，不要在客户端直连 | 服务器网络环境更稳定，且可统一管理 Key 和配额 |

---

## 五、相关文件索引

| 文件路径 | 说明 |
|----------|------|
| [`server/src/utils/searchApi.ts`](../../server/src/utils/searchApi.ts) | 搜索 API 核心实现 |
| [`server/src/utils/searchTools.ts`](../../server/src/utils/searchTools.ts) | 搜索工具注册与封装 |
| [`server/src/routes/searchKeys.ts`](../../server/src/routes/searchKeys.ts) | 搜索 Key 管理路由 |
| [`docs/roadmap_server_v1.md`](../roadmap_server_v1.md) | 服务器路线图（Phase S9） |
| [`docs/specs/ai-search-spec.md`](ai-search-spec.md) | AI 搜索功能规格说明 |
