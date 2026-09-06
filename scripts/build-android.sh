#!/usr/bin/env bash
# Builds the Android APK. Defaults to the debug variant; pass "release" for the
# release one (which needs signing configuration to be installable).
source "$(dirname "$0")/common.sh"

VARIANT="${1:-debug}"
case "$VARIANT" in
    debug)   TASK=":app:assembleDebug" ;;
    release) TASK=":app:assembleRelease" ;;
    *) die "unknown variant '$VARIANT' (use debug or release)" ;;
esac

GRADLE="$(find_gradle)" || die "no gradle: install one, or add the wrapper to android/"
JAVA_HOME_DIR="$(find_java_home)" || die "no JDK found (looked at JAVA_HOME and /opt/android-studio/jbr)"

if [ ! -f "$ROOT/android/local.properties" ] && [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Android/Sdk" ]; then
    warn "writing android/local.properties pointing at $HOME/Android/Sdk"
    echo "sdk.dir=$HOME/Android/Sdk" > "$ROOT/android/local.properties"
fi

step "building Android APK ($VARIANT) with $(basename "$GRADLE")"
JAVA_HOME="$JAVA_HOME_DIR" "$GRADLE" --no-daemon -p "$ROOT/android" "$TASK"

APK="$(ls -t "$ROOT"/android/app/build/outputs/apk/"$VARIANT"/*.apk 2>/dev/null | head -1 || true)"
[ -n "$APK" ] || die "gradle finished but produced no APK"
ok "$APK ($(du -h "$APK" | cut -f1))"
