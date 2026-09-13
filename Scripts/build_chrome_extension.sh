#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
output_dir="$project_dir/dist/Paper Renamer Chrome"
stage_dir="$(mktemp -d /tmp/paper-renamer-chrome.XXXXXX)"
trap 'rm -rf "$stage_dir"' EXIT
mkdir -p "$stage_dir/ModuleCache"

mkdir -p "$output_dir/Extension" "$output_dir/NativeHost"
cp -R "$project_dir/ChromeExtension/." "$output_dir/Extension/"
cp "$project_dir/NativeHost/local.paper_renamer.host.json.template" "$output_dir/NativeHost/"

cp "$project_dir/Sources/PaperRenamer/FilenameSanitizer.swift" "$stage_dir/"
cp "$project_dir/Sources/PaperRenamer/PDFTitleExtractor.swift" "$stage_dir/"
cp "$project_dir/Sources/PaperRenamer/PDFBibliographicExtractor.swift" "$stage_dir/"
cp "$project_dir/Sources/PaperRenamer/PMCMetadataExtractor.swift" "$stage_dir/"
cp "$project_dir/NativeHost/PaperRenamerNativeHost.swift" "$stage_dir/main.swift"

xcrun swiftc \
  -module-cache-path "$stage_dir/ModuleCache" \
  -framework AppKit \
  -framework PDFKit \
  "$stage_dir/FilenameSanitizer.swift" \
  "$stage_dir/PDFTitleExtractor.swift" \
  "$stage_dir/PDFBibliographicExtractor.swift" \
  "$stage_dir/PMCMetadataExtractor.swift" \
  "$stage_dir/main.swift" \
  -o "$output_dir/NativeHost/PaperRenamerNativeHost"
codesign --force --sign - "$output_dir/NativeHost/PaperRenamerNativeHost"

cp "$project_dir/ChromeExtensionInstaller/Install Paper Renamer.command" "$output_dir/"
cp "$project_dir/ChromeExtensionInstaller/安裝說明.txt" "$output_dir/"
chmod +x "$output_dir/Install Paper Renamer.command" "$output_dir/NativeHost/PaperRenamerNativeHost"

echo "$output_dir"
