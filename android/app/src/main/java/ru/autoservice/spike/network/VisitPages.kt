package ru.autoservice.spike.network

internal data class VisitPage<T>(val items: List<T>, val nextCursor: String?)

internal suspend fun <T> collectVisitPages(load: suspend (String?) -> VisitPage<T>): List<T> {
    val result = mutableListOf<T>()
    val seenCursors = mutableSetOf<String>()
    var cursor: String? = null
    do {
        val page = load(cursor)
        result += page.items
        cursor = page.nextCursor
        require(cursor == null || seenCursors.add(cursor)) { "Сервер повторил страницу визитов. Повторите обновление." }
    } while (cursor != null)
    return result
}
