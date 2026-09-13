importScripts("ndltd.js", "tpl.js");

const NATIVE_HOST = "local.citename.host";
const DEFAULT_SETTINGS = {
  enabled: true,
  citationFormat: true,
};

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set(saved);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "ndltd-thesis-metadata" && isNDLTDURL(sender.url)) {
    const metadata = normalizeNDLTDMetadata(message.metadata);
    if (!metadata) return;

    const values = { ndltdActiveMetadata: metadata };
    if (metadata.sessionKey) values[`ndltdMetadata-${metadata.sessionKey}`] = metadata;
    chrome.storage.session.set(values);
    return;
  }

  if (message?.type === "tpl-journal-metadata" && isTPLURL(sender.url)) {
    const metadata = normalizeTPLMetadata(message.metadata);
    if (!metadata) return;

    const values = { tplActiveMetadata: metadata };
    if (metadata.sysId) values[`tplMetadata-${metadata.sysId}`] = metadata;
    chrome.storage.session.set(values);
  }
});

chrome.downloads.onDeterminingFilename.addListener((download, suggest) => {
  determineFilename(download, suggest);
  return true;
});

async function determineFilename(download, suggest) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.enabled) {
    suggest();
    return;
  }

  const ndltdExtension = ndltdDownloadExtension(download);
  if (ndltdExtension) {
    const metadata = await metadataForNDLTDDownload(download);
    const filename = ndltdFilename(metadata, settings.citationFormat, ndltdExtension);
    if (filename) {
      await chrome.storage.session.set({ [`preNamed-${download.id}`]: true });
      suggest({ filename, conflictAction: "uniquify" });
      return;
    }
    if (ndltdExtension === "zip") {
      suggest();
      return;
    }
  }

  const tplExtension = tplDownloadExtension(download);
  if (tplExtension) {
    const metadata = await metadataForTPLDownload(download);
    const filename = tplFilename(metadata, settings.citationFormat);
    if (filename) {
      await chrome.storage.session.set({ [`preNamed-${download.id}`]: true });
      suggest({ filename, conflictAction: "uniquify" });
      return;
    }
  }

  if (!isPDFDownload(download)) {
    suggest();
    return;
  }

  try {
    const response = await sendNativeMessageWithTimeout({
      action: "suggest",
      url: download.finalUrl || download.url,
      citationFormat: settings.citationFormat,
    }, 20000);

    if (!response?.ok || !response.filename) {
      suggest();
      return;
    }

    await chrome.storage.session.set({ [`preNamed-${download.id}`]: true });
    suggest({ filename: response.filename, conflictAction: "uniquify" });
  } catch {
    suggest();
  }
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current !== "complete") return;

  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.enabled) return;

  const [download] = await chrome.downloads.search({ id: delta.id });
  if (!download || download.state !== "complete") return;

  const ndltdExtension = ndltdDownloadExtension(download);
  const tplExtension = tplDownloadExtension(download);
  if (!isPDFDownload(download) && !ndltdExtension && !tplExtension) return;

  const preNamedKey = `preNamed-${download.id}`;
  const preNamed = await chrome.storage.session.get(preNamedKey);
  if (preNamed[preNamedKey]) {
    await chrome.storage.session.remove(preNamedKey);
    showNotification(
      ndltdExtension === "zip" ? "論文 ZIP 已重新命名" : "PDF 已使用論文資料命名",
      download.filename.split("/").pop()
    );
    return;
  }

  if (ndltdExtension === "zip") return;

  chrome.runtime.sendNativeMessage(
    NATIVE_HOST,
    {
      action: "rename",
      path: download.filename,
      citationFormat: settings.citationFormat,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showNotification("CiteName 尚未連線", "請重新執行安裝程式，再啟動 Chrome。");
        return;
      }

      if (response?.ok) {
        showNotification("PDF 已重新命名", response.filename);
      } else {
        showNotification("PDF 未重新命名", response?.error || "找不到可用的 PDF 標題。");
      }
    }
  );
});

function isPDFDownload(download) {
  const filename = download.filename || "";
  const url = download.finalUrl || download.url || "";
  if (download.mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    return true;
  }
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function tplDownloadExtension(download) {
  const candidates = [download.finalUrl, download.url, download.referrer].filter(Boolean);
  if (!candidates.some(isTPLURL)) return null;
  const filename = String(download.filename || "").toLowerCase();
  const mime = String(download.mime || "").toLowerCase();
  if (filename.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  return candidates.some((rawURL) => {
    try {
      return new URL(rawURL).pathname.toLowerCase().includes("pdfdownload");
    } catch {
      return false;
    }
  }) ? "pdf" : null;
}

async function metadataForTPLDownload(download) {
  const candidates = [download.referrer, download.finalUrl, download.url].filter(Boolean);
  const sysId = candidates.map(extractTPLSysId).find(Boolean);
  const keys = ["tplActiveMetadata"];
  if (sysId) keys.unshift(`tplMetadata-${sysId}`);
  const stored = await chrome.storage.session.get(keys);
  const metadata = normalizeTPLMetadata(
    sysId ? stored[`tplMetadata-${sysId}`] : stored.tplActiveMetadata
  ) || normalizeTPLMetadata(stored.tplActiveMetadata);
  if (!metadata || Date.now() - metadata.savedAt > 2 * 60 * 60 * 1000) return null;
  if (sysId && metadata.sysId && sysId !== metadata.sysId) return null;
  return metadata;
}

function ndltdDownloadExtension(download) {
  const candidates = [download.finalUrl, download.url, download.referrer].filter(Boolean);
  if (!candidates.some(isNDLTDURL)) return null;
  const filename = String(download.filename || "").toLowerCase();
  const mime = String(download.mime || "").toLowerCase();
  if (filename.endsWith(".zip") || mime.includes("zip")) return "zip";
  if (filename.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  for (const rawURL of candidates) {
    try {
      const path = new URL(rawURL).pathname.toLowerCase();
      if (path.endsWith(".zip")) return "zip";
      if (path.endsWith(".pdf")) return "pdf";
    } catch {}
  }
  return null;
}

async function metadataForNDLTDDownload(download) {
  const candidates = [download.finalUrl, download.url, download.referrer].filter(Boolean);
  const sessionKey = candidates.map(extractNDLTDSessionKey).find(Boolean);
  const keys = ["ndltdActiveMetadata"];
  if (sessionKey) keys.unshift(`ndltdMetadata-${sessionKey}`);
  const stored = await chrome.storage.session.get(keys);
  const metadata = normalizeNDLTDMetadata(
    sessionKey ? stored[`ndltdMetadata-${sessionKey}`] : stored.ndltdActiveMetadata
  ) || normalizeNDLTDMetadata(stored.ndltdActiveMetadata);
  if (!metadata || Date.now() - metadata.savedAt > 2 * 60 * 60 * 1000) return null;
  if (sessionKey && metadata.sessionKey && sessionKey !== metadata.sessionKey) return null;
  return metadata;
}

function sendNativeMessageWithTimeout(message, timeoutMilliseconds) {
  return Promise.race([
    new Promise((resolve, reject) => {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("PDF 分析逾時")), timeoutMilliseconds);
    }),
  ]);
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/citename-128.png",
    title,
    message,
  });
}
