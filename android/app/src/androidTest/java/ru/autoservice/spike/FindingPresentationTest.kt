package ru.autoservice.spike

import android.app.KeyguardManager
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.FindingPriority
import ru.autoservice.spike.data.FindingStatus
import ru.autoservice.spike.ui.theme.AutoServiceTheme

class FindingPresentationTest {
    @get:Rule val compose = createComposeRule()
    @Before fun unlocked() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeFalse(context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
    }
    private fun finding(status: FindingStatus) = FindingEntity("qa", "visit", "QA работа", "QA", 1000,
        FindingPriority.IMPORTANT, status, 1, 1, serverVersion = 1, approvalPreparationState = "READY")
    @Test fun linkReadyDoesNotClaimDeliveryAndTimelineWaitsForDecision() {
        compose.setContent { AutoServiceTheme { Column(Modifier.verticalScroll(rememberScrollState())) {
            FindingCard(finding(FindingStatus.SENT_TO_CUSTOMER), emptyList(), false, {}, {}, false, {}, {}, {}, {}, {}, {}, {}, {})
            VisitTimeline(1, 0, 1, 0, 0, 0, true)
        } } }
        compose.onNodeWithText("Ожидает решения").assertExists()
        compose.onNodeWithText("У клиента").assertDoesNotExist()
        compose.onNodeWithText("Ожидают решения: 1").assertExists()
        compose.onNodeWithText("Согласование не готово").assertDoesNotExist()
    }
    @Test fun closedVisitHasNoEditingOrStaleShareInstructions() {
        compose.setContent { AutoServiceTheme { Column(Modifier.verticalScroll(rememberScrollState())) {
            FindingCard(finding(FindingStatus.APPROVED), emptyList(), true, {}, {}, false, {}, {}, {}, {}, {}, {}, {}, {})
        } } }
        compose.onNodeWithText("Согласовано").assertExists()
        compose.onNodeWithText("Фото / видео").assertDoesNotExist()
        compose.onNodeWithText("Голос").assertDoesNotExist()
        compose.onNodeWithText("Отметить выполненной").assertDoesNotExist()
        compose.onNodeWithText("Ссылка готова · отправьте её через «Поделиться»").assertDoesNotExist()
    }
    @Test fun receivedDecisionDoesNotOfferAnUnsentLink() {
        compose.setContent { AutoServiceTheme { Column(Modifier.verticalScroll(rememberScrollState())) {
            FindingCard(finding(FindingStatus.APPROVED), emptyList(), false, {}, {}, false, {}, {}, {}, {}, {}, {}, {}, {})
        } } }
        compose.onNodeWithText("Отметить выполненной").assertExists()
        compose.onNodeWithText("Ссылка готова · отправьте её через «Поделиться»").assertDoesNotExist()
    }
}
