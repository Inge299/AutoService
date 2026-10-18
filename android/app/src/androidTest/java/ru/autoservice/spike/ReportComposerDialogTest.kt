package ru.autoservice.spike

import android.graphics.Bitmap
import android.app.KeyguardManager
import androidx.compose.ui.test.assertIsDisplayed
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
import ru.autoservice.spike.ui.theme.AutoServiceTheme
import java.io.File

class ReportComposerDialogTest {
    @get:Rule val compose = createComposeRule()

    @Before fun deviceMustBeUnlocked() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeFalse("Unlock the device before running the UI test", context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
    }

    @Test fun reportActionsStayVisibleAndDatePresetPublishesSelectedDate() {
        var published: ReportDraft? = null
        compose.setContent {
            AutoServiceTheme {
                ReportComposerDialog("Заменён фильтр", "", null,
                    onDismiss = {}, onPublish = { published = it }, completedFindingTitles = listOf("Заменён фильтр"))
            }
        }
        val publish = compose.onNodeWithText("Опубликовать отчёт").assertIsDisplayed()
        val cancel = compose.onNodeWithText("Отмена").assertIsDisplayed()
        assertTrue(cancel.fetchSemanticsNode().boundsInRoot.top > publish.fetchSemanticsNode().boundsInRoot.bottom)
        compose.onNodeWithText("Через месяц").performScrollTo().performClick()
        compose.waitForIdle()
        val expectedDate = java.time.LocalDate.now().plusMonths(1).format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy"))
        compose.waitUntil(5_000) { compose.onAllNodesWithText(expectedDate).fetchSemanticsNodes().isNotEmpty() }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            File(instrumentation.targetContext.cacheDir, "report-composer-qa.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        compose.onNodeWithText(expectedDate).assertExists()
        publish.assertIsDisplayed().performClick()
        compose.waitUntil(5_000) { published != null }
        compose.runOnIdle { assertNotNull("Selected date was not included in the report", published?.nextVisitAtEpochMs) }
        instrumentation.sendStatus(0, android.os.Bundle().apply { putString("stream", "UI_REPORT_VERIFIED\n") })
    }
}
