#!/bin/sh
# Notty user-space installer.
#
# Installs the desktop app and CLI under ~/.local, never touching /usr and
# never asking for sudo. The same layout is what the in-app updater maintains,
# so later updates need no elevation either.
#
#   curl -fsSL https://raw.githubusercontent.com/atpaawej/notty/main/install.sh | sh
#
# Environment overrides (mainly for testing and packagers):
#   NOTTY_VERSION       Install a specific tag, e.g. v0.3.0 (skips the API call)
#   NOTTY_TARBALL       Path to a local release tarball
#   NOTTY_TARBALL_URL   Full URL of a release tarball
#   NOTTY_REPO          GitHub owner/repository, defaults to atpaawej/notty
#   NOTTY_INSTALL_DIR   Application directory, defaults to ~/.local/share/notty
#   XDG_DATA_HOME       Data root, defaults to ~/.local/share
#   XDG_BIN_HOME        Binary directory, defaults to ~/.local/bin

set -eu

REPO="${NOTTY_REPO:-atpaawej/notty}"
VERSION="${NOTTY_VERSION:-}"
DATA_ROOT="${XDG_DATA_HOME:-${HOME:?HOME must be set}/.local/share}"
BIN_DIR="${XDG_BIN_HOME:-${HOME:?HOME must be set}/.local/bin}"
APP_DIR="${NOTTY_INSTALL_DIR:-${DATA_ROOT}/notty}"
APPLICATIONS_DIR="${DATA_ROOT}/applications"
ICON_ROOT="${DATA_ROOT}/icons/hicolor"

fail() {
  printf 'Notty installer: %s\n' "$1" >&2
  exit 1
}

case "$(uname -s 2>/dev/null || true)" in
  Linux) ;;
  *) fail "Notty currently supports Linux only." ;;
esac

MACHINE="$(uname -m 2>/dev/null || true)"
case "$MACHINE" in
  x86_64 | amd64)
    ASSET_ARCH="x86_64"
    ;;
  aarch64 | arm64)
    ASSET_ARCH="aarch64"
    ;;
  *)
    fail "Unsupported architecture: ${MACHINE:-unknown}. Notty publishes x86_64 and aarch64 Linux builds."
    ;;
esac

if command -v curl >/dev/null 2>&1; then
  DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER="wget"
else
  fail "Install curl or wget first."
fi

command -v tar >/dev/null 2>&1 || fail "Install tar first."

fetch() {
  _fetch_url="$1"
  _fetch_dest="$2"
  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL "$_fetch_url" -o "$_fetch_dest"
  else
    wget -qO "$_fetch_dest" "$_fetch_url"
  fi
}

fetch_text() {
  _fetch_url="$1"
  if [ "$DOWNLOADER" = "curl" ]; then
    curl -fsSL "$_fetch_url"
  else
    wget -qO - "$_fetch_url"
  fi
}

if [ -z "$VERSION" ]; then
  RELEASE_JSON="$(fetch_text "https://api.github.com/repos/${REPO}/releases/latest")" ||
    fail "Could not read the latest release from GitHub."
  VERSION="$(printf '%s' "$RELEASE_JSON" |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
    head -n 1)"
  [ -n "$VERSION" ] || fail "Could not find the latest Notty version."
fi

case "$VERSION" in
  v*) TAG="$VERSION" ;;
  *) TAG="v${VERSION}" ;;
esac
VERSION_NUMBER="${VERSION#v}"

if [ -n "${NOTTY_TARBALL_URL:-}" ]; then
  TARBALL_URL="$NOTTY_TARBALL_URL"
else
  TARBALL_URL="https://github.com/${REPO}/releases/download/${TAG}/notty-${TAG}-linux-${ASSET_ARCH}.tar.gz"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/notty-install.XXXXXX")" ||
  fail "Could not create a temporary directory."
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

ARCHIVE="${WORK}/notty.tar.gz"
if [ -n "${NOTTY_TARBALL:-}" ]; then
  [ -f "$NOTTY_TARBALL" ] || fail "No tarball at ${NOTTY_TARBALL}."
  cp "$NOTTY_TARBALL" "$ARCHIVE"
else
  fetch "$TARBALL_URL" "$ARCHIVE" || fail "Could not download ${TARBALL_URL}."
fi

mkdir -p "${WORK}/unpack"
tar -xzf "$ARCHIVE" -C "${WORK}/unpack" ||
  fail "The downloaded archive could not be unpacked."

SOURCE="${WORK}/unpack"
# GitHub release tarballs wrap their contents in one top-level directory.
set -- "${SOURCE}"/*
if [ "$#" -eq 1 ] && [ -d "$1" ]; then
  SOURCE="$1"
fi

[ -f "${SOURCE}/notty-desktop" ] ||
  fail "The archive does not contain the Notty desktop binary."

mkdir -p "$APP_DIR" "$BIN_DIR" "$APPLICATIONS_DIR"

# Copy over the installation in place. The updater uses the same directory,
# so a user-space install can later replace these files without elevation.
cp -R "${SOURCE}/." "${APP_DIR}/"
chmod 755 "${APP_DIR}/notty-desktop" 2>/dev/null || true
if [ -f "${APP_DIR}/notty" ]; then
  chmod 755 "${APP_DIR}/notty" 2>/dev/null || true
fi
ln -sf "${APP_DIR}/notty" "${BIN_DIR}/notty"

ICONS_DIR="${SOURCE}/icons"
if [ ! -d "$ICONS_DIR" ]; then
  ICONS_DIR="$SOURCE"
fi

install_icon() {
  _size="$1"
  _source="$2"
  [ -f "$_source" ] || return 0
  mkdir -p "${ICON_ROOT}/${_size}x${_size}/apps"
  cp "$_source" "${ICON_ROOT}/${_size}x${_size}/apps/notty.png"
}

install_icon 32 "${ICONS_DIR}/32x32.png"
install_icon 64 "${ICONS_DIR}/64x64.png"
install_icon 128 "${ICONS_DIR}/128x128.png"
if [ -f "${ICONS_DIR}/256x256.png" ]; then
  install_icon 256 "${ICONS_DIR}/256x256.png"
elif [ -f "${ICONS_DIR}/128x128@2x.png" ]; then
  install_icon 256 "${ICONS_DIR}/128x128@2x.png"
fi
if [ -f "${ICONS_DIR}/512x512.png" ]; then
  install_icon 512 "${ICONS_DIR}/512x512.png"
elif [ -f "${ICONS_DIR}/icon.png" ]; then
  install_icon 512 "${ICONS_DIR}/icon.png"
fi

DESKTOP_FILE="${APPLICATIONS_DIR}/notty.desktop"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Notty
Comment=Local-first notes for Linux
Exec="${APP_DIR}/notty-desktop" %U
Icon=notty
Terminal=false
Categories=Utility;Office;TextEditor;
StartupWMClass=Notty
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f "$ICON_ROOT" >/dev/null 2>&1 || true
fi

printf 'Notty %s installed in %s\n' "$VERSION_NUMBER" "$APP_DIR"
printf 'CLI: %s/notty\n' "$BIN_DIR"
case ":${PATH:-}:" in
  *":${BIN_DIR}:"*) ;;
  *) printf 'Add %s to PATH to run notty from any terminal.\n' "$BIN_DIR" ;;
esac
