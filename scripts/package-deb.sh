#!/usr/bin/env bash
# Builds Debian packages:
#
#   greynote-server   the backend binary, a systemd unit and its config
#   greynote-desktop  the Electron client with a launcher and desktop entry
#
# Both are assembled by hand with dpkg-deb rather than a packaging framework —
# the layouts are small enough to read in one sitting, and it keeps the build
# free of a toolchain that would have to be installed first.
source "$(dirname "$0")/common.sh"

need dpkg-deb
need fakeroot

WHICH="${1:-all}"
ARCH="${DEB_ARCH:-$(dpkg --print-architecture 2>/dev/null || echo amd64)}"
MAINTAINER="${DEB_MAINTAINER:-GreyNote <greynote@localhost>}"

mkdir -p "$DIST"

# ------------------------------------------------------------------ server ---

package_server() {
    local pkg="$DIST/pkg/greynote-server"
    rm -rf "$pkg"
    mkdir -p "$pkg/DEBIAN" "$pkg/usr/bin" "$pkg/lib/systemd/system" "$pkg/etc/greynote"

    step "building the server binary for the package"
    "$ROOT/scripts/build-backend.sh" "$pkg/usr/bin/greynote"

    cat > "$pkg/etc/greynote/greynote.env" <<'CONF'
# GreyNote server configuration. Every value is optional; these are the defaults.
ADDR=:8080
SQLITE_PATH=/var/lib/greynote/notes.db
# IMAGES_DIR defaults to <dir of SQLITE_PATH>/images
FRONTEND_ORIGIN=http://localhost:5173
COOKIE_NAME=notes_session
COOKIE_SECURE=0
SESSION_TTL_HOURS=168
TRASH_RETENTION_DAYS=30
MAX_NOTE_VERSIONS=50
IMAGE_GC_GRACE_HOURS=168

# Set both to create (or promote) the first admin at startup, then rotate them.
#ADMIN_EMAIL=admin@example.com
#ADMIN_PASSWORD=change-me-please
CONF

    cat > "$pkg/lib/systemd/system/greynote.service" <<'UNIT'
[Unit]
Description=GreyNote notes server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=greynote
Group=greynote
EnvironmentFile=/etc/greynote/greynote.env
ExecStart=/usr/bin/greynote
Restart=on-failure
RestartSec=3

# The service only ever needs its own data directory.
StateDirectory=greynote
WorkingDirectory=/var/lib/greynote
ReadWritePaths=/var/lib/greynote
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
UNIT

    cat > "$pkg/DEBIAN/control" <<CONTROL
Package: greynote-server
Version: $VERSION
Section: web
Priority: optional
Architecture: $ARCH
Depends: libc6, adduser
Maintainer: $MAINTAINER
Description: Self-hosted markdown notes server
 The GreyNote backend: a single Go binary over one SQLite file, serving the
 REST API used by the web, desktop and Android clients. Ships a systemd unit
 and reads its configuration from /etc/greynote/greynote.env.
CONTROL

    echo "/etc/greynote/greynote.env" > "$pkg/DEBIAN/conffiles"

    cat > "$pkg/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e

if [ "$1" = "configure" ]; then
    if ! getent passwd greynote >/dev/null; then
        adduser --system --group --home /var/lib/greynote --no-create-home \
                --quiet --shell /usr/sbin/nologin greynote
    fi
    mkdir -p /var/lib/greynote
    chown greynote:greynote /var/lib/greynote
    chmod 750 /var/lib/greynote

    # The config may hold a bootstrap admin password.
    chmod 640 /etc/greynote/greynote.env || true
    chown root:greynote /etc/greynote/greynote.env || true

    if [ -d /run/systemd/system ]; then
        systemctl daemon-reload || true
        systemctl enable greynote.service || true
        systemctl restart greynote.service || true
    fi
fi
POSTINST

    cat > "$pkg/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -e

if [ "$1" = "remove" ] && [ -d /run/systemd/system ]; then
    systemctl stop greynote.service || true
    systemctl disable greynote.service || true
fi
PRERM

    cat > "$pkg/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e

if [ "$1" = "purge" ]; then
    # Notes are the user's data: say what is being left behind rather than
    # deleting it on an uninstall.
    echo "greynote: /var/lib/greynote was left in place; remove it by hand to delete your notes."
fi

if [ -d /run/systemd/system ]; then
    systemctl daemon-reload || true
fi
POSTRM

    chmod 755 "$pkg/DEBIAN/postinst" "$pkg/DEBIAN/prerm" "$pkg/DEBIAN/postrm"

    local out="$DIST/greynote-server_${VERSION}_${ARCH}.deb"
    fakeroot dpkg-deb --build --root-owner-group "$pkg" "$out" >/dev/null
    ok "$out ($(du -h "$out" | cut -f1))"
}

# ----------------------------------------------------------------- desktop ---

# A flat-coloured PNG so the launcher has an icon without committing a binary.
write_icon() {
    python3 - "$1" <<'PY'
import struct, sys, zlib

size = 256
# GreyNote's accent blue on a dark rounded square.
bg, fg = (17, 19, 21), (74, 139, 255)
rows = []
for y in range(size):
    row = bytearray([0])
    for x in range(size):
        edge = min(x, y, size - 1 - x, size - 1 - y)
        inside_card = edge > 18
        # A simple "note" glyph: three lines.
        line = inside_card and 70 < x < 186 and any(abs(y - c) < 9 for c in (96, 128, 160))
        row += bytes(fg if line else (bg if inside_card else bg))
    rows.append(bytes(row))

raw = b"".join(rows)

def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9))
       + chunk(b"IEND", b""))

open(sys.argv[1], "wb").write(png)
PY
}

package_desktop() {
    need python3
    local pkg="$DIST/pkg/greynote-desktop"
    local appdir="$pkg/opt/greynote-desktop"
    rm -rf "$pkg"
    mkdir -p "$pkg/DEBIAN" "$appdir" "$pkg/usr/bin" \
             "$pkg/usr/share/applications" "$pkg/usr/share/icons/hicolor/256x256/apps"

    step "building the desktop bundle for the package"
    "$ROOT/scripts/build-desktop.sh"

    local runtime="$ROOT/electron/node_modules/electron/dist"
    [ -d "$runtime" ] || die "electron runtime missing at $runtime"

    step "assembling the desktop package"
    cp -r "$runtime"/. "$appdir/"
    # The Electron binary looks for the app beside itself in resources/app.
    rm -rf "$appdir/resources/default_app.asar"
    mkdir -p "$appdir/resources/app"
    for item in main preload.js renderer package.json; do
        cp -r "$ROOT/electron/$item" "$appdir/resources/app/"
    done
    # marked and DOMPurify are bundled into renderer/bundle.js, so the packaged
    # app carries no node_modules at all.
    rm -f "$appdir/resources/app/renderer/bundle.js.map"
    mv "$appdir/electron" "$appdir/greynote-desktop"

    # Chromium's setuid sandbox helper must be root-owned and setuid once
    # installed, or Electron refuses to start on a kernel without unprivileged
    # user namespaces. fakeroot below turns the ownership into root:root.
    chmod 4755 "$appdir/chrome-sandbox"

    cat > "$pkg/usr/bin/greynote-desktop" <<'LAUNCH'
#!/bin/sh
exec /opt/greynote-desktop/greynote-desktop "$@"
LAUNCH
    chmod 755 "$pkg/usr/bin/greynote-desktop"

    cat > "$pkg/usr/share/applications/greynote-desktop.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=GreyNote
GenericName=Notes
Comment=Self-hosted markdown notes
Exec=greynote-desktop %U
Icon=greynote-desktop
Terminal=false
Categories=Office;TextEditor;Utility;
Keywords=notes;markdown;journal;
StartupWMClass=GreyNote
DESKTOP

    write_icon "$pkg/usr/share/icons/hicolor/256x256/apps/greynote-desktop.png"

    local size_kb
    size_kb="$(du -sk "$pkg" | cut -f1)"

    cat > "$pkg/DEBIAN/control" <<CONTROL
Package: greynote-desktop
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Installed-Size: $size_kb
Depends: libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libsecret-1-0, libasound2 | libasound2t64
Maintainer: $MAINTAINER
Description: GreyNote desktop client
 Desktop client for a GreyNote server: three-pane notes browser, markdown
 editor with live preview, journal, templates, tag and folder management,
 tray icon and a global quick-capture shortcut.
CONTROL

    local out="$DIST/greynote-desktop_${VERSION}_${ARCH}.deb"
    fakeroot dpkg-deb --build --root-owner-group "$pkg" "$out" >/dev/null
    ok "$out ($(du -h "$out" | cut -f1))"
}

case "$WHICH" in
    server)  package_server ;;
    desktop) package_desktop ;;
    all)     package_server; package_desktop ;;
    *) die "unknown package '$WHICH' (use server, desktop or all)" ;;
esac
