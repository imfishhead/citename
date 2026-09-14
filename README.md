# CiteName

Automatically rename academic downloads by author, year, and title.

把學術 PDF 拖進視窗後，程式會先讀取 PDF metadata 裡的標題；metadata 不可靠時，便依首頁字級與文字位置推測論文標題。畫面會列出原檔名及預計的新檔名，使用者仍可手動修改標題，再按下「重新命名」。

勾選「檔名格式：作者 (年份) - 標題」後，程式也會推測作者與出版年份，並顯示可編輯欄位。缺少明確出版年份時，程式會以 PDF 建立年份作為暫定值，重新命名前應先核對。

也可以貼上 PDF 網址，或貼上含 PDF 下載連結的網頁網址。程式會把 PDF 下載到 `Downloads`，再加入重新命名清單。單一檔案上限為 100 MB。

所有分析都在本機完成，程式不會上傳 PDF。

## 測試

執行完整 E2E 測試，包括瀏覽器下載流程、兩個國圖網站、fallback、通知，以及 PDF.js 實際解析：

```bash
Scripts/test_e2e.sh
```

若安裝包已經建置完成，可略過重新建置：

```bash
Scripts/test_e2e.sh --skip-build
```

## Chrome／Arc 擴充功能

Chrome 或 Arc 下載 PDF 時，擴充功能會先讀取文章網頁的 citation metadata；資料不足時，改用內附的 PDF.js 分析 PDF metadata 與首頁文字，讓「另存新檔」視窗直接顯示推測後的檔名。分析全程在瀏覽器內完成，不需要另外安裝桌面程式或 Native Host，也不會上傳 PDF。

在臺灣博碩士論文知識加值系統瀏覽論文詳目後下載電子全文 ZIP，擴充功能會使用同一工作階段內的研究生、出版年與論文名稱命名。若書目資料未成功取得，會保留網站提供的原始 ZIP 檔名。

在國家圖書館「期刊文獻網」的期刊詳目頁下載 PDF 時，擴充功能會讀取作者、出版年與中文篇名來命名；即使全文是沒有文字層的掃描 PDF，也不必依賴檔案內建 metadata。

第一次建置前先安裝 PDF.js：

```sh
npm install
Scripts/build_chrome_extension.sh
```

完成後在 Chrome 或 Arc 的擴充功能頁面按「載入未封裝項目」，選擇 `dist/CiteName Chrome/Extension`。

擴充功能預設採用「作者 (年份) - 標題」格式。若作者或年份無法可靠辨識，會只使用標題；如果下載前無法讀取或分析 PDF，則保留網站提供的原檔名。

## 執行原始碼

需要 macOS 13 或更新版本，以及 Swift 6：

```sh
swift run citename
```

## 製作 App

```sh
chmod +x Scripts/build_app.sh
Scripts/build_app.sh
```

完成後可在 `dist/CiteName 0.3.app` 找到程式。這份本機版本使用 ad-hoc 簽章；若要公開發佈，仍需 Apple Developer 憑證、公證及正式的 app sandbox 權限設定。

## 目前限制

掃描型 PDF 沒有可擷取的文字，因此只能沿用原檔名。這類檔案需要另加 OCR；雙欄排版或特殊字型也可能讓標題判斷失準。桌面 App 會在改名前顯示預覽，瀏覽器擴充功能則會直接把推測結果放進下載檔名。
