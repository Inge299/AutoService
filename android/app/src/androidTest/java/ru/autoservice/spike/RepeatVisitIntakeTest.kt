package ru.autoservice.spike

import android.app.KeyguardManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.autoservice.spike.data.VisitDraft
import ru.autoservice.spike.network.CustomerMatch
import ru.autoservice.spike.network.CustomerVehicle
import ru.autoservice.spike.ui.theme.AutoServiceTheme

class RepeatVisitIntakeTest {
    @get:Rule val compose = createComposeRule()

    @Before fun deviceMustBeUnlocked() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeFalse("Unlock the device before running the UI test", context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
    }

    @Test fun phoneSearchOffersAllCarsAndSavesTheSelectedOne() {
        var searched: String? = null
        var saved: VisitDraft? = null
        compose.setContent {
            AutoServiceTheme {
                IntakeScreen(onSearchCustomers = { query ->
                    searched = query
                    listOf(CustomerMatch("test-client", "Тестовый клиент", "+79990000000", listOf(
                        CustomerVehicle("car-1", "Lada", "А123АА77"), CustomerVehicle("car-2", "Toyota", "В456ВВ77"))))
                }, vehicleBrands = emptyList(), commonComplaints = emptyList(), onCancel = {}, onSave = { saved = it })
            }
        }
        compose.onNodeWithText("Госномер или телефон клиента").performTextInput("9990000000")
        scrollTo("Найти клиента").performClick()
        compose.waitForIdle()
        scrollTo("Lada · А123АА77").assertIsDisplayed()
        scrollTo("Toyota · В456ВВ77").performClick()
        scrollTo("Выбран: Toyota · В456ВВ77. Укажите текущий пробег и жалобы.").assertIsDisplayed()
        scrollTo("Пробег, км").performTextInput("105000")
        scrollTo("Жалобы клиента").performTextInput("Новая жалоба")
        scrollTo("Сохранить")
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            java.io.File(instrumentation.targetContext.cacheDir, "intake-save-qa.png").outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        compose.onNodeWithText("Сохранить").assertIsDisplayed().performClick()
        compose.waitUntil(5_000) { saved != null }
        compose.runOnIdle {
            assertEquals("9990000000", searched)
            assertNotNull(saved)
            assertEquals("Тестовый клиент", saved!!.customerName)
            assertEquals("+79990000000", saved!!.customerPhone)
            assertEquals("Toyota", saved!!.vehicleLabel)
            assertEquals("В456ВВ77", saved!!.licensePlate)
            assertEquals(105000, saved!!.mileageKm)
            assertEquals("Новая жалоба", saved!!.complaint)
        }
    }

    @Test fun failedSearchIsNotShownAsAnEmptyCustomerDatabase() {
        compose.setContent {
            AutoServiceTheme {
                IntakeScreen(onSearchCustomers = { throw java.io.IOException("synthetic network failure") },
                    vehicleBrands = emptyList(), commonComplaints = emptyList(), onCancel = {}, onSave = {})
            }
        }
        compose.onNodeWithText("Госномер или телефон клиента").performTextInput("А123АА77")
        scrollTo("Найти клиента").performClick()
        compose.waitForIdle()
        scrollTo("Не удалось выполнить поиск. Проверьте соединение и повторите.").assertIsDisplayed()
    }

    private fun scrollTo(text: String): androidx.compose.ui.test.SemanticsNodeInteraction {
        compose.onNodeWithTag("intake-form").performScrollToNode(hasText(text))
        compose.waitForIdle()
        return compose.onNodeWithText(text)
    }
}
