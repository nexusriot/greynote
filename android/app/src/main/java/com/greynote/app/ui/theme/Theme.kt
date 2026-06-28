package com.greynote.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Dark = darkColorScheme(
    primary = Blue300,
    onPrimary = Color(0xFF003258),
    primaryContainer = BlueGrey700,
    onPrimaryContainer = BlueGrey200,
    secondary = BlueGrey200,
    onSecondary = Color.Black,
    background = Color(0xFF121212),
    onBackground = OnSurfDark,
    surface = SurfaceDark,
    onSurface = OnSurfDark,
    surfaceVariant = SurfaceDark2,
    onSurfaceVariant = MutedDark,
    outline = Color(0xFF444444),
    error = Color(0xFFFF6B6B),
)

private val Light = lightColorScheme(
    primary = Blue700,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD6E4FF),
    onPrimaryContainer = Color(0xFF001D36),
    secondary = BlueGrey700,
    onSecondary = Color.White,
    background = Color.White,
    onBackground = OnSurfLight,
    surface = SurfaceLight,
    onSurface = OnSurfLight,
    surfaceVariant = Color(0xFFECEFF1),
    onSurfaceVariant = MutedLight,
    outline = Color(0xFFCCCCCC),
    error = DangerRed,
)

@Composable
fun GreyNoteTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) Dark else Light,
        typography = Typography,
        content = content,
    )
}
