#!/usr/bin/env bash
# Runs the Android unit tests (Robolectric — no device or emulator needed).
source "$(dirname "$0")/common.sh"

GRADLE="$(find_gradle)" || die "no gradle: install one, or add the wrapper to android/"
JAVA_HOME_DIR="$(find_java_home)" || die "no JDK found (looked at JAVA_HOME and /opt/android-studio/jbr)"

if [ ! -f "$ROOT/android/local.properties" ] && [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Android/Sdk" ]; then
    warn "writing android/local.properties pointing at $HOME/Android/Sdk"
    echo "sdk.dir=$HOME/Android/Sdk" > "$ROOT/android/local.properties"
fi

step "running Android unit tests with $(basename "$GRADLE")"
JAVA_HOME="$JAVA_HOME_DIR" "$GRADLE" --no-daemon -p "$ROOT/android" :app:testDebugUnitTest

REPORT="$ROOT/android/app/build/reports/tests/testDebugUnitTest/index.html"
[ -f "$REPORT" ] && ok "report: $REPORT"
