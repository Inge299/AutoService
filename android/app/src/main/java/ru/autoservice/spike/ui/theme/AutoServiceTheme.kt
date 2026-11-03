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
    primaryContainer = Color(0xFFE3F2F3),
    onPrimaryContainer = Color(0xFF0A4F59),
    secondary = Color(0xFF3F6F68),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE5F0ED),
    onSecondaryContainer = Color(0xFF244A44),
    tertiary = Color(0xFF1E7A46),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFE2F3E8),
    onTertiaryContainer = Color(0xFF07371B),
    error = Color(0xFFB3261E),
    onError = Color.White,
    errorContainer = Color(0xFFFBE9E7),
    onErrorContainer = Color(0xFF410002),
    background = Color(0xFFF2F7F5),
    onBackground = Color(0xFF1D2927),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1D2927),
    surfaceVariant = Color(0xFFF0F5F3),
    onSurfaceVariant = Color(0xFF626D6A),
    outline = Color(0xFFA8B7B2),
    outlineVariant = Color(0xFFDCE5E2),
    surfaceTint = Color(0xFF0F6B78),
    surfaceBright = Color(0xFFFFFFFF),
    surfaceDim = Color(0xFFDCE4E1),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF7FAF9),
    surfaceContainer = Color(0xFFF1F5F3),
    surfaceContainerHigh = Color(0xFFEBF0EE),
    surfaceContainerHighest = Color(0xFFE4EBE8),
    inverseSurface = Color(0xFF263330),
    inverseOnSurface = Color(0xFFEDF4F1),
    inversePrimary = Color(0xFF78D6DE),
    scrim = Color.Black,
)

private val AutoServiceShapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(24.dp),
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
