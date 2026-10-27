package ru.autoservice.spike.ui

internal const val MIN_PASSWORD_LENGTH = 5
internal fun isValidNewPassword(value: String) = value.length in MIN_PASSWORD_LENGTH..256
