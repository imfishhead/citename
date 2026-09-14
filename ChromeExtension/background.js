importScripts("ndltd.js", "tpl.js", "citation.js");

const DEFAULT_SETTINGS = {
  enabled: true,
  citationFormat: true,
};
const ANALYSIS_TIMEOUT_MILLISECONDS = 20000;
let creatingOffscreenDocument;

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set(saved);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "citation-page-metadata" && sender.tab?.id >= 0) {
    const metadata = normalizeCitationMetadata(message.metadata);
    if (!metadata) return;
    chrome.storage.session.set({ [`citationMetadata-${sender.tab.id}`]: metadata });
    return;
  }

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

  const doiMetadata = await metadataForDOIDownload(download);
  const doiFilename = CiteNameCitation.filename(doiMetadata, settings.citationFormat);
  if (doiFilename) {
    await markPreNamed(download.id);
    suggest({ filename: doiFilename, conflictAction: "uniquify" });
    return;
  }

  const dspaceMetadata = await metadataForDSpaceDownload(download);
  const dspaceFilename = CiteNameCitation.filename(dspaceMetadata, settings.citationFormat);
  if (dspaceFilename) {
    await markPreNamed(download.id);
    suggest({ filename: dspaceFilename, conflictAction: "uniquify" });
    return;
  }

  const pmcMetadata = await metadataForPMCDownload(download);
  const pmcFilename = CiteNameCitation.filename(pmcMetadata, settings.citationFormat);
  if (pmcFilename) {
    await markPreNamed(download.id);
    suggest({ filename: pmcFilename, conflictAction: "uniquify" });
    return;
  }

  const pageMetadata = await metadataForCitationDownload(download);
  const pageFilename = CiteNameCitation.filename(pageMetadata, settings.citationFormat);
  if (pageFilename) {
    await markPreNamed(download.id);
    suggest({ filename: pageFilename, conflictAction: "uniquify" });
    return;
  }

  try {
    const response = await analyzePDFDownloadWithTimeout({
      type: "analyze-pdf-download",
      url: download.finalUrl || download.url,
      sourceFilename: download.filename?.split("/").pop() || "",
    });

    const filename = response?.ok
      ? CiteNameCitation.filename(response.metadata, settings.citationFormat)
      : "";
    if (!filename) {
      await markAnalysisFailed(download.id, response?.error);
      suggest();
      return;
    }

    await markPreNamed(download.id);
    suggest({ filename, conflictAction: "uniquify" });
  } catch (error) {
    await markAnalysisFailed(download.id, error?.message);
    suggest();
  }
}

async function metadataForDOIDownload(download) {
  const doi = [download.finalUrl, download.url, download.referrer]
    .map(CiteNameCitation.doiFromURL).find(Boolean);
  if (!doi) return null;
  try {
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = await response.json();
    return CiteNameCitation.metadataFromCrossrefWork(body?.message);
  } catch {
    return null;
  }
}

async function metadataForDSpaceDownload(download) {
  const itemURL = [download.referrer, download.finalUrl, download.url]
    .map(CiteNameCitation.dspaceItemURL).find(Boolean);
  if (!itemURL) return null;
  try {
    const response = await fetch(itemURL, { headers: { Accept: "application/json" } });
    return response.ok ? CiteNameCitation.metadataFromDSpaceItem(await response.json()) : null;
  } catch {
    return null;
  }
}

async function metadataForPMCDownload(download) {
  const candidates = [download.finalUrl, download.url, download.referrer].filter(Boolean);
  const articleURL = candidates.map(CiteNameCitation.articleURLForPMC).find(Boolean);
  if (!articleURL) return null;
  const pmcID = articleURL.match(/\/(PMC\d+)\/?$/iu)?.[1]?.toUpperCase();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(articleURL, {
        signal: controller.signal,
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      if (response.ok) {
        const metadata = CiteNameCitation.metadataFromHTML(await response.text());
        if (metadata) return metadata;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Europe PMC is used below as a metadata-only fallback.
  }
  if (!pmcID) return null;
  try {
    const response = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcID}/fullTextXML`, {
      headers: { Accept: "application/xml,text/xml" },
    });
    return response.ok ? CiteNameCitation.metadataFromPMCXML(await response.text()) : null;
  } catch {
    return null;
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

  const failedKey = `analysisFailed-${download.id}`;
  const failed = await chrome.storage.session.get(failedKey);
  if (failed[failedKey]) {
    await chrome.storage.session.remove(failedKey);
    showNotification("PDF 維持原檔名", failed[failedKey]);
  }
});

async function markPreNamed(downloadId) {
  await chrome.storage.session.set({ [`preNamed-${downloadId}`]: true });
  await chrome.storage.session.remove(`analysisFailed-${downloadId}`);
}

async function markAnalysisFailed(downloadId, reason) {
  await chrome.storage.session.set({
    [`analysisFailed-${downloadId}`]: reason || "下載前無法辨識這份 PDF。",
  });
}

function normalizeCitationMetadata(raw) {
  if (!raw || !CiteNameCitation.isPlausibleTitle(raw.title)) return null;
  return {
    title: CiteNameCitation.preferredSingleLanguageTitle(raw.title),
    author: CiteNameCitation.clean(raw.author),
    year: CiteNameCitation.extractYear(raw.year),
    pageURL: String(raw.pageURL || ""),
    pdfURLs: Array.isArray(raw.pdfURLs) ? raw.pdfURLs.map(String) : [],
    savedAt: Number(raw.savedAt) || Date.now(),
  };
}

async function metadataForCitationDownload(download) {
  if (!(download.tabId >= 0)) return null;
  const key = `citationMetadata-${download.tabId}`;
  const stored = await chrome.storage.session.get(key);
  const metadata = normalizeCitationMetadata(stored[key]);
  if (!metadata || Date.now() - metadata.savedAt > 2 * 60 * 60 * 1000) return null;

  const downloadURL = normalizedURL(download.finalUrl || download.url);
  const referrerURL = normalizedURL(download.referrer);
  const pageURL = normalizedURL(metadata.pageURL);
  const pdfURLs = metadata.pdfURLs.map(normalizedURL).filter(Boolean);
  if (referrerURL && pageURL === referrerURL) return metadata;
  if (downloadURL && pdfURLs.includes(downloadURL)) return metadata;
  return null;
}

function normalizedURL(raw) {
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

async function ensureOffscreenDocument() {
  const offscreenURL = chrome.runtime.getURL("offscreen.html");
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenURL],
    });
    if (contexts.length > 0) return;
  }

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }
  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS", "DOM_PARSER", "BLOBS"],
    justification: "在本機讀取學術 PDF 的書目資料，以便在下載前產生檔名。",
  });
  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = undefined;
  }
}

async function analyzePDFDownloadWithTimeout(message) {
  await ensureOffscreenDocument();
  let timer;
  try {
    return await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("PDF 分析逾時，已保留原檔名。")),
          ANALYSIS_TIMEOUT_MILLISECONDS
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/citename-128.png",
    title,
    message,
  });
}
