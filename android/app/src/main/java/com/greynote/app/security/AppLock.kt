package com.greynote.app.security

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Screen lock for the app. Device credential is allowed alongside biometrics so
 * a phone without a fingerprint sensor can still use the setting.
 */
object AppLock {
    private const val AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL

    fun isAvailable(activity: FragmentActivity): Boolean =
        BiometricManager.from(activity).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

    fun prompt(activity: FragmentActivity, onSuccess: () -> Unit, onFailure: () -> Unit) {
        if (!isAvailable(activity)) {
            // Nothing to authenticate against — never lock the user out of their
            // own notes because the device has no screen lock configured.
            onSuccess()
            return
        }

        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onFailure()
            },
        )

        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock GreyNote")
                .setSubtitle("Your notes are locked on this device")
                .setAllowedAuthenticators(AUTHENTICATORS)
                .build()
        )
    }
}
