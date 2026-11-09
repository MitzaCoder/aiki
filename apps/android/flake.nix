{
  description = "Harness Android app: Android SDK and JDK for the Gradle build";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              config = {
                allowUnfree = true;
                android_sdk.accept_license = true;
              };
            }
          )
        );
    in
    {
      devShells = forAllSystems (
        pkgs:
        let
          # Keep in step with compileSdk and buildToolsVersion in
          # app/build.gradle.kts. AGP 9.4 wants build-tools 36.0.0 or newer.
          android = pkgs.androidenv.composeAndroidPackages {
            platformVersions = [ "37.0" ];
            buildToolsVersions = [ "37.0.0" ];
            includeEmulator = true;
            includeSystemImages = true;
            systemImageTypes = [ "google_apis" ];
            abiVersions = [ (if pkgs.stdenv.hostPlatform.isAarch64 then "arm64-v8a" else "x86_64") ];
          };
          sdk = "${android.androidsdk}/libexec/android-sdk";
          # AGP needs JDK 17+; 21 matches the runtime Android Studio bundles.
          jdk = pkgs.jdk21;
        in
        {
          default = pkgs.mkShell {
            packages = [
              android.androidsdk
              jdk
            ];
            ANDROID_HOME = sdk;
            JAVA_HOME = jdk.home;
          };
        }
      );
    };
}
