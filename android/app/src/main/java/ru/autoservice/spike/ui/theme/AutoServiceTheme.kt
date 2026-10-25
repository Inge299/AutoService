package ru.autoservice.spike.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

private val AutoServiceColors = lightColorScheme(
    primary = Color(0xFF1C4F8C),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE7EEF8),
    onPrimaryContainer = Color(0xFF12375F),
    secondary = Color(0xFF315F9B),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFD9E2FF),
    onSecondaryContainer = Color(0xFF001A41),
    tertiary = Color(0xFF267147),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFE2F3E8),
    onTertiaryContainer = Color(0xFF07371B),
    error = Color(0xFFAA3028),
    onError = Color.White,
    errorContainer = Color(0xFFFBE9E7),
    onErrorContainer = Color(0xFF410002),
    background = Color(0xFFF6F7F9),
    onBackground = Color(0xFF20242B),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF20242B),
    surfaceVariant = Color(0xFFF0F3F7),
    onSurfaceVariant = Color(0xFF5B6470),
    outline = Color(0xFFD6DBE3),
)

private val AutoServiceShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

@Composable
fun AutoServiceTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AutoServiceColors,
        typography = AutoServiceTypography,
        shapes = AutoServiceShapes,
        content = content,
    )
}
