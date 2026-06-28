# Retrofit + OkHttp
-dontwarn okhttp3.**
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keep interface retrofit2.** { *; }

# Gson models
-keep class com.greynote.app.api.model.** { *; }

# Markwon
-keep class io.noties.markwon.** { *; }

# Kotlin coroutines
-keepclassmembernames class kotlinx.** {
    volatile <fields>;
}
