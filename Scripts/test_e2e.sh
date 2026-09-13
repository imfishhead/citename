#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"

node "$project_dir/Tests/ChromeExtensionTests/ndltd.test.js"
node "$project_dir/Tests/ChromeExtensionTests/tpl.test.js"
node --test "$project_dir/Tests/ChromeExtensionTests/e2e.test.js"

if [[ "${1:-}" != "--skip-build" ]]; then
  "$project_dir/Scripts/build_chrome_extension.sh"
fi

native_host="$project_dir/dist/CiteName Chrome/NativeHost/CiteNameNativeHost"
if [[ ! -x "$native_host" ]]; then
  echo "找不到可執行的 CiteNameNativeHost。請移除 --skip-build 或先建置安裝包。" >&2
  exit 1
fi

CITENAME_NATIVE_HOST="$native_host" \
  node "$project_dir/Tests/NativeHostTests/native-host.e2e.test.js"

echo "CiteName end-to-end tests passed"
