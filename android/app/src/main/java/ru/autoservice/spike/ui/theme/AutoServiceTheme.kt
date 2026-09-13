package ru.autoservice.spike.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

private val AutoServiceColors = lightColorScheme(
    primary = Color(0xFF0F6B78),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDDEFF1),
    onPrimaryContainer = Color(0xFF00363E),
    secondary = Color(0xFF365F9C),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFD9E2FF),
    onSecondaryContainer = Color(0xFF001A41),
    tertiary = Color(0xFF1E7A46),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFE2F3E8),
    onTertiaryContainer = Color(0xFF07371B),
    error = Color(0xFFB3261E),
    onError = Color.White,
    errorContainer = Color(0xFFFBE9E7),
    onErrorContainer = Color(0xFF410002),
    background = Color(0xFFF7F7F8),
    onBackground = Color(0xFF1B1B1F),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1B1B1F),
    surfaceVariant = Color(0xFFF1F4F3),
    onSurfaceVariant = Color(0xFF5F6368),
    outline = Color(0xFFD9DDE3),
)

private val AutoServiceShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
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
