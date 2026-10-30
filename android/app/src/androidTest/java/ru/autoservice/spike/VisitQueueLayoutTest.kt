package ru.autoservice.spike

import android.app.KeyguardManager
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.autoservice.spike.data.SyncState
import ru.autoservice.spike.data.VisitEntity
import ru.autoservice.spike.data.VisitStatus
import ru.autoservice.spike.ui.theme.AutoServiceTheme

class VisitQueueLayoutTest {
    @get:Rule val compose = createComposeRule()
    @Before fun unlocked() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeFalse(context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
    }

    @Test fun queueAndArchiveRemainReachableWithLargeFont() {
        var opened: String? = null
        fun visit(id: String, label: String, status: VisitStatus) = VisitEntity(id, "Тестовый клиент", "+79990000000",
            label, "А123АА77", null, "Проверка", status, 1, 1, SyncState.SYNCED)
        val active = visit("active", "Активный автомобиль", VisitStatus.IN_REPAIR)
        val completed = visit("completed", "Завершённый автомобиль", VisitStatus.COMPLETED)
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 2f)) {
                AutoServiceTheme {
                    VisitsScreen(listOf(completed, active), emptyList(), {}, { opened = it.id })
                }
            }
        }
        val queue = compose.onNodeWithTag("visit-queue")
        queue.performScrollToNode(hasText("Активный автомобиль"))
        compose.onNodeWithText("Активный автомобиль").assertIsDisplayed().performClick()
        compose.waitUntil(5_000) { opened == "active" }
        queue.performScrollToNode(hasTestTag("queue-filter-ARCHIVE"))
        compose.onNodeWithTag("queue-filter-ARCHIVE").performScrollTo().performClick()
        queue.performScrollToNode(hasText("Завершённый автомобиль"))
        compose.onNodeWithText("Завершённый автомобиль").assertIsDisplayed().performClick()
        compose.waitUntil(5_000) { opened == "completed" }
        compose.runOnIdle { assertEquals("completed", opened) }
    }

    @Test fun searchFindsLatinPlateAndArchiveKeepsQuery() {
        val active = VisitEntity("active", "Семён", "+79991112233", "Тестовый активный", "А123ВС77", null, "", VisitStatus.DRAFT, 1, 1, SyncState.SYNCED)
        val completed = active.copy(id = "closed", vehicleLabel = "Тестовый архивный", status = VisitStatus.COMPLETED)
        compose.setContent { AutoServiceTheme { VisitsScreen(listOf(active, completed), emptyList(), {}, {}) } }
        val queue = compose.onNodeWithTag("visit-queue")
        queue.performScrollToNode(hasTestTag("queue-search"))
        compose.onNodeWithTag("queue-search").performTextInput("a123bc77")
        queue.performScrollToNode(hasText("Тестовый активный"))
        compose.onNodeWithText("Тестовый активный").assertIsDisplayed()
        queue.performScrollToNode(hasTestTag("queue-filter-ARCHIVE"))
        compose.onNodeWithTag("queue-filter-ARCHIVE").performScrollTo().performClick()
        queue.performScrollToNode(hasText("Тестовый архивный"))
        compose.onNodeWithText("Тестовый архивный").assertIsDisplayed()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            java.io.File(instrumentation.targetContext.cacheDir, "queue-search-qa.png").outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
        }
    }
    @Test fun uploadSummaryFindsACompletedVisitWithFailedMedia() {
        val active = VisitEntity("active", "QA", "+79991112233", "Обычный визит", "А123ВС77", null, "", VisitStatus.DRAFT, 1, 1, SyncState.SYNCED)
        val completed = active.copy(id = "closed", vehicleLabel = "QA Проблемная загрузка", status = VisitStatus.COMPLETED)
        val asset = ru.autoservice.spike.data.MediaAssetEntity("asset", "operation", completed.id, null,
            ru.autoservice.spike.data.MediaKind.PHOTO, "image/jpeg", "/qa-not-used.jpg", 1, "qa", SyncState.RETRY,
            1, null, "Synthetic error", 1, 1)
        var opened: String? = null
        compose.setContent { AutoServiceTheme { VisitsScreen(listOf(active, completed), listOf(asset), {}, { opened = it.id }) } }
        compose.onNodeWithText("Нужно проверить: 1").performScrollTo().performClick()
        compose.onNodeWithTag("visit-queue").performScrollToNode(hasText("QA Проблемная загрузка"))
        compose.onNodeWithText("QA Проблемная загрузка").performClick()
        compose.runOnIdle { assertEquals("closed", opened) }
    }
}
