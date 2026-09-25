# CiteName

CiteName 是 Chrome／Arc 擴充功能，會在學術檔案開始下載時，依作者、出版年份與標題自動整理檔名。

```text
main.pdf
↓
Lorraine Mazerolle et al. (2013) - Shaping Citizen Perceptions of Police Legitimacy- A Randomized Field Trial of Procedural Justice.pdf
```

目前版本：**2.0.30**

CiteName 不需要桌面 App、Native Host 或常駐背景程式。PDF 由擴充功能在瀏覽器內分析，不會上傳到 CiteName 的伺服器。

## 支援的網站

### 專用網站流程

下列網站有個別處理邏輯，能優先使用頁面或公開 API 提供的正式書目資料。

| 網站或系統 | 網域與頁面 | 支援的下載 | 資料來源 |
|---|---|---|---|
| 華藝線上圖書館 Airiti Library | `airitilibrary.com` 與學校圖書館 Proxy | 搜尋結果頁、文章詳目頁的 PDF／Blob 下載 | 被點選項目的標題、作者與出版年；文章頁 metadata |
| 臺灣博碩士論文知識加值系統 | `ndltd.ncl.edu.tw` 詳目頁 | ZIP、PDF | 研究生、論文名稱、論文出版年 |
| 國家圖書館期刊文獻資訊網 | `tpl.ncl.edu.tw` 期刊詳目頁 | PDF | 作者、題名、卷期或出版年月 |
| PubMed Central | `pmc.ncbi.nlm.nih.gov` | 文章 PDF | Europe PMC 公開書目資料；PMC 文章頁 metadata |
| DSpace 7 學術儲存庫 | 網址含 `/entities/publication/<UUID>` | PDF | 同站 DSpace REST API；已用 MIT DSpace 驗證 |
| Open Journal Systems | 網址含 `/article/view/<id>` | PDF | OJS 文章頁的 `citation_*` metadata |
| ScienceDirect | `sciencedirect.com`、`sciencedirectassets.com` | PDF | PII 與 Crossref 書目資料 |
| Karger | `karger.com` | PDF | 下載網址中的文章編號與 Crossref 書目資料 |

華藝搜尋結果換頁後，CiteName 會重新保存當頁各筆資料，再以原始 PDF 標題配對正確的作者與年份，避免整頁下載套用同一個檔名。

### 通用相容流程

CiteName 也能處理未列在上表的學術網站：

- 下載網址、文章網址或 PDF 內含 DOI 時，向 Crossref 查詢正式書目資料。
- 文章頁含 `citation_title`、`citation_author`、`citation_publication_date`、`citation_pdf_url` 等 metadata 時，直接使用頁面資料。
- PDF 可由瀏覽器讀取時，以 PDF.js 分析 PDF metadata、首頁文字與 DOI。
- Open Journal Systems、DSpace 與 DOI 採用通用網址規則，因此可支援多個不同機構或出版社的站台。

通用流程不代表所有學術網站都保證成功。網站若使用登入限制、防爬機制、特殊下載流程或無法讀取的 Blob，CiteName 可能只能保留原檔名。

## 檔名格式

在擴充功能選單可選擇四種格式：

| 選項 | 輸出範例 |
|---|---|
| 作者（年份）－標題 | `Ada Lovelace (2024) - Analytical Engines.pdf` |
| 作者－標題 | `Ada Lovelace - Analytical Engines.pdf` |
| （年份）－標題 | `(2024) - Analytical Engines.pdf` |
| 只用標題 | `Analytical Engines.pdf` |

若作者或年份缺漏，CiteName 會使用現有資料組合檔名；只有標題可信時，就只保留標題。三位以上作者會顯示第一位作者加上 `et al.`。Chrome 不允許 `?`、`:`、`/` 等字元出現在檔名中，CiteName 會自動換成 `-`。同名檔案由瀏覽器加上流水號，既有檔案不會被覆蓋。

## 書目資料的選用順序

CiteName 依下列順序尋找資料，找到完整且可信的來源後就停止：

1. 臺灣博碩士論文網或國圖期刊文獻網的詳目資料。
2. Open Journal Systems 文章頁。
3. 下載網址或來源頁中的 DOI，並以 Crossref 補齊資料。
4. ScienceDirect 的 PII。
5. 華藝文章頁或搜尋結果項目。
6. DSpace REST API。
7. Europe PMC 或 PubMed Central 文章頁。
8. 一般文章頁的 `citation_*` metadata。
9. PDF metadata、首頁文字與 PDF 內的 DOI。

資料不足、辨識結果不可信或網站拒絕讀取時，CiteName 會保留網站提供的原檔名。

## 安裝

### 從原始碼安裝

一般使用者安裝擴充功能後不需要 Node.js。只有從原始碼建置時需要 Node.js 與 npm。

```sh
npm install
npm run build:extension
```

接著開啟 `chrome://extensions` 或 `arc://extensions`：

1. 開啟「開發人員模式」。
2. 按「載入未封裝項目」。
3. 選擇 `dist/CiteName Chrome/Extension`。

重新建置後，回到擴充功能頁面按 CiteName 的「重新載入」。已經開啟的文章頁也要重新整理，讓新版內容程式進入頁面。

### Chrome Web Store 上架包

建置完成後，從擴充功能根目錄建立 ZIP。壓縮檔的根目錄必須直接包含 `manifest.json`。

```sh
cd "dist/CiteName Chrome/Extension"
zip -r -q "../../CiteName-2.0.30-chrome-web-store.zip" . \
  -x '*.DS_Store' '__MACOSX/*'
```

目前已建置的上架檔位於：

```text
dist/CiteName-2.0.30-chrome-web-store.zip
```

## 瀏覽器與權限

- 最低版本：Chrome 116。
- 已測試：Google Chrome、Arc。
- 其他 Chromium 瀏覽器可能可用，但目前沒有納入正式測試。

擴充功能使用下列權限：

| 權限 | 用途 |
|---|---|
| `downloads` | 在下載開始時提供新的檔名 |
| `storage` | 儲存開關、檔名格式與當次下載需要的暫存書目資料 |
| `offscreen` | 在瀏覽器內用 PDF.js 分析 PDF |
| `notifications` | 告知重新命名結果或辨識失敗原因 |
| `https://*/*`、`http://*/*` | 讀取文章頁公開 metadata，並辨識來自不同學術網站的下載 |

## 隱私權

CiteName 不設帳號，不含分析或追蹤工具，也不蒐集、出售或分享個人資料、瀏覽紀錄與 PDF 內容。

需要補足書目資料時，擴充功能可能向 Crossref、Europe PMC、原文章網站或公開學術儲存庫查詢 DOI、PMC 編號或公開書目。這些請求只用來產生檔名。完整說明請見 [PRIVACY.md](PRIVACY.md)。

## 限制

- 掃描型 PDF 沒有文字層時，通常無法從 PDF 推測標題、作者與年份。
- 雙欄排版、特殊字型、錯誤的 PDF metadata 或工作檔名可能影響辨識。
- 需要登入、阻擋跨來源讀取或使用特殊下載元件的網站，可能無法讓擴充功能取得 PDF。
- DOI 或公開 API 沒有收錄該文獻時，只能使用頁面或 PDF 內現有資料。
- 華藝等會動態換頁的網站，在擴充功能更新後必須重新整理原頁面。

## 開發與測試

安裝相依套件：

```sh
npm install
```

執行所有 Chrome Extension 測試：

```sh
npm test
```

執行測試並建置擴充功能：

```sh
Scripts/test_e2e.sh
```

略過建置，只測試既有成品：

```sh
Scripts/test_e2e.sh --skip-build
```

主要目錄：

```text
ChromeExtension/           擴充功能程式碼
Tests/ChromeExtensionTests 自動化測試
Scripts/                   建置與測試腳本
Assets/Store/              Chrome Web Store 圖片素材
dist/                      本機建置產物
```

## 回報不支援的網站

請到 [GitHub Issues](https://github.com/imfishhead/citename/issues) 提供文章頁網址、實際下載檔名與預期檔名。若網站需要校內 Proxy，請隱藏帳號、Session ID 或其他私人資訊。

## 授權

本專案採 [CiteName Proprietary License](LICENSE)。原始碼、圖片與文件保留所有權利。未經書面同意，不得複製、修改、重新發布或轉售。官方版本可透過 Chrome Web Store 安裝，供個人或組織內部使用。
