package ru.autoservice.spike

import android.os.Bundle
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.runBlocking
import ru.autoservice.spike.data.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import java.io.File
import java.util.UUID
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.autoservice.spike.network.AuthSession

class RealActivityRotationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun filledIntakeSurvivesActivityRecreation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Runs only with disposable isolated package", context.packageName.endsWith(".migrationqa20261103"))
        assumeTrue("Runs only with isolated API endpoint", BuildConfig.API_BASE_URL == "http://127.0.0.1:18779")
        val root = (context.applicationContext as AutoServiceApplication).container
        compose.runOnIdle { root.authStore.save(AuthSession("synthetic", Long.MAX_VALUE, "synthetic", Long.MAX_VALUE,
            "test-user", "81111111-1111-4111-8111-111111111111", "Synthetic", "ADMIN", false)) }
        try {
            compose.waitUntil(20_000) { compose.onAllNodes(hasText("Принять автомобиль")).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Принять автомобиль").performClick()
            fun field(label: String) = compose.onNodeWithTag("intake-form").performScrollToNode(hasText(label)).let { compose.onNodeWithText(label) }
            field("Телефон клиента *").performTextInput("9991234567")
            field("Имя клиента").performTextInput("Тестовый клиент")
            field("Автомобиль").performTextInput("Тестовая машина")
            field("Пробег, км").performTextInput("12345")
            field("Жалобы клиента").performTextInput("Тестовая жалоба")
            if (InstrumentationRegistry.getArguments().getString("manualRotation") == "true") {
                val initial = compose.activity.resources.configuration.orientation
                InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply { putString("stream", "REAL_SCREEN_ROTATION_READY initial=$initial\n") })
                compose.waitUntil(300_000) { compose.activity.resources.configuration.orientation != initial }
            } else compose.activityRule.scenario.recreate()
            compose.waitForIdle()
            compose.onNodeWithTag("intake-form").assertExists()
            field("Телефон клиента *").assertTextContains("9991234567")
            field("Имя клиента").assertTextContains("Тестовый клиент")
            field("Автомобиль").assertTextContains("Тестовая машина")
            field("Пробег, км").assertTextContains("12345")
            field("Жалобы клиента").assertTextContains("Тестовая жалоба")
        } finally { root.authStore.clear() }
    }
    @Test fun voiceRecordingIsSavedWhenLeavingVisit() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Runs only with disposable isolated package", context.packageName.endsWith(".migrationqa20261103"))
        assumeTrue("Runs only with isolated API endpoint", BuildConfig.API_BASE_URL == "http://127.0.0.1:18779")
        assumeTrue("Manual test requires isolated microphone permission", ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
        val root = (context.applicationContext as AutoServiceApplication).container
        val workshopId = "81111111-1111-4111-8111-111111111111"
        val visitId = UUID.randomUUID().toString()
        val workshop = root.forWorkshop(workshopId)
        runBlocking { workshop.database.visitDao().upsert(VisitEntity(visitId, "QA", "+79990000000", "SyntheticVoiceCar", "", null, "", VisitStatus.IN_REPAIR, 1, 1, SyncState.LOCAL)) }
        compose.runOnIdle { root.authStore.save(AuthSession("synthetic", Long.MAX_VALUE, "synthetic", Long.MAX_VALUE,
            "test-user", workshopId, "Synthetic", "ADMIN", false)) }
        try {
            compose.waitUntil(20_000) { compose.onAllNodes(hasText("SyntheticVoiceCar")).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("SyntheticVoiceCar").performClick()
            compose.onNodeWithText("Голос").performClick()
            compose.waitUntil(5_000) { compose.onAllNodes(hasText("Стоп")).fetchSemanticsNodes().isNotEmpty() }
            Thread.sleep(1800)
            compose.onNodeWithText("Визиты").performClick()
            compose.waitUntil(20_000) { runBlocking { workshop.database.mediaDao().forVisit(visitId).any { it.kind == MediaKind.VOICE } } }
            val asset = runBlocking { workshop.database.mediaDao().forVisit(visitId).single { it.kind == MediaKind.VOICE } }
            assertEquals(visitId, asset.visitId)
            assertTrue(File(asset.localPath).length() > 100)
        } finally { root.authStore.clear() }
    }

}
