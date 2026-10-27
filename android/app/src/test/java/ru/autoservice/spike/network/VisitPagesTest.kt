package ru.autoservice.spike.network

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class VisitPagesTest {
    @Test fun loadsMoreThanTwoHundredVisitsIncludingTheFinalPartialPage() = runTest {
        val requested = mutableListOf<String?>()
        val rows = collectVisitPages { cursor ->
            requested += cursor
            when (cursor) {
                null -> VisitPage((0 until 200).toList(), "page2")
                "page2" -> VisitPage((200 until 400).toList(), "page3")
                else -> VisitPage((400 until 437).toList(), null)
            }
        }
        assertEquals((0 until 437).toList(), rows)
        assertEquals(listOf(null, "page2", "page3"), requested)
    }
    @Test(expected = IllegalArgumentException::class) fun repeatedCursorStopsInsteadOfLoopingForever() = runTest {
        collectVisitPages { VisitPage(listOf(1), "repeated") }
    }
    @Test(expected = java.io.IOException::class) fun failedSecondPageDoesNotReturnAnIncompleteSuccessfulSnapshot() = runTest {
        collectVisitPages { cursor ->
            if (cursor != null) throw java.io.IOException("Synthetic network failure")
            VisitPage(listOf(1), "page2")
        }
    }
}
