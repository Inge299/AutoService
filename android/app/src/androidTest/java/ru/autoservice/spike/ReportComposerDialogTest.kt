package ru.autoservice.spike

import android.graphics.Bitmap
import android.app.KeyguardManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.autoservice.spike.data.ReportDraft
import ru.autoservice.spike.ui.ReportComposerDialog
import ru.autoservice.spike.ui.ReportRecommendationOption
import ru.autoservice.spike.ui.theme.AutoServiceTheme
import java.io.File

class ReportComposerDialogTest {
    @get:Rule val compose = createComposeRule()

    @Before fun deviceMustBeUnlocked() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeFalse("Unlock the device before running the UI test", context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
    }

    @Test fun pendingMediaBlocksPublicationAndExpectedSetIsFrozen() {
        var published: ReportDraft? = null
        var pending by mutableStateOf(1)
        var ids by mutableStateOf(listOf("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))
        compose.setContent {
            AutoServiceTheme {
                ReportComposerDialog("Диагностика", "", null, onDismiss = {}, onPublish = { published = it }, expectedMediaIds = ids, pendingMediaCount = pending)
            }
        }
        compose.onNodeWithText("Проверить отчёт").assertIsNotEnabled()
        compose.runOnIdle { pending = 0; ids = ids + "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
        compose.onNodeWithText("Проверить отчёт").performClick()
        compose.onNodeWithText("Опубликовать отчёт").performClick()
        compose.runOnIdle { assertTrue(published?.expectedMediaIds == listOf("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")) }
    }

    @Test fun privateFindingAcknowledgementIsFrozenWhenComposerOpens() {
        var published: ReportDraft? = null
        var privateIds by mutableStateOf(listOf("11111111-1111-4111-8111-111111111111"))
        compose.setContent {
            AutoServiceTheme {
                ReportComposerDialog("Диагностика", "", null, onDismiss = {}, onPublish = { published = it }, privateFindingIds = privateIds)
            }
        }
        compose.onNodeWithText("Черновики и их материалы не войдут в отчёт: 1. Чтобы рекомендовать работу клиенту, опишите её в рекомендациях.").assertIsDisplayed()
        compose.runOnIdle { privateIds = privateIds + "22222222-2222-4222-8222-222222222222" }
        compose.onNodeWithText("Проверить отчёт").performClick()
        compose.onNodeWithText("Опубликовать отчёт").performClick()
        compose.runOnIdle { assertTrue(published?.acknowledgedPrivateFindingIds == listOf("11111111-1111-4111-8111-111111111111")) }
    }

    @Test fun selectedDraftIsExplicitlyRecommendedWithoutImplyingConsent() {
        val id = "11111111-1111-4111-8111-111111111111"
        var published: ReportDraft? = null
        compose.setContent { AutoServiceTheme {
            ReportComposerDialog("Диагностика", "", null, onDismiss = {}, onPublish = { published = it },
                privateFindingIds = listOf(id), privateRecommendationOptions = listOf(ReportRecommendationOption(id, "Заменить ремень", null)))
        } }
        compose.onNodeWithText("Заменить ремень").performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("Проверить отчёт")[0].assertIsDisplayed()
        compose.onNodeWithText("Заменить ремень").performClick()
        compose.onNodeWithText("Проверить отчёт").performClick()
        compose.onNodeWithText("Клиент ещё не согласовал эти работы; их материалы не публикуются.").performScrollTo().assertIsDisplayed()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            File(instrumentation.targetContext.cacheDir, "report-recommendation-review-qa.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        compose.onNodeWithText("Опубликовать отчёт").performClick()
        compose.runOnIdle { assertTrue(published?.recommendedPrivateFindingIds == listOf(id)) }
    }

    @Test fun reportActionsStayVisibleAndDatePresetPublishesSelectedDate() {
        var published: ReportDraft? = null
        compose.setContent {
            AutoServiceTheme {
                ReportComposerDialog("Заменён фильтр", "", null,
                    onDismiss = {}, onPublish = { published = it }, completedFindingTitles = listOf("Заменён фильтр"),
                    futureFindingTitles = listOf("Заменить ремень"))
            }
        }
        val publish = compose.onNodeWithText("Проверить отчёт").assertIsDisplayed()
        val cancel = compose.onNodeWithText("Отмена").assertIsDisplayed()
        assertTrue(cancel.fetchSemanticsNode().boundsInRoot.top > publish.fetchSemanticsNode().boundsInRoot.bottom)
        // Scroll the outer form before interacting with its nested horizontal presets.
        compose.onNodeWithText("Дату можно не назначать.").performScrollTo()
        compose.onNodeWithText("Через месяц").performScrollTo().assertIsDisplayed().performClick()
        compose.waitForIdle()
        val expectedDate = java.time.LocalDate.now(java.time.ZoneId.of("Europe/Moscow")).plusMonths(1).format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy"))
        compose.waitUntil(5_000) { compose.onAllNodesWithText(expectedDate).fetchSemanticsNodes().isNotEmpty() }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            File(instrumentation.targetContext.cacheDir, "report-composer-qa.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        compose.onNodeWithText(expectedDate).assertExists()
        publish.assertIsDisplayed().performClick()
        compose.onNodeWithText("Проверьте перед публикацией").assertIsDisplayed()
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            File(instrumentation.targetContext.cacheDir, "report-review-qa.png").outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        compose.onNodeWithText("Опубликовать отчёт").performClick()
        compose.waitUntil(5_000) { published != null }
        compose.runOnIdle {
            assertNotNull("Selected date was not included in the report", published?.nextVisitAtEpochMs)
            assertTrue(published!!.recommendations.contains("Не выполнено в этот визит: Заменить ремень. Необходимо выполнить в дальнейшем."))
            assertTrue(published!!.recommendations.contains("Рекомендуемый срок: до $expectedDate."))
        }
        instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "UI_REPORT_VERIFIED\n") })
    }
}
