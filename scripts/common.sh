# Shared helpers for the build scripts. Sourced, never executed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${DIST:-$ROOT/dist}"
VERSION="${VERSION:-$(cat "$ROOT/VERSION" 2>/dev/null || echo 0.0.0)}"
# Exported so docker compose can stamp it into the image it builds.
export VERSION

# Set NO_COLOR=1 for plain output in a log.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
    BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

step() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s  !!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%s  xx%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

need() {
    command -v "$1" >/dev/null 2>&1 || die "$1 is required but not on PATH${2:+ ($2)}"
}

# Android builds need a JDK; this machine keeps one inside Android Studio.
find_java_home() {
    if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
        echo "$JAVA_HOME"
        return 0
    fi
    for candidate in /opt/android-studio/jbr /usr/lib/jvm/default-java /usr/lib/jvm/java-17-openjdk-amd64; do
        [ -x "$candidate/bin/java" ] && { echo "$candidate"; return 0; }
    done
    command -v java >/dev/null 2>&1 && { echo ""; return 0; }
    return 1
}

# Gradle: the wrapper if the checkout has one, otherwise a cached distribution.
#
# Picking the *newest* cached distribution is wrong — a milestone build, or one
# from a later major, will refuse the project's Android plugin. Prefer the
# version the wrapper asks for, then the newest stable release of that major.
find_gradle() {
    if [ -x "$ROOT/android/gradlew" ]; then
        echo "$ROOT/android/gradlew"
        return 0
    fi

    local wanted major
    wanted="$(sed -n 's/.*gradle-\([0-9][0-9.]*\)-.*\.zip/\1/p' \
        "$ROOT/android/gradle/wrapper/gradle-wrapper.properties" 2>/dev/null | head -1)"
    major="${wanted%%.*}"

    local candidates
    candidates="$(ls -d "$HOME"/.gradle/wrapper/dists/gradle-*/*/gradle-*/bin/gradle 2>/dev/null || true)"

    # 1: exactly what the wrapper names.
    if [ -n "$wanted" ]; then
        local exact
        exact="$(echo "$candidates" | grep -F "/gradle-${wanted}/bin/gradle" | head -1 || true)"
        [ -n "$exact" ] && { echo "$exact"; return 0; }
    fi

    # 2: the *lowest* cached stable release that still satisfies the wrapper.
    # Jumping to the newest one risks a Gradle the project's Android plugin has
    # never been tested against.
    local stable
    stable="$(echo "$candidates" | grep -vE 'milestone|-rc|-M[0-9]' \
        | { [ -n "$major" ] && grep -E "/gradle-${major}\." || cat; } | sort -V)"

    if [ -n "$stable" ]; then
        if [ -n "$wanted" ]; then
            # No pipeline here on purpose: `head -1` closing the loop's stdout
            # raises SIGPIPE, which pipefail then turns into a hard failure.
            local satisfying="" candidate version
            while read -r candidate; do
                [ -n "$candidate" ] || continue
                version="$(echo "$candidate" | sed -n 's|.*/gradle-\([0-9][0-9.]*\)/bin/gradle|\1|p')"
                if [ "$(printf '%s\n%s\n' "$wanted" "$version" | sort -V | head -1)" = "$wanted" ]; then
                    satisfying="$candidate"
                    break
                fi
            done <<< "$stable"
            [ -n "$satisfying" ] && { echo "$satisfying"; return 0; }
        fi
        echo "$stable" | tail -1
        return 0
    fi

    # 3: whatever gradle is on PATH.
    command -v gradle 2>/dev/null && return 0
    return 1
}
