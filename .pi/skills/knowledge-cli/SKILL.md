---
name: knowledge-cli
description: 知识库 Skill（预留接口，未实现）。让 AI 能 ingest/search/list/delete/lint 知识库文档
version: 0.1.0
status: stub
---

# knowledge-cli — 知识库 Skill（预留接口，未实现）

## 状态
**本 Skill 仅为接口规范，CLI 尚未实现。** 调用任何命令会返回 501 Not Implemented。

## 计划命令（未实现）
- `knowledge-cli ingest <file|url>` —— 导入文档
- `knowledge-cli search <query>` —— 检索
- `knowledge-cli list` —— 列出所有文档
- `knowledge-cli delete <id>` —— 删除
- `knowledge-cli lint` —— 检查知识库完整性

## 计划数据模型
（详见 shared/types/wiki.ts）
