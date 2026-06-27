#!/bin/bash
set -e

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
ARCH=$(uname -m)

if [ "$ARCH" = "arm64" ]; then
    TAURI_TARGET="aarch64-apple-darwin"
    PLATFORM_KEY="darwin-aarch64"
else
    TAURI_TARGET="x86_64-apple-darwin"
    PLATFORM_KEY="darwin-x86_64"
fi

DMG_NAME="Berries Code_${VERSION}_${ARCH}.dmg"

echo "Building Berries Code v$VERSION for $ARCH..."

export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/berries-code.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

# Skip AppleScript during DMG generation to avoid Finder permission errors
export SKIP_JENKINS=1

npm run tauri build -- --target $TAURI_TARGET

DMG_PATH=$(find "src-tauri/target/$TAURI_TARGET/release/bundle/dmg" -name "*.dmg" | head -1)
SIG=$(cat "${DMG_PATH}.sig")

# Create a releases folder to keep things clean
mkdir -p releases
cp "$DMG_PATH" "releases/$DMG_NAME"

cat > latest.json << ENDJSON
{
  "version": "$VERSION",
  "notes": "Berries Code $VERSION",
  "pub_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "platforms": {
    "$PLATFORM_KEY": {
      "signature": "$SIG",
      "url": "https://raw.githubusercontent.com/Theinnercircleecommerce/berries-code/main/releases/$DMG_NAME"
    }
  }
}
ENDJSON

git add "releases/$DMG_NAME" latest.json src-tauri/tauri.conf.json package.json
git commit -m "Release v$VERSION"
git push

echo ""
echo "Done! Berries Code v$VERSION is live in the releases folder."
