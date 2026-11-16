#!/bin/sh
# Builds the standalone binaries that install.sh downloads. Needs Bun. Run on macOS, so that the macOS binaries are signed.
# Usage: scripts/build-binaries.sh <out-dir>
set -eu
out=${1:?usage: scripts/build-binaries.sh <out-dir>}
rm -rf "$out"
mkdir -p "$out"
for target in darwin-arm64 darwin-x64 linux-x64 linux-arm64; do
  bun_target=bun-$target
  # The baseline build also runs on x64 processors without AVX2.
  [ "$target" = linux-x64 ] && bun_target=bun-linux-x64-baseline
  mkdir -p "$out/$target"
  bun build --compile --minify --target="$bun_target" scripts/binary-entry.js --outfile "$out/$target/frontmost"
  case $target in darwin-*) codesign --force --sign - "$out/$target/frontmost" ;; esac
  tar -czf "$out/frontmost-$target.tar.gz" -C "$out/$target" frontmost
done
(cd "$out" && shasum -a 256 frontmost-*.tar.gz > SHA256SUMS)
cat "$out/SHA256SUMS"
