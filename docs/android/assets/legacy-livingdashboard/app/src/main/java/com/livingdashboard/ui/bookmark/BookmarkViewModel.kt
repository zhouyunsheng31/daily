package com.livingdashboard.ui.bookmark

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.livingdashboard.data.entity.BookmarkEntity
import com.livingdashboard.data.repository.BookmarkRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 书签管理 UI 状态（Spec 3.3.7）。
 *
 * @param bookmarks 当前所有书签列表
 */
data class BookmarkUiState(
    val bookmarks: List<BookmarkEntity> = emptyList()
)

/**
 * 书签管理 ViewModel（Spec 3.3.7）。
 *
 * 注入 `BookmarkRepository`，用 `getAll()` Flow 收藏书签列表。
 *
 * 方法：
 * - `addBookmark(title, url)`：添加书签
 * - `deleteBookmark(bookmark)`：删除书签
 * - `toggleShowOnHome(bookmark)`：切换主页显示状态
 * - `updateBookmark(bookmark)`：更新书签（编辑标题、URL 等）
 *
 * @HiltViewModel + @Inject constructor，由 `hiltViewModel()` 获取。
 */
@HiltViewModel
class BookmarkViewModel @Inject constructor(
    private val bookmarkRepository: BookmarkRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(BookmarkUiState())
    val uiState: StateFlow<BookmarkUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            bookmarkRepository.getAll().collect { bookmarks ->
                _uiState.update { it.copy(bookmarks = bookmarks) }
            }
        }
    }

    /**
     * 添加书签。
     *
     * @param title 书签标题
     * @param url 书签 URL
     */
    suspend fun addBookmark(title: String, url: String) {
        bookmarkRepository.insert(BookmarkEntity(title = title, url = url))
    }

    /**
     * 删除书签。
     *
     * @param bookmark 要删除的书签实体
     */
    suspend fun deleteBookmark(bookmark: BookmarkEntity) {
        bookmarkRepository.delete(bookmark)
    }

    /**
     * 切换书签的主页显示状态。
     *
     * @param bookmark 要切换的书签实体
     */
    suspend fun toggleShowOnHome(bookmark: BookmarkEntity) {
        bookmarkRepository.toggleShowOnHome(bookmark)
    }

    /**
     * 更新书签（编辑标题、URL 等）。
     *
     * @param bookmark 更新后的书签实体
     */
    suspend fun updateBookmark(bookmark: BookmarkEntity) {
        bookmarkRepository.update(bookmark)
    }
}
