import groovy.json.JsonSlurper
import java.util.Properties
import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}
/** Private build values stay in ignored local.properties or the deploy checkout's android.properties. */
val localBuildProperties = Properties().apply {
    val configured = providers.environmentVariable("HARNESS_ANDROID_PROPERTIES").orNull
    val file = if (configured != null) file(configured) else rootProject.file("local.properties")
    if (file.isFile) file.inputStream().use { load(it) }
}
fun privateBuildProperty(name: String, environment: String, fallback: String = ""): String =
    providers.gradleProperty(name).orElse(providers.environmentVariable(environment)).orNull
        ?: localBuildProperties.getProperty(name, fallback)
val installedApplicationId = privateBuildProperty("harness.applicationId", "AIKI_ANDROID_APPLICATION_ID", "io.github.mitzacoder.aiki")
val preferencesPrefix = privateBuildProperty("harness.preferencesPrefix", "AIKI_ANDROID_PREFERENCES_PREFIX", "aiki")
val notificationIntentPrefix = privateBuildProperty("harness.notificationIntentPrefix", "AIKI_ANDROID_NOTIFICATION_INTENT_PREFIX", installedApplicationId)
val appOrigin = privateBuildProperty("harness.appOrigin", "HARNESS_APP_ORIGIN", "https://app.example.invalid")
val appUri = URI(appOrigin)
require(appUri.scheme == "https" && appUri.host != null && appUri.rawUserInfo == null &&
    appUri.port == -1 && appUri.rawPath.orEmpty() in listOf("", "/") && appUri.rawQuery == null && appUri.rawFragment == null) {
    "harness.appOrigin must be a plain HTTPS origin"
}
val publishedBackendsUrl = privateBuildProperty("harness.publishedBackendsUrl", "HARNESS_PUBLISHED_BACKENDS_URL")
fun buildString(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\""

/**
 * Firebase (FCM) is optional: its client config is read from a google-services.json outside the repo, named by the
 * Gradle property `harness.googleServicesJson` or the environment variable `HARNESS_GOOGLE_SERVICES_JSON`. Without one
 * the build still works and push is off. Only the four public client values reach BuildConfig; the file is never copied.
 */
val firebaseConfig: Map<String, String> = run {
    val path = privateBuildProperty("harness.googleServicesJson", "HARNESS_GOOGLE_SERVICES_JSON").trim()
        ?.takeIf { it.isNotEmpty() }?.replaceFirst(Regex("^~(?=/|$)"), System.getProperty("user.home"))
        ?: return@run emptyMap()
    val text = providers.fileContents(layout.projectDirectory.file(path)).asText.orNull
        ?: throw GradleException("google-services.json not found at $path")
    @Suppress("UNCHECKED_CAST")
    val json = JsonSlurper().parseText(text) as Map<String, Any?>
    val project = json["project_info"] as Map<String, Any?>
    @Suppress("UNCHECKED_CAST")
    val client = (json["client"] as List<Map<String, Any?>>).firstOrNull {
        ((it["client_info"] as Map<String, Any?>)["android_client_info"] as Map<String, Any?>)["package_name"] == installedApplicationId
    } ?: throw GradleException("Firebase configuration has no Android client for the configured application ID")
    @Suppress("UNCHECKED_CAST")
    mapOf(
        "FIREBASE_APP_ID" to (client["client_info"] as Map<String, Any?>)["mobilesdk_app_id"].toString(),
        "FIREBASE_API_KEY" to ((client["api_key"] as List<Map<String, Any?>>).first()["current_key"]).toString(),
        "FIREBASE_PROJECT_ID" to project["project_id"].toString(),
        "FIREBASE_SENDER_ID" to project["project_number"].toString(),
    )
}

android {
    namespace = "io.github.mitzacoder.aiki"
    compileSdk = 37
    buildToolsVersion = "37.0.0"
    defaultConfig {
        applicationId = installedApplicationId
        minSdk = 31
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["appLinkHost"] = appUri.host
        manifestPlaceholders["previousActivityAlias"] = if (installedApplicationId != "io.github.mitzacoder.aiki") "$installedApplicationId.MainActivity" else "io.github.mitzacoder.aiki.PreviousActivity"
        manifestPlaceholders["previousActivityEnabled"] = (installedApplicationId != "io.github.mitzacoder.aiki").toString()
        buildConfigField("String", "PREFERENCES_PREFIX", buildString(preferencesPrefix))
        buildConfigField("String", "NOTIFICATION_INTENT_PREFIX", buildString(notificationIntentPrefix))
        buildConfigField("String", "APP_ORIGIN", buildString(appOrigin.trimEnd('/')))
        buildConfigField("String", "APP_LINK_HOST", buildString(appUri.host))
        buildConfigField("String", "PUBLISHED_BACKENDS_URL", buildString(publishedBackendsUrl))
        for (name in listOf("FIREBASE_APP_ID", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_SENDER_ID")) {
            buildConfigField("String", name, "\"${firebaseConfig[name].orEmpty()}\"")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true; buildConfig = true }
    testOptions.unitTests.isReturnDefaultValues = true
}
// JVM relay tests read this one fixture directly; changing it must invalidate Gradle's test cache.
tasks.withType<Test>().configureEach {
    inputs.file(rootProject.file("../../packages/protocol/test-vectors/push-relay-v1.json"))
        .withPropertyName("pushRelayVectors")
}

dependencies {
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("io.github.rosemoe:language-textmate:0.24.6")
    implementation("io.github.rosemoe:editor:0.24.6")
    implementation("org.commonmark:commonmark:0.30.0")
    implementation("org.commonmark:commonmark-ext-gfm-tables:0.30.0")
    implementation("io.coil-kt.coil3:coil-compose:3.6.3")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.6.3")
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.datastore:datastore-preferences:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    implementation("com.google.firebase:firebase-messaging:26.0.1")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    testImplementation("com.squareup.okhttp3:mockwebserver3:5.5.0")
}
