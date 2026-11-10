#!/usr/bin/env bash
# Reusable, headless KVM devices. Never downloads an SDK or another image.
# HARNESS_ANDROID_DEVICE=a..f picks one of six parallel devices, each with its own state, emulator port and backend
# port; unset is the original single device (emulator-5580, backend 4790). All share the read-only system image and
# the isolated adb server on 5038.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
OWNER_HOME=$HOME
TRACK=${HARNESS_ANDROID_DEVICE:-}
case "$TRACK" in
    "") EMULATOR_PORT=5580; BACKEND_PORT=4790; DEFAULT_ROOT=$OWNER_HOME/scratch/android-cache/device ;;
    [a-f])
        INDEX=$(( $(printf '%d' "'$TRACK") - 97 ))
        EMULATOR_PORT=$(( 5582 + 2 * INDEX )); BACKEND_PORT=$(( 4800 + 10 * INDEX ))
        DEFAULT_ROOT=$OWNER_HOME/scratch/android-cache/device-$TRACK ;;
    *) echo "HARNESS_ANDROID_DEVICE must be a..f or unset" >&2; exit 2 ;;
esac
ROOT=${HARNESS_ANDROID_DEVICE_ROOT:-$DEFAULT_ROOT}
ROOT=$(realpath -m "$ROOT")
case "$ROOT/" in "$OWNER_HOME/scratch/android-cache/"*|"$OWNER_HOME/scratch/android-screens/"*) ;; *) echo "Device state must stay under android-cache or android-screens" >&2; exit 2 ;; esac
DEFAULT_CAPTURES=$OWNER_HOME/scratch/android-screens/FINAL
[[ -n "$TRACK" ]] && DEFAULT_CAPTURES=$OWNER_HOME/scratch/android-screens/track-$TRACK
CAPTURES=$(realpath -m "${HARNESS_ANDROID_DEVICE_CAPTURES:-$DEFAULT_CAPTURES}")
case "$CAPTURES/" in "$OWNER_HOME/scratch/android-screens/"*) ;; *) echo "Captures must stay under android-screens" >&2; exit 2 ;; esac
SDK=${ANDROID_HOME:-/nix/store/5ai22w9xb688944faml6jn1p38x1nira-androidsdk/libexec/android-sdk}
export JAVA_HOME=${JAVA_HOME:-/nix/store/1slz0vmmgsd7p6i4c0jaywkpw56wl2yg-openjdk-21.0.12+8}
export ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK
export HOME=$ROOT/home ANDROID_USER_HOME=$ROOT/android ANDROID_AVD_HOME=$ROOT/avd ANDROID_EMULATOR_HOME=$ROOT/emulator
export XDG_CACHE_HOME=$ROOT/cache XDG_DATA_HOME=$ROOT/data XDG_CONFIG_HOME=$ROOT/config TMPDIR=$ROOT/tmp
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Duser.home=$HOME -Djava.io.tmpdir=$TMPDIR"
export ADB_SERVER_PORT=5038 ANDROID_ADB_SERVER_PORT=5038
export ADB_SERVER_SOCKET=tcp:localhost:5038
# adb looks for emulators up to 5585 by itself; the parallel devices sit above that.
export ADB_LOCAL_TRANSPORT_MAX_PORT=5605
SERIAL=emulator-$EMULATOR_PORT
AVD=harness-api37
ADB=$SDK/platform-tools/adb
EMU=$SDK/emulator/emulator
mkdir -p "$HOME" "$ANDROID_USER_HOME" "$ANDROID_AVD_HOME" "$ANDROID_EMULATOR_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$TMPDIR" "$ROOT/logs" "$CAPTURES"
# adb may daemonize; never let that child retain our startup flock descriptor.
adb() { "$ADB" -P 5038 "$@" 9>&-; }
device() { adb -s "$SERIAL" "$@"; }
prepare() {
    "$EMU" -accel-check
    if [[ ! -f "$ANDROID_AVD_HOME/$AVD.avd/config.ini" ]]; then
        printf 'no\n' | "$SDK/cmdline-tools/22.0/bin/avdmanager" create avd --name "$AVD" \
            --package 'system-images;android-37.0;google_apis;x86_64' --device pixel_7 \
            --path "$ANDROID_AVD_HOME/$AVD.avd"
        # Set explicit small writable storage and no snapshots. System image is read-only/shared.
        printf '\ndisk.dataPartition.size=2G\nhw.ramSize=2048\nhw.cpu.ncore=2\nfastboot.forceColdBoot=yes\n' >> "$ANDROID_AVD_HOME/$AVD.avd/config.ini"
    fi
}
start() {
    exec 9>"$ROOT/device.lock"
    flock 9
    prepare
    adb start-server
    if ! device get-state >/dev/null 2>&1; then
        nohup "$EMU" -avd "$AVD" -port "$EMULATOR_PORT" -no-window -no-audio -no-boot-anim -no-snapshot \
            -no-metrics -accel on -gpu swiftshader -feature -Vulkan -memory 2048 -cores 2 \
            > "$ROOT/logs/emulator.log" 2>&1 9>&- &
        echo "$!" > "$ROOT/emulator.pid"
    fi
    for ((i=0; i<120; i++)); do
        if [[ $(device shell getprop sys.boot_completed 2>/dev/null | tr -d '\r') == 1 ]]; then
            device shell settings put global window_animation_scale 0
            device shell settings put global transition_animation_scale 0
            device shell settings put global animator_duration_scale 0
            device shell input keyevent KEYCODE_WAKEUP
            device shell input keyevent KEYCODE_MENU
            device reverse tcp:$BACKEND_PORT tcp:$BACKEND_PORT
            device reverse tcp:$(( BACKEND_PORT + 1 )) tcp:$(( BACKEND_PORT + 1 ))
            echo "Ready: $SERIAL; isolated adb port 5038; backend port $BACKEND_PORT reversed; captures $CAPTURES"
            df -h "$ROOT"
            return
        fi
        if [[ -f "$ROOT/emulator.pid" ]] && ! kill -0 "$(< "$ROOT/emulator.pid")" 2>/dev/null; then
            echo "Emulator exited; inspect $ROOT/logs/emulator.log" >&2; return 1
        fi
        sleep 2
    done
    echo "Boot timed out; inspect $ROOT/logs/emulator.log" >&2
    return 1
}
case ${1:-status} in
    prepare) prepare ;;
    start) start ;;
    status) adb devices -l; device shell getprop sys.boot_completed; df -h "$ROOT" ;;
    env) echo "SERIAL=$SERIAL EMULATOR_PORT=$EMULATOR_PORT BACKEND_PORT=$BACKEND_PORT ROOT=$ROOT" ;;
    # build.sh locks this checkout itself; checkouts build in parallel over the shared Gradle cache.
    build) "$REPO/apps/android/scripts/build.sh" :app:assembleDebug ;;
    install)
        APK=${2:-$REPO/apps/android/app/build/outputs/apk/debug/app-debug.apk}
        device install -r "$APK"
        device shell am start -W -n io.github.mitzacoder.aiki/.MainActivity
        ;;
    launch) device shell am start -W -n io.github.mitzacoder.aiki/.MainActivity ;;
    open)
        [[ $# == 2 ]] || { echo 'Usage: device.sh open <https://app/connect#v1... or harness://connect#v1...>' >&2; exit 2; }
        # Package constrains this to our app AND still exercises manifest intent resolution.
        device shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
            -p io.github.mitzacoder.aiki -d "'${2//\'/\'\\\'\'}'"
        ;;
    phone) device shell wm size 1080x2400; device shell wm density 420 ;;
    tablet) device shell wm size 2560x1600; device shell wm density 240 ;;
    landscape) device shell wm size 2400x1080; device shell wm density 420 ;;
    capture)
        LABEL=${2:-screen}
        [[ $LABEL =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Invalid capture label' >&2; exit 2; }
        device exec-out screencap -p > "$CAPTURES/$LABEL.png"
        # UIAutomator can wait forever on perpetual animations; screenshots remain usable.
        device shell rm -f /sdcard/harness-window.xml
        if timeout 20 "$ADB" -P 5038 -s "$SERIAL" shell uiautomator dump /sdcard/harness-window.xml > "$ROOT/logs/uiautomator.log" 2>&1 && grep -q "dumped to" "$ROOT/logs/uiautomator.log"; then
            device exec-out cat /sdcard/harness-window.xml > "$CAPTURES/$LABEL.xml"
        else
            rm -f "$CAPTURES/$LABEL.xml"
            echo "Hierarchy unavailable (non-idle UI); PNG is current." >&2
        fi
        device shell dumpsys activity activities > "$CAPTURES/$LABEL-activities.txt"
        echo "$CAPTURES/$LABEL.png"
        ;;
    adb) shift; device "$@" ;;
    stop) device emu kill ;;
    *) echo 'Usage: device.sh prepare|start|status|env|build|install [apk]|launch|open URI|phone|tablet|landscape|capture [label]|adb ...|stop' >&2; exit 2 ;;
esac
