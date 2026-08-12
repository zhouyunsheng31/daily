package com.livingdashboard.ai

import android.content.Context

/**
 * Skill（Spec 6.5 节）。
 *
 * @param name frontmatter 解析的 name（缺失时回退到目录名）
 * @param description frontmatter 的 description（缺失为空字符串）
 * @param version frontmatter 的 version（缺失为 "1.0"）
 * @param content Markdown 正文（frontmatter 之后的内容）
 */
data class Skill(
    val name: String,
    val description: String,
    val version: String,
    val content: String,
)

/**
 * 从 `assets/pi/skills/{dir}/SKILL.md` 加载 skills（Spec 6.5 节）。
 *
 * - 扫描 `assets/pi/skills` 一级子目录
 * - 每个子目录需含 `SKILL.md` 文件，否则跳过
 * - 解析 YAML frontmatter（`---` 之间的简单 `key: value`），提取 name/description/version
 * - frontmatter 缺失或格式错误（无结束 `---`）→ 跳过该 skill
 * - 读取异常（IOException）→ 跳过该 skill
 *
 * 不引 snakeyaml，避免增加依赖。YAML 解析为最小实现（不支持嵌套/数组）。
 */
class SkillLoader(private val context: Context) {

    /**
     * 加载所有 skills。
     *
     * - `assets/pi/skills` 不存在或 list 失败 → 返回 emptyList
     * - 单个目录 list/open 异常 → 跳过该目录
     * - SKILL.md 无 frontmatter 或 frontmatter 不闭合 → 跳过
     */
    fun loadAll(): List<Skill> {
        val skills = mutableListOf<Skill>()
        val dirs = try {
            context.assets.list("pi/skills") ?: return emptyList()
        } catch (e: Exception) {
            return emptyList()
        }
        for (dir in dirs) {
            val files = try {
                context.assets.list("pi/skills/$dir") ?: continue
            } catch (e: Exception) {
                continue
            }
            if ("SKILL.md" !in files) continue
            val content = try {
                context.assets.open("pi/skills/$dir/SKILL.md").bufferedReader().use { it.readText() }
            } catch (e: Exception) {
                continue
            }
            parseSkill(dir, content)?.let { skills.add(it) }
        }
        return skills
    }

    /**
     * 解析 SKILL.md：YAML frontmatter + Markdown 正文。
     *
     * - 不以 `---` 开头 → null（格式错误，跳过）
     * - frontmatter 正则不匹配（无结束 `---`） → null
     * - name 缺失 → 回退到 [dirName]
     * - description/version 缺失 → 空字符串 / "1.0"
     */
    private fun parseSkill(dirName: String, raw: String): Skill? {
        if (!raw.startsWith("---")) return null
        val frontmatterRegex = Regex("""^---\s*\n(.*?)\n---\s*\n(.*)""", RegexOption.DOT_MATCHES_ALL)
        val match = frontmatterRegex.find(raw) ?: return null
        val yaml = match.groupValues[1]
        val content = match.groupValues[2]
        val yamlMap = parseSimpleYaml(yaml)
        val name = yamlMap["name"]?.takeIf { it.isNotEmpty() } ?: dirName
        return Skill(
            name = name,
            description = yamlMap["description"] ?: "",
            version = yamlMap["version"] ?: "1.0",
            content = content,
        )
    }

    /** 简单 YAML 解析（key: value，不引 snakeyaml）。去除 value 两端的引号。 */
    private fun parseSimpleYaml(yaml: String): Map<String, String> {
        return yaml.lines().mapNotNull { line ->
            val idx = line.indexOf(':')
            if (idx < 0) null
            else line.substring(0, idx).trim() to line.substring(idx + 1).trim().trim('"')
        }.toMap()
    }

    /** 把所有 skills 拼成 system prompt 末尾的附录片段（空列表返回空串）。 */
    fun buildSystemPromptAppendix(skills: List<Skill>): String {
        if (skills.isEmpty()) return ""
        return buildString {
            append("\n\n## Available Skills\n")
            for (skill in skills) {
                append("### ${skill.name} (v${skill.version})\n")
                append(skill.description).append("\n\n")
                append(skill.content).append("\n\n---\n\n")
            }
        }
    }
}
