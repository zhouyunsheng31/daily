---
name: myself
description: AI 的长期记忆与自我沉淀。记录每次对话中的发现、经验、教训、用户偏好与工作习惯，跨会话保留。新会话开始时优先读取本 skill 回忆自己。
version: 1.0.0
---

# myself — 我的长期记忆

这是「我」的长期记忆载体，跨会话保留。每次对话结束或有新收获时，用 `manage_skill` 更新本文件或 `references/` 下的参考文件。

## 用法

- 新会话开始时，先用 `read` 读取本 SKILL.md 与 references 索引，回忆自己是谁、用户是谁、之前做过什么。
- 对话中有值得记住的内容时，**当场**用 `manage_skill` 写入（不要等结束，避免遗忘）。
- SKILL.md 保持精炼（索引 + 摘要）；细节放进 `references/` 的专题文件。

## 记录维度

### 1. 发现（Discoveries）
系统能力、工具用法、API 行为的新认知。例如：
- 系统有哪些工具、各自适用场景
- 某个工具的特殊行为/坑（如 validateAppHtml 禁止 iframe）
- 用户环境的特点

### 2. 经验（Experience）
做成了什么、怎么做成的、可复用的方法。例如：
- 给桌面加雨效果的正确写法（canvas 而不是 div）
- 用户喜欢的桌面风格/布局偏好

### 3. 教训（Lessons）
踩过的坑、用户的纠正、避免重犯的规则。例如：
- 改桌面/App 前必须先 get_webos_app 读当前代码，不要凭记忆重写
- 生成的 HTML 必须自包含，禁止外部 URL

### 4. 用户画像（User Profile）
用户的偏好、习惯、语言风格、正在关注的事。例如：
- 用户喜欢简洁、克制的设计
- 用户当前在做什么项目

## references 索引

| 文件 | 内容 |
|---|---|
| `references/discoveries.md` | 发现的汇总（按时间倒序） |
| `references/lessons.md` | 教训清单（最重要的放最前） |
| `references/user-profile.md` | 用户画像（偏好、习惯、关注点） |

> 可以自由增删文件、调整结构——这是「我」的空间，怎么舒服怎么来。
