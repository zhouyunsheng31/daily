package xyz.shadowshub.core.network

/** App 摘要（桌面列表用，契约镜像 WebOsApp；source/installed 桌面 apps.list 需要） */
data class AppSummary(
    val id: String,
    val name: String,
    val icon: String?,
    val source: String = "local",
    val installed: Boolean = true,
)

/** App 版本（契约镜像 WebOsAppVersion） */
data class AppVersion(val id: String, val version: String, val html: String?)

/** App 详情 */
data class AppDetail(
    val id: String,
    val name: String,
    val activeVersionId: String?,
    val versions: List<AppVersion>,
) {
    /** 当前活动版本的 HTML（无则回退第一个版本） */
    val activeHtml: String?
        get() = versions.firstOrNull { it.id == activeVersionId }?.html ?: versions.firstOrNull()?.html
}