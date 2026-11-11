import groovy.json.JsonSlurper
import java.util.Properties
import java.net.URI
import java.util.zip.ZipFile

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}
apply(plugin = "com.google.android.gms.oss-licenses-plugin")
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
val pushRelayUrl = privateBuildProperty("harness.pushRelayUrl", "HARNESS_PUSH_RELAY_URL").trim()
val relayGoogleClientId = privateBuildProperty("harness.relayGoogleClientId", "HARNESS_RELAY_GOOGLE_CLIENT_ID")
val relayEmailLinkDomain = privateBuildProperty("harness.relayEmailLinkDomain", "HARNESS_RELAY_EMAIL_LINK_DOMAIN")
val relayPrivacyContact = privateBuildProperty("harness.relayPrivacyContact", "HARNESS_RELAY_PRIVACY_CONTACT")
require(relayEmailLinkDomain.isEmpty() || Regex("[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?").matches(relayEmailLinkDomain)) {
    "harness.relayEmailLinkDomain must be a host, without a scheme or path"
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

/** Numeric SemVer slots, with pilot builds below the stable release in each patch slot. */
fun androidReleaseVersion(tag: String): Pair<String, Int> {
    val match = Regex("v?(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-pilot\\.([1-9][0-9]*))?").matchEntire(tag)
        ?: error("Expected vMAJOR.MINOR.PATCH[-pilot.N]")
    val (major, minor, patch) = match.groupValues.drop(1).take(3).map { it.toLong() }
    val pilot = match.groupValues[4].takeIf { it.isNotEmpty() }?.toLong() ?: 9999L
    require(major <= 20 && minor <= 99 && patch <= 99 && pilot in 1..9999 &&
        (match.groupValues[4].isEmpty() || pilot < 9999)) { "Android version slots exceeded" }
    return tag.removePrefix("v") to (major * 100_000_000 + minor * 1_000_000 + patch * 10_000 + pilot).toInt()
}
val releaseTag = providers.gradleProperty("aiki.version").orElse(providers.environmentVariable("AIKI_RELEASE_VERSION")).orNull
    ?: if (providers.environmentVariable("GITHUB_REF_TYPE").orNull == "tag") providers.environmentVariable("GITHUB_REF_NAME").orNull else null
val releaseVersion = releaseTag?.let(::androidReleaseVersion) ?: ("0.0.0-dev" to 1)
tasks.register("checkReleaseVersion") {
    val validCases = listOf(
        androidReleaseVersion("v0.1.0-pilot.1") == ("0.1.0-pilot.1" to 1_000_001),
        androidReleaseVersion("v0.1.0-pilot.2").second > androidReleaseVersion("v0.1.0-pilot.1").second,
        androidReleaseVersion("v0.1.0").second > androidReleaseVersion("v0.1.0-pilot.9998").second,
        androidReleaseVersion("v0.1.1-pilot.1").second > androidReleaseVersion("v0.1.0").second,
    )
    val invalidCases = listOf("main", "v01.1.0", "v0.100.0", "v21.0.0", "v0.1.0-pilot.0", "v0.1.0-pilot.9999", "v0.1.0-beta.1")
        .map { runCatching { androidReleaseVersion(it) }.isFailure }
    doLast { check(validCases.all { it } && invalidCases.all { it }) { "Android release version regression" } }
}

android {
    namespace = "io.github.mitzacoder.aiki"
    compileSdk = 37
    buildToolsVersion = "37.0.0"
    defaultConfig {
        applicationId = installedApplicationId
        minSdk = 31
        targetSdk = 37
        versionCode = releaseVersion.second
        versionName = releaseVersion.first
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["appLinkHost"] = appUri.host
        manifestPlaceholders["relayEmailLinkHost"] = relayEmailLinkDomain.ifEmpty { "relay.example.invalid" }
        buildConfigField("String", "RELAY_GOOGLE_CLIENT_ID", buildString(relayGoogleClientId))
        buildConfigField("String", "RELAY_EMAIL_LINK_DOMAIN", buildString(relayEmailLinkDomain))
        buildConfigField("String", "RELAY_PRIVACY_CONTACT", buildString(relayPrivacyContact))
        manifestPlaceholders["previousActivityAlias"] = if (installedApplicationId != "io.github.mitzacoder.aiki") "$installedApplicationId.MainActivity" else "io.github.mitzacoder.aiki.PreviousActivity"
        manifestPlaceholders["previousActivityEnabled"] = (installedApplicationId != "io.github.mitzacoder.aiki").toString()
        buildConfigField("String", "PREFERENCES_PREFIX", buildString(preferencesPrefix))
        buildConfigField("String", "NOTIFICATION_INTENT_PREFIX", buildString(notificationIntentPrefix))
        buildConfigField("String", "APP_ORIGIN", buildString(appOrigin.trimEnd('/')))
        buildConfigField("String", "APP_LINK_HOST", buildString(appUri.host))
        buildConfigField("String", "PUBLISHED_BACKENDS_URL", buildString(publishedBackendsUrl))
        buildConfigField("String", "PUSH_RELAY_URL", buildString(pushRelayUrl))
        for (name in listOf("FIREBASE_APP_ID", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_SENDER_ID")) {
            buildConfigField("String", name, "\"${firebaseConfig[name].orEmpty()}\"")
        }
    }
    sourceSets.getByName("main").assets.srcDir(rootProject.file("licenses"))
    buildTypes {
        getByName("debug") {
            buildConfigField("String", "RELAY_AUTH_EMULATOR", buildString(privateBuildProperty(
                "harness.relayAuthEmulator", "HARNESS_RELAY_AUTH_EMULATOR")))
            buildConfigField("boolean", "RELAY_FAKE_GOOGLE", privateBuildProperty(
                "harness.relayFakeGoogle", "HARNESS_RELAY_FAKE_GOOGLE", "false").toBoolean().toString())
            buildConfigField("boolean", "RELAY_FAKE_FCM", privateBuildProperty(
                "harness.relayFakeFcm", "HARNESS_RELAY_FAKE_FCM", "false").toBoolean().toString())
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
    inputs.file(rootProject.file("test-vectors/task-graph-v1.json")).withPropertyName("taskGraphVectors")
}

/** Asserts the shell-only delivery component can never be exported by a release APK. */
tasks.register("checkReleaseRelaySeam") {
    dependsOn("processReleaseManifest")
    val directory = layout.buildDirectory.dir("intermediates/merged_manifests/release").get().asFile
    doLast {
        val manifests = directory.walkTopDown().filter { it.isFile && it.name == "AndroidManifest.xml" }.toList()
        check(manifests.isNotEmpty()) { "Release manifest was not generated" }
        for (manifest in manifests) {
            val text = manifest.readText()
            check(!text.contains("DebugRelayReceiver") && !text.contains("DEBUG_RELAY")) {
                "Debug relay delivery must not be present in release"
            }
        }
    }
}

/** Checks the actual release APK, not just source-set intent. */
tasks.register("checkReleaseRelayAuth") {
    dependsOn("assembleRelease", "checkReleaseRelaySeam")
    val apk = layout.buildDirectory.file("outputs/apk/release/app-release-unsigned.apk").get().asFile
    doLast {
        check(apk.isFile) { "Release APK was not generated" }
        ZipFile(apk).use { archive ->
            archive.entries().asSequence().filter { it.name.endsWith(".dex") }.forEach { entry ->
                val content = archive.getInputStream(entry).use { it.readBytes().toString(Charsets.ISO_8859_1) }
                for (marker in listOf("RELAY_AUTH_EMULATOR", "RELAY_FAKE_GOOGLE", "RELAY_FAKE_FCM",
                    "demo-google-user", "demo-fcm-phone-token", "DebugRelayReceiver", "DEBUG_RELAY")) {
                    check(!content.contains(marker)) { "Debug relay code in release: $marker" }
                }
            }
        }
    }
}

/** Only the public signing script invokes this; private operator builds may intentionally differ. */
tasks.register("checkNeutralRelease") {
    dependsOn("generateReleaseBuildConfig", "assembleRelease")
    val config = layout.buildDirectory.file("generated/source/buildConfig/release/io/github/mitzacoder/aiki/BuildConfig.java")
    val apkFile = layout.buildDirectory.file("outputs/apk/release/app-release-unsigned.apk")
    doLast {
        val text = config.get().asFile.readText()
        val expected = mapOf(
            "APPLICATION_ID" to "io.github.mitzacoder.aiki", "PREFERENCES_PREFIX" to "aiki",
            "NOTIFICATION_INTENT_PREFIX" to "io.github.mitzacoder.aiki",
            "APP_ORIGIN" to "https://app.example.invalid", "APP_LINK_HOST" to "app.example.invalid",
            "PUBLISHED_BACKENDS_URL" to "", "PUSH_RELAY_URL" to "", "RELAY_GOOGLE_CLIENT_ID" to "",
            "RELAY_EMAIL_LINK_DOMAIN" to "", "RELAY_PRIVACY_CONTACT" to "", "FIREBASE_APP_ID" to "",
            "FIREBASE_API_KEY" to "", "FIREBASE_PROJECT_ID" to "", "FIREBASE_SENDER_ID" to "",
        )
        for ((field, value) in expected) check(text.contains("""String $field = "$value";""")) { "Non-neutral release field: $field" }
        ZipFile(apkFile.get().asFile).use { archive ->
            for (notice in listOf("Sora-NOTICE.txt", "LGPL-2.1-Sora.txt", "RELINKING.md", "OFL-JetBrainsMono.txt", "OFL-AtkinsonHyperlegibleNext.txt", "APACHE-2.0-termux-terminal.txt")) {
                check(archive.getEntry("assets/$notice") != null) { "Missing APK notice: $notice" }
            }
        }
    }
}

dependencies {
    implementation("com.google.android.gms:play-services-oss-licenses:17.5.3")
    implementation("androidx.appcompat:appcompat:1.7.1")
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
    implementation("com.google.firebase:firebase-auth:25.0.0")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.1")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    testImplementation("com.squareup.okhttp3:mockwebserver3:5.5.0")
}
