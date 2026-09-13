#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
cd "$project_dir"

export CLANG_MODULE_CACHE_PATH="$project_dir/.build/clang-module-cache"
swiftpm_options=(
    --disable-sandbox
    --jobs 1
    --cache-path "$project_dir/.build/swiftpm-cache"
    --config-path "$project_dir/.build/swiftpm-config"
    --security-path "$project_dir/.build/swiftpm-security"
)

swift build -c debug "${swiftpm_options[@]}"
binary_dir="$(swift build -c debug --show-bin-path "${swiftpm_options[@]}")"
app_dir="$project_dir/dist/CiteName 0.3.app"

mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp -X "$binary_dir/citename" "$app_dir/Contents/MacOS/citename"
cp -X "$project_dir/Supporting/Info.plist" "$app_dir/Contents/Info.plist"
xattr -cr "$app_dir"
codesign --force --deep --sign - "$app_dir"

echo "$app_dir"
