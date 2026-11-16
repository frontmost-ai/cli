#!/bin/sh
# Installs the Frontmost AI CLI on macOS or Linux:
#
#   curl -fsSL https://frontmost.ai/install | bash
#
# FRONTMOST_VERSION=0.6.1 installs that version. The default is the latest release.
# FRONTMOST_INSTALL_DIR sets the folder. The default is ~/.frontmost/bin.
# FRONTMOST_NO_MODIFY_PATH=1 leaves your shell profile unchanged.
set -eu

repo=frontmost-ai/cli
dir=${FRONTMOST_INSTALL_DIR:-$HOME/.frontmost/bin}
npm_hint="Install with npm instead: npm install -g github:frontmost-ai/cli"

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "this installer needs curl."
command -v tar >/dev/null 2>&1 || fail "this installer needs tar."

case $(uname -s) in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "this installer supports macOS and Linux. $npm_hint" ;;
esac

case $(uname -m) in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "no build for this processor ($(uname -m)). $npm_hint" ;;
esac

# A terminal under Rosetta reports x86_64 on an Apple silicon Mac. Install the native build.
if [ "$os-$arch" = darwin-x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
  arch=arm64
fi

# The Linux builds need glibc. Alpine and other musl systems do not have it.
if [ "$os" = linux ] && ls /lib/ld-musl-* >/dev/null 2>&1; then
  fail "no build for musl Linux, such as Alpine. $npm_hint"
fi

if [ -n "${FRONTMOST_VERSION:-}" ]; then
  base=https://github.com/$repo/releases/download/v${FRONTMOST_VERSION#v}
else
  base=https://github.com/$repo/releases/latest/download
fi
asset=frontmost-$os-$arch.tar.gz

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

printf 'Downloading the Frontmost AI CLI for %s %s\n' "$os" "$arch"
curl -fsSL "$base/$asset" -o "$tmp/$asset" || fail "could not download $base/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "could not download $base/SHA256SUMS"

expected=$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/SHA256SUMS")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp/$asset" | awk '{ print $1 }')
else
  actual=$(shasum -a 256 "$tmp/$asset" | awk '{ print $1 }')
fi
[ -n "$expected" ] && [ "$actual" = "$expected" ] || fail "the download does not match its checksum. Nothing was installed."

tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$dir"
mv -f "$tmp/frontmost" "$dir/frontmost"
chmod 755 "$dir/frontmost"
version=$("$dir/frontmost" --version) || fail "the installed program did not start: $dir/frontmost"
printf 'Installed frontmost %s to %s/frontmost\n' "$version" "$dir"

# Put the folder on PATH for new terminals.
on_path=false
case ":$PATH:" in *":$dir:"*) on_path=true ;; esac

if [ "$on_path" = false ] && [ "${FRONTMOST_NO_MODIFY_PATH:-}" != 1 ]; then
  case $(basename "${SHELL:-sh}") in
    zsh) profile=${ZDOTDIR:-$HOME}/.zshrc line="export PATH=\"$dir:\$PATH\"" ;;
    bash) profile=$HOME/.bashrc line="export PATH=\"$dir:\$PATH\""
      [ "$os" = darwin ] && profile=$HOME/.bash_profile ;;
    fish) profile=$HOME/.config/fish/config.fish line="fish_add_path \"$dir\"" ;;
    *) profile=$HOME/.profile line="export PATH=\"$dir:\$PATH\"" ;;
  esac
  if ! grep -qsF "$line" "$profile"; then
    mkdir -p "$(dirname "$profile")"
    printf '\n# Frontmost AI CLI\n%s\n' "$line" >>"$profile"
    printf 'Added %s to PATH in %s\n' "$dir" "$profile"
  fi
fi

# An older install, such as one from Homebrew or npm, can come first on PATH.
other=$(command -v frontmost 2>/dev/null || true)
if [ -n "$other" ] && [ "$other" != "$dir/frontmost" ]; then
  printf 'Note: %s comes first on PATH. Remove it, or run %s/frontmost.\n' "$other" "$dir"
fi

printf '\nNext:\n'
[ "$on_path" = true ] || printf '  Open a new terminal.\n'
printf '  Run frontmost login to sign in.\n'
