package ru.autoservice.spike

import android.app.KeyguardManager
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
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
        queue.performScrollToNode(hasText("Завершённый автомобиль"))
        compose.onNodeWithText("Завершённый автомобиль").assertIsDisplayed().performClick()
        compose.waitUntil(5_000) { opened == "completed" }
        compose.runOnIdle { assertEquals("completed", opened) }
    }
}
