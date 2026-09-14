# CiteName

CiteName 是 Chrome／Arc 擴充功能。下載學術 PDF、臺灣博碩士論文網 ZIP 或國圖期刊全文時，它會在下載前將檔名改成：

`作者 (年份) - 標題.pdf`

例如：

`Lorraine Mazerolle et al. (2013) - Shaping Citizen Perceptions of Police Legitimacy- A Randomized Field Trial of Procedural Justice.pdf`

不需要安裝桌面 App、Native Host 或額外背景程式。PDF 分析在瀏覽器內完成，檔案不會上傳到 CiteName 的伺服器。

## 安裝

需要 Chrome 116 以上或相容版本的 Arc，以及 Node.js。

```sh
npm install
Scripts/build_chrome_extension.sh
```

接著開啟 `chrome://extensions` 或 `arc://extensions`：

1. 開啟「開發人員模式」。
2. 按「載入未封裝項目」。
3. 選擇 `dist/CiteName Chrome/Extension`。

重新建置後，回到擴充功能頁面按 CiteName 的「重新載入」。目前版本為 2.0.14。

## 命名方式

CiteName 會依序嘗試較可靠的來源：

1. DOI：下載網址含 DOI 時，向 Crossref 取得正式標題、作者與出版年。
2. MIT DSpace：讀取儲存庫的正式書目資料，避開 PDF 工作檔名。
3. PMC：讀取 PubMed Central 文章頁或其 XML 書目資料。
4. 一般文章頁：讀取 `citation_*` metadata。
5. PDF：以上來源不足時，以 PDF.js 讀取 PDF metadata 與首頁文字。

可以在外掛的下拉選單選擇「作者 (年份) - 標題」、「作者 - 標題」、「(年份) - 標題」或「只用標題」。選取的資訊不足時，檔名會退回只保留標題。PDF 無法讀取、網站拒絕瀏覽器存取，或資料不可信時，會保留原檔名。

Chrome 不允許 `?`、`:`、`/` 等字元出現在下載檔名中；CiteName 會自動改成 `-`。

## 已支援的網站流程

- 一般公開 PDF 與含 citation metadata 的文章頁
- DOI 下載網址，例如 Wiley
- PubMed Central（PMC）
- MIT DSpace
- 臺灣博碩士論文知識加值系統：從詳目頁下載 ZIP 或 PDF
- 國家圖書館期刊文獻網：從期刊詳目頁下載 PDF

## 測試

```sh
npm test
```

或執行包含建置步驟的完整測試：

```sh
Scripts/test_e2e.sh
```

若成品已建置完成：

```sh
Scripts/test_e2e.sh --skip-build
```

## 限制

掃描型 PDF 沒有文字層時，無法從 PDF 推測書目資料。雙欄排版、特殊字型與防爬機制也可能讓辨識失敗；此時 CiteName 會保留網站原本提供的檔名。

## 授權

本專案採 [CiteName Proprietary License](LICENSE)。原始碼、圖片與文件保留所有權利，禁止未經書面同意複製、修改、重新發布或轉售；官方版可透過 Chrome 線上應用程式商店供個人或內部使用。
