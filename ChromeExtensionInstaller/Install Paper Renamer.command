#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
user_name="$(id -un)"
user_home="$(dscl . -read "/Users/$user_name" NFSHomeDirectory | awk '{print $2}')"
support_dir="$user_home/Library/Application Support/Paper Renamer Chrome"
chrome_manifest_dir="$user_home/Library/Application Support/Google/Chrome/NativeMessagingHosts"
arc_manifest_dir="$user_home/Library/Application Support/Arc/User Data/NativeMessagingHosts"
host_path="$support_dir/PaperRenamerNativeHost"

mkdir -p "$support_dir" "$chrome_manifest_dir" "$arc_manifest_dir"
cp "$script_dir/NativeHost/PaperRenamerNativeHost" "$host_path"
chmod +x "$host_path"
for manifest_dir in "$chrome_manifest_dir" "$arc_manifest_dir"; do
  sed "s|__HOST_PATH__|$host_path|g" \
    "$script_dir/NativeHost/local.paper_renamer.host.json.template" \
    > "$manifest_dir/local.paper_renamer.host.json"
done

if [[ -d "/Applications/Arc.app" ]]; then
  open -a "Arc" "arc://extensions"
elif [[ -d "/Applications/Google Chrome.app" ]]; then
  open -a "Google Chrome" "chrome://extensions"
fi
open "$script_dir/Extension"

echo ""
echo "本機輔助程式已安裝。"
echo "第一次安裝：請按『載入未封裝項目』，選擇剛開啟的 Extension 資料夾。"
echo "已安裝舊版：請在 CiteName 卡片按圓形箭頭重新載入。"
echo "完成後請重新啟動 Chrome。"
echo ""
read "?按 Enter 關閉視窗。"
