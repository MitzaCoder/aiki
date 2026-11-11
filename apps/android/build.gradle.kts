buildscript {
    repositories { google(); mavenCentral() }
    dependencies { classpath("com.google.android.gms:oss-licenses-plugin:0.13.0") }
}
plugins {
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.20" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.4.20" apply false
}
