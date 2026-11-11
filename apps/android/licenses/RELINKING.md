# Rebuilding with replacement Sora libraries

Use the exact Aiki tag/commit recorded in the release manifest, not a newer main.
The notices-and-source release bundle includes that source tree (without local
config or credentials), the complete Sora 0.24.6 upstream source and its two
published module source archives. Sora's upstream build files and source retain
its own notices. `Sora-NOTICE.txt` pins the upstream commit and download locations.

1. Install Bun 1.4.4 and the Android toolchain from `apps/android/flake.nix`
   (or use `nix develop` there). Install dependencies with
   `bun install --frozen-lockfile`. No private service configuration is required.
2. Unpack `sora-editor-source.tar.gz`. Change the library as needed; build its
   `editor` and `language-textmate` AARs using that upstream tree's Gradle files
   and documented toolchain. The published `*-sources.jar` files are additional
   module-level reference source, not substitutes for the complete build tree.
3. In Aiki's `apps/android/app/build.gradle.kts`, replace the two matching
   `implementation("io.github.rosemoe:...:0.24.6")` declarations with
   `implementation(files("/path/to/replacement/editor.aar"))` and
   `implementation(files("/path/to/replacement/language-textmate.aar"))`.
   Keep the upstream modules' required transitive dependencies in the dependency
   block: file AARs do not carry Maven dependency resolution metadata. Alternatively
   publish the changed modules under replacement coordinates and use those.
4. Create an empty properties file outside the source tree; select it with
   `HARNESS_ANDROID_PROPERTIES=/path/to/empty.properties`. Set a distinct ID with
   `-Pharness.applicationId=org.example.aiki.modified` to keep the publisher's
   app installed. Run `apps/android/scripts/build.sh :app:assembleDebug` with
   that property. The debug APK uses your locally generated debug key and works
   without Firebase/relay setup. The release script intentionally fixes the public
   package ID; use the direct build wrapper for a side-by-side replacement.
5. Install your rebuilt debug APK on your own emulator/device, then connect and
   pair to your own backend. Never use the publisher's signing key. An APK signed
   with another key cannot update the publisher-signed package. A separate ID has
   separate state; there is no automatic transfer of retained device credentials.

The publisher must preserve the matching source/relinking materials and confirm
LGPL section 6 compliance for the combined APK before distribution. The generated
Google OSS catalogue reflects dependency metadata and may not identify every
non-code asset; the explicit Sora, font and Termux notices supplement it. Review
Google SDK terms and dependency notices, and get legal advice if needed. No claim
is made here about relicensing all of Aiki or certifying compliance.
