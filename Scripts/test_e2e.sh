#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"

node "$project_dir/Tests/ChromeExtensionTests/ndltd.test.js"
node "$project_dir/Tests/ChromeExtensionTests/tpl.test.js"
node --test \
  "$project_dir/Tests/ChromeExtensionTests/e2e.test.js" \
  "$project_dir/Tests/ChromeExtensionTests/pdf-analyzer.test.js"

if [[ "${1:-}" != "--skip-build" ]]; then
  "$project_dir/Scripts/build_chrome_extension.sh"
fi

echo "CiteName end-to-end tests passed"
