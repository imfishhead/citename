#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
output_dir="$project_dir/dist/CiteName Chrome"
pdfjs_dir="$project_dir/node_modules/pdfjs-dist"

if [[ ! -f "$pdfjs_dir/legacy/build/pdf.min.mjs" ]]; then
  echo "缺少 PDF.js。請先在專案根目錄執行 npm install。" >&2
  exit 1
fi

rm -rf "$output_dir"
mkdir -p "$output_dir/Extension/vendor"
find "$project_dir/ChromeExtension" -type f -print0 | while IFS= read -r -d '' source; do
  relative_path="${source#$project_dir/ChromeExtension/}"
  mkdir -p "$output_dir/Extension/${relative_path:h}"
  cp -X "$source" "$output_dir/Extension/$relative_path"
done
cp -X "$pdfjs_dir/legacy/build/pdf.min.mjs" "$output_dir/Extension/vendor/"
cp -X "$pdfjs_dir/legacy/build/pdf.worker.min.mjs" "$output_dir/Extension/vendor/"
cp -X "$pdfjs_dir/LICENSE" "$output_dir/Extension/vendor/PDFJS-LICENSE"
cp -R -X "$pdfjs_dir/cmaps" "$output_dir/Extension/vendor/"
cp -R -X "$pdfjs_dir/standard_fonts" "$output_dir/Extension/vendor/"
cp -R -X "$pdfjs_dir/wasm" "$output_dir/Extension/vendor/"

echo "$output_dir"
