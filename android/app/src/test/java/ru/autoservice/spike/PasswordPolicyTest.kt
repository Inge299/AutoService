package ru.autoservice.spike

import org.junit.Assert.*
import org.junit.Test
import ru.autoservice.spike.ui.isValidNewPassword

class PasswordPolicyTest {
    @Test fun acceptsSixThrough256CharactersWithoutTrimmingThePassword() {
        assertFalse(isValidNewPassword("1234")); assertFalse(isValidNewPassword("12345")); assertTrue(isValidNewPassword("123456"))
        assertTrue(isValidNewPassword("x".repeat(256))); assertFalse(isValidNewPassword("x".repeat(257)))
    }
}
