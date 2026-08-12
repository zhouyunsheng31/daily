package com.livingdashboard.data.repository

import com.livingdashboard.data.dao.FavoriteDao
import com.livingdashboard.data.dao.PanelDao
import com.livingdashboard.data.dao.WidgetDao
import com.livingdashboard.data.dao.WidgetPositionDao
import com.livingdashboard.data.entity.FavoriteEntity
import com.livingdashboard.data.entity.PanelEntity
import com.livingdashboard.data.entity.PanelType
import com.livingdashboard.data.entity.WidgetEntity
import com.livingdashboard.data.entity.WidgetPositionEntity
import com.livingdashboard.data.entity.WidgetType
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 画布 Repository（Spec 4.8）。
 *
 * 注入 PanelDao + WidgetDao + WidgetPositionDao + FavoriteDao（@Inject constructor，@Singleton）。
 *
 * D7 聚合面板真实引用：
 * - 收藏 = favorites 表加记录 + widget_positions 表加（聚合面板, widgetId）位置
 * - 聚合面板不复制 WidgetEntity，通过 widget_positions JOIN widgets 查询真实数据
 * - 组件状态变更自动同步到所有引用位置（同一 WidgetEntity）
 *
 * v5 #N8：observeAggregateWidgets 用 Flow flatMapLatest 消除启动竞态
 * （原 aggregatePanelIdCache 同步缓存在 App 启动时未填充，读到空字符串）。
 */
@Singleton
class CanvasRepository @Inject constructor(
    private val panelDao: PanelDao,
    private val widgetDao: WidgetDao,
    private val widgetPositionDao: WidgetPositionDao,
    private val favoriteDao: FavoriteDao
) {
    // ===== Panel =====

    fun observePanels(): Flow<List<PanelEntity>> = panelDao.getAll()

    fun observePanel(id: String): Flow<PanelEntity?> = panelDao.observeById(id)

    suspend fun getAggregatePanel(): PanelEntity? = panelDao.getByType(PanelType.AGGREGATE)

    /** 查询普通面板（type=NORMAL），不存在返回 null */
    suspend fun getNormalPanel(): PanelEntity? = panelDao.getByType(PanelType.NORMAL)

    suspend fun createPanel(name: String): PanelEntity {
        val panel = PanelEntity(
            id = java.util.UUID.randomUUID().toString(),
            name = name,
            type = PanelType.NORMAL
        )
        panelDao.insert(panel)
        return panel
    }

    suspend fun deletePanel(panel: PanelEntity) {
        // 聚合面板不可删除（D12）
        if (panel.type == PanelType.AGGREGATE) return
        panelDao.delete(panel)
        // widget_positions 外键 CASCADE 自动删除
        // widgets 需手动清理（只删属于此面板的）
        widgetDao.deleteByPanel(panel.id)
    }

    // ===== Widget =====

    fun observeWidgets(panelId: String): Flow<List<WidgetEntity>> =
        widgetDao.observeByPanel(panelId)

    /** 按 ID 流式订阅单个组件 */
    fun observeWidget(widgetId: String): Flow<WidgetEntity?> =
        widgetDao.observeById(widgetId)

    suspend fun createWidget(
        panelId: String,
        type: WidgetType,
        state: Map<String, Any>,
        width: Float,
        height: Float,
        title: String = ""
    ): WidgetEntity {
        val widget = WidgetEntity(
            id = java.util.UUID.randomUUID().toString(),
            panelId = panelId,
            type = type,
            title = title,
            stateJson = convertStateToJson(state),
            width = width,
            height = height
        )
        widgetDao.insert(widget)
        return widget
    }

    suspend fun updateWidgetState(widgetId: String, state: Map<String, Any>) {
        val widget = widgetDao.getById(widgetId) ?: return
        widgetDao.update(widget.copy(
            stateJson = convertStateToJson(state)
        ))
    }

    suspend fun deleteWidget(widgetId: String) {
        val widget = widgetDao.getById(widgetId) ?: return
        widgetDao.delete(widget)
        // 同时删除所有面板中该组件的位置（避免孤儿位置记录）
        widgetPositionDao.deleteByWidget(widgetId)
        // 同时删除收藏（如果有）
        favoriteDao.delete(widgetId)
    }

    /** 更新组件标题 */
    suspend fun updateWidgetTitle(widgetId: String, title: String) {
        widgetDao.updateTitle(widgetId, title)
    }

    /** 更新组件尺寸（width/height，画布坐标 px） */
    suspend fun updateWidgetSize(widgetId: String, width: Float, height: Float) {
        val widget = widgetDao.getById(widgetId) ?: return
        widgetDao.update(widget.copy(width = width, height = height))
    }

    /**
     * 复制组件（相同类型 + 相同内容，新标题加"(副本)"）。
     *
     * 在原组件所属面板创建副本，位置偏移 40px 避免重叠。
     *
     * @return 新组件 ID，原组件不存在时返回 null
     */
    suspend fun duplicateWidget(widgetId: String): String? {
        val original = widgetDao.getById(widgetId) ?: return null
        val newId = java.util.UUID.randomUUID().toString()
        widgetDao.insert(original.copy(
            id = newId,
            title = original.title + "(副本)",
            createdAt = System.currentTimeMillis()
        ))
        // 复制原面板中的位置（偏移 40px 避免完全重叠）
        val pos = widgetPositionDao.get(original.panelId, widgetId)
        if (pos != null) {
            widgetPositionDao.upsert(WidgetPositionEntity(
                panelId = original.panelId,
                widgetId = newId,
                x = pos.x + 40f,
                y = pos.y + 40f
            ))
        }
        return newId
    }

    /**
     * M8 Spec 6.9.3 行 1151：创建 HTML Canvas 组件并写入位置。
     *
     * 分两步（参考桌面端 wsToolHandlers.ts:170-182 `addWidgetAndCaptureId`）：
     * 1. createWidget 创建 WidgetEntity + 写入 state（html/title/agentWidth/agentHeight/时间戳）
     * 2. updatePosition 写入 widget_positions（panelId, widgetId, x, y）
     *
     * 缺少第 2 步会导致组件在画布上没有位置（widget_positions 表为空）。
     *
     * @return 新建的 widgetId
     */
    suspend fun createHtmlWidget(
        panelId: String,
        html: String,
        x: Float,
        y: Float,
        w: Float,
        h: Float,
        title: String,
    ): String {
        val now = System.currentTimeMillis()
        val widget = createWidget(
            panelId = panelId,
            type = WidgetType.HTML_CANVAS,
            state = mapOf(
                "html" to html,
                "title" to title,
                "agentWidth" to w,
                "agentHeight" to h,
                "createdAt" to now,
                "updatedAt" to now,
            ),
            width = w,
            height = h,
            title = title,
        )
        updatePosition(panelId, widget.id, x, y)
        return widget.id
    }

    /**
     * M8 Spec 6.9.4 行 1201：合并式更新 HTML 组件的 html/title 字段。
     *
     * 与 [updateWidgetState] 不同，此方法只覆盖传入的字段，保留其他 state（如 createdAt/agentWidth）。
     *
     * @param widgetId 目标组件 ID
     * @param html 新 HTML 内容，null 表示不更新
     * @param title 新标题，null 表示不更新
     * @return true=更新成功；false=组件不存在
     */
    suspend fun updateHtmlWidget(widgetId: String, html: String?, title: String?): Boolean {
        val widget = widgetDao.getById(widgetId) ?: return false
        val currentState = parseStateJson(widget.stateJson)
        html?.let { currentState["html"] = it }
        title?.let { currentState["title"] = it }
        currentState["updatedAt"] = System.currentTimeMillis()
        widgetDao.update(widget.copy(
            stateJson = convertStateToJson(currentState),
            title = title ?: widget.title,
        ))
        return true
    }

    // ===== Position =====

    fun observePositions(panelId: String): Flow<List<WidgetPositionEntity>> =
        widgetPositionDao.observeByPanel(panelId)

    /** task 称 updateWidgetPosition，spec 4.8 称 updatePosition */
    suspend fun updatePosition(panelId: String, widgetId: String, x: Float, y: Float) {
        val existing = widgetPositionDao.get(panelId, widgetId)
        if (existing != null) {
            widgetPositionDao.updatePosition(panelId, widgetId, x, y)
        } else {
            widgetPositionDao.upsert(WidgetPositionEntity(
                panelId = panelId,
                widgetId = widgetId,
                x = x,
                y = y
            ))
        }
    }

    // ===== Favorite (D7 真实引用) =====

    fun observeFavorites(): Flow<List<FavoriteEntity>> = favoriteDao.observeAll()

    /**
     * v4 #1：D7 聚合面板真实引用落地。
     *
     * 收藏时不仅往 favorites 表加记录，还要往 widget_positions 表加
     * (panelId=聚合面板, widgetId) 记录，否则聚合面板 CanvasScreen 渲染时
     * positions 为空，永远不显示任何组件。
     *
     * 取消收藏时同步删除聚合面板中的位置记录。
     */
    suspend fun toggleFavorite(widgetId: String) {
        val existing = favoriteDao.get(widgetId)
        val aggregate = panelDao.getByType(PanelType.AGGREGATE) ?: return
        if (existing != null) {
            favoriteDao.delete(widgetId)
            widgetPositionDao.deleteByPanelAndWidget(aggregate.id, widgetId)
        } else {
            favoriteDao.insert(FavoriteEntity(widgetId = widgetId))
            // 自动布局：横向排列，每行 4 个（300dp 宽 + 20dp 间距 ≈ 320dp 步进）
            val count = widgetPositionDao.countByPanel(aggregate.id)
            val x = (count % 4) * 320f
            val y = (count / 4) * 320f
            widgetPositionDao.upsert(WidgetPositionEntity(
                panelId = aggregate.id,
                widgetId = widgetId,
                x = x,
                y = y
            ))
        }
    }

    suspend fun isFavorite(widgetId: String): Boolean =
        favoriteDao.get(widgetId) != null

    /**
     * v4 #4 / v5 #N8：D7 聚合面板真实引用查询（Flow 方式，消除竞态）。
     *
     * 聚合面板在 widgets 表中没有自己的记录（不复制组件数据）。
     * 此方法 JOIN widget_positions（panelId=聚合面板）+ widgets 表，
     * 返回聚合面板中所有收藏组件的真实数据。
     */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun observeAggregatePanelId(): Flow<String?> =
        panelDao.observeByType(PanelType.AGGREGATE).map { it?.id }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun observeAggregateWidgets(): Flow<List<WidgetEntity>> =
        observeAggregatePanelId().flatMapLatest { aggId ->
            if (aggId != null) {
                widgetPositionDao.observeByPanel(aggId)
                    .combine(widgetDao.observeAll()) { positions, allWidgets ->
                        val widgetIds = positions.map { it.widgetId }.toSet()
                        allWidgets.filter { it.id in widgetIds }
                    }
            } else {
                flowOf(emptyList())
            }
        }

    /**
     * v4 #17：聚合面板自动创建（App 首次启动时调用）。
     */
    suspend fun createAggregatePanel(): PanelEntity {
        val panel = PanelEntity(
            id = java.util.UUID.randomUUID().toString(),
            name = "聚合面板",
            type = PanelType.AGGREGATE,
            sortOrder = Int.MAX_VALUE
        )
        panelDao.insert(panel)
        return panel
    }

    private fun convertStateToJson(state: Map<String, Any>): String {
        val obj = org.json.JSONObject()
        for ((key, value) in state) {
            obj.put(key, value)
        }
        return obj.toString()
    }

    /**
     * 反序列化 stateJson 为 Map<String, Any>（M8 updateHtmlWidget 合并式更新需要）。
     *
     * 与 [convertStateToJson] 对称：org.json.JSONObject 自动处理 String/Number/Boolean/JSONObject/JSONArray。
     */
    private fun parseStateJson(json: String): MutableMap<String, Any> {
        val obj = org.json.JSONObject(json)
        val map = mutableMapOf<String, Any>()
        for (key in obj.keys()) {
            map[key] = obj.get(key)
        }
        return map
    }
}
