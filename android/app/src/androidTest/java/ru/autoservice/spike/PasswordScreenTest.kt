package ru.autoservice.spike

import android.app.KeyguardManager
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeFalse
import org.junit.Rule
import org.junit.Test
import ru.autoservice.spike.ui.theme.AutoServiceTheme

class PasswordScreenTest {
    @get:Rule val compose = createComposeRule()
    @Test fun enablesSaveAtFiveMatchingCharacters() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeFalse(context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
        var saved: String? = null
        compose.setContent { AutoServiceTheme { ChangePasswordScreen(onSubmit = { _, password, completed -> saved = password; completed() }, onLogout = {}) } }
        compose.onNodeWithText("Временный пароль").performTextInput("temporary")
        compose.onNodeWithText("Новый пароль").performTextInput("Qa12")
        compose.onNodeWithText("Повторите пароль").performTextInput("Qa12")
        compose.onNodeWithText("Сохранить пароль").assertIsNotEnabled()
        compose.onNodeWithText("Новый пароль").performTextClearance(); compose.onNodeWithText("Новый пароль").performTextInput("Qa123")
        compose.onNodeWithText("Повторите пароль").performTextClearance(); compose.onNodeWithText("Повторите пароль").performTextInput("Qa123")
        compose.onNodeWithText("Сохранить пароль").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals("Qa123", saved) }
    }
}
