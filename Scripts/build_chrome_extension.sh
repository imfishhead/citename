#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
output_dir="$project_dir/dist/CiteName Chrome"
stage_dir="$(mktemp -d /tmp/citename-chrome.XXXXXX)"
trap 'rm -rf "$stage_dir"' EXIT
mkdir -p "$stage_dir/ModuleCache"

rm -rf "$output_dir"
mkdir -p "$output_dir/Extension" "$output_dir/NativeHost"
find "$project_dir/ChromeExtension" -type f -print0 | while IFS= read -r -d '' source; do
  relative_path="${source#$project_dir/ChromeExtension/}"
  mkdir -p "$output_dir/Extension/${relative_path:h}"
  cp -X "$source" "$output_dir/Extension/$relative_path"
done
cp -X "$project_dir/NativeHost/local.citename.host.json.template" "$output_dir/NativeHost/"

cp -X "$project_dir/Sources/CiteName/FilenameSanitizer.swift" "$stage_dir/"
cp -X "$project_dir/Sources/CiteName/PDFTitleExtractor.swift" "$stage_dir/"
cp -X "$project_dir/Sources/CiteName/PDFBibliographicExtractor.swift" "$stage_dir/"
cp -X "$project_dir/Sources/CiteName/PMCMetadataExtractor.swift" "$stage_dir/"
cp -X "$project_dir/NativeHost/CiteNameNativeHost.swift" "$stage_dir/main.swift"

xcrun swiftc \
  -module-cache-path "$stage_dir/ModuleCache" \
  -framework AppKit \
  -framework PDFKit \
  "$stage_dir/FilenameSanitizer.swift" \
  "$stage_dir/PDFTitleExtractor.swift" \
  "$stage_dir/PDFBibliographicExtractor.swift" \
  "$stage_dir/PMCMetadataExtractor.swift" \
  "$stage_dir/main.swift" \
  -o "$output_dir/NativeHost/CiteNameNativeHost"
codesign --force --sign - "$output_dir/NativeHost/CiteNameNativeHost"

cp -X "$project_dir/ChromeExtensionInstaller/Install CiteName.command" "$output_dir/"
cp -X "$project_dir/ChromeExtensionInstaller/安裝說明.txt" "$output_dir/"
chmod +x "$output_dir/Install CiteName.command" "$output_dir/NativeHost/CiteNameNativeHost"

echo "$output_dir"
