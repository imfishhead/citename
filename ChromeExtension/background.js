importScripts("ndltd.js", "tpl.js", "citation.js");

const DEFAULT_SETTINGS = {
  enabled: true,
  citationFormat: true,
  filenameFormat: null,
};
const ANALYSIS_TIMEOUT_MILLISECONDS = 20000;
let creatingOffscreenDocument;

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get({ enabled: true, citationFormat: true });
  const filenameFormat = CiteNameCitation.normalizeFilenameFormat(saved.filenameFormat ?? saved.citationFormat);
  await chrome.storage.local.set({
    enabled: saved.enabled,
    citationFormat: filenameFormat === "author-year-title",
    filenameFormat,
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "citation-page-metadata" && sender.tab?.id >= 0) {
    const metadata = normalizeCitationMetadata(message.metadata);
    if (!metadata) return;
    const values = { [`citationMetadata-${sender.tab.id}`]: metadata };
    if (isAiritiArticleURL(metadata.pageURL)) {
      values.airitiActiveMetadata = metadata;
      // Keep a short-lived durable fallback. Chrome invalidates existing
      // content scripts when an unpacked extension reloads, while the open
      // Airiti page can still create a detached blob download later.
      chrome.storage.local.set({ airitiActiveMetadata: metadata });
    }
    chrome.storage.session.set(values);
    return;
  }

  if (message?.type === "airiti-download-intent" && sender.tab?.id >= 0) {
    const metadata = normalizeCitationMetadata(message.metadata);
    if (!metadata || !isAiritiURL(metadata.pageURL)) return;
    if (!isAiritiArticleURL(metadata.pageURL)) {
      chrome.storage.session.remove("airitiActiveMetadata");
      chrome.storage.local.remove("airitiActiveMetadata");
    }
    chrome.storage.session.set({
      airitiPendingMetadata: { ...metadata, sourceTabId: sender.tab.id },
    });
    return;
  }

  if (message?.type === "airiti-search-results-metadata" && sender.tab?.id >= 0) {
    const results = (Array.isArray(message.results) ? message.results : [])
      .map((result) => normalizeCitationMetadata({
        ...result,
        pageURL: message.pageURL,
        savedAt: message.savedAt,
      }))
      .filter(Boolean);
    if (results.length === 0 || !isAiritiURL(message.pageURL)) return;
    const snapshot = {
      results,
      pageURL: String(message.pageURL || ""),
      savedAt: Number(message.savedAt) || Date.now(),
      sourceTabId: sender.tab.id,
    };
    chrome.storage.session.set({
      [`airitiSearchResults-${sender.tab.id}`]: snapshot,
      airitiSearchResults: snapshot,
    });
    chrome.storage.local.set({ airitiSearchResults: snapshot });
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
  const filenameFormat = CiteNameCitation.normalizeFilenameFormat(settings.filenameFormat ?? settings.citationFormat);
  if (!settings.enabled) {
    suggest();
    return;
  }

  const ndltdExtension = ndltdDownloadExtension(download);
  if (ndltdExtension) {
    const metadata = await metadataForNDLTDDownload(download);
    const filename = ndltdFilename(metadata, filenameFormat, ndltdExtension);
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
    const filename = tplFilename(metadata, filenameFormat);
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

  const ojsMetadata = await metadataForOJSDownload(download);
  const ojsFilename = CiteNameCitation.filename(ojsMetadata, filenameFormat);
  if (ojsFilename) {
    await markPreNamed(download.id);
    suggest({ filename: ojsFilename, conflictAction: "uniquify" });
    return;
  }

  const doiMetadata = await metadataForDOIDownload(download);
  const doiFilename = CiteNameCitation.filename(doiMetadata, filenameFormat);
  if (doiFilename) {
    await markPreNamed(download.id);
    suggest({ filename: doiFilename, conflictAction: "uniquify" });
    return;
  }

  const scienceDirectMetadata = await metadataForScienceDirectDownload(download);
  const scienceDirectFilename = CiteNameCitation.filename(scienceDirectMetadata, filenameFormat);
  if (scienceDirectFilename) {
    await markPreNamed(download.id);
    suggest({ filename: scienceDirectFilename, conflictAction: "uniquify" });
    return;
  }

  const airitiMetadata = await metadataForAiritiDownload(download);
  const airitiFilename = CiteNameCitation.filename(airitiMetadata, filenameFormat);
  if (airitiFilename) {
    await markPreNamed(download.id);
    suggest({ filename: airitiFilename, conflictAction: "uniquify" });
    return;
  }

  const dspaceMetadata = await metadataForDSpaceDownload(download);
  const dspaceFilename = CiteNameCitation.filename(dspaceMetadata, filenameFormat);
  if (dspaceFilename) {
    await markPreNamed(download.id);
    suggest({ filename: dspaceFilename, conflictAction: "uniquify" });
    return;
  }

  const pmcMetadata = await metadataForPMCDownload(download);
  const pmcFilename = CiteNameCitation.filename(pmcMetadata, filenameFormat);
  if (pmcFilename) {
    await markPreNamed(download.id);
    suggest({ filename: pmcFilename, conflictAction: "uniquify" });
    return;
  }

  const pageMetadata = await metadataForCitationDownload(download);
  const pageDOIMetadata = await metadataForDOI(pageMetadata?.doi);
  const pageFilename = CiteNameCitation.filename(pageDOIMetadata || pageMetadata, filenameFormat);
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

    const pdfDOIMetadata = response?.ok
      ? await metadataForDOI(response.metadata?.doi)
      : null;
    const filename = response?.ok
      ? CiteNameCitation.filename(pdfDOIMetadata || response.metadata, filenameFormat)
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

async function metadataForOJSDownload(download) {
  const articleURL = [download.referrer, download.finalUrl, download.url]
    .map(CiteNameCitation.ojsArticleURL).find(Boolean);
  if (!articleURL) return null;
  try {
    const response = await fetch(articleURL, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    return response.ok ? CiteNameCitation.metadataFromHTML(await response.text()) : null;
  } catch {
    return null;
  }
}

async function metadataForDOIDownload(download) {
  const doi = [download.finalUrl, download.url, download.referrer]
    .map((url) => CiteNameCitation.doiFromURL(url) || CiteNameCitation.kargerDOIFromURL(url))
    .find(Boolean);
  return metadataForDOI(doi);
}

async function metadataForDOI(doi) {
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

async function metadataForScienceDirectDownload(download) {
  const pii = [download.finalUrl, download.url, download.referrer]
    .map(CiteNameCitation.scienceDirectPIIFromURL).find(Boolean);
  if (!pii) return null;
  try {
    const response = await fetch(`https://api.crossref.org/works?query=${encodeURIComponent(pii)}&rows=5`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const works = (await response.json())?.message?.items || [];
    const work = works.find((candidate) => (candidate?.["alternative-id"] || [])
      .some((id) => String(id).toUpperCase() === pii));
    return CiteNameCitation.metadataFromCrossrefWork(work);
  } catch {
    return null;
  }
}

async function metadataForAiritiDownload(download) {
  const isAiritiDownload = [download.finalUrl, download.url, download.referrer]
    .some(isAiritiDownloadURL);
  const pending = await chrome.storage.session.get("airitiPendingMetadata");
  const pendingMetadata = normalizeCitationMetadata(pending.airitiPendingMetadata);
  const pendingTabId = Number(pending.airitiPendingMetadata?.sourceTabId);
  const isFreshIntent = pendingMetadata && Date.now() - pendingMetadata.savedAt <= 30_000;
  const isSameTab = download.tabId >= 0 && pendingTabId === download.tabId;
  if (isFreshIntent && (isSameTab || isAiritiDownload)) {
    // Airiti may emit more than one download event for one confirmed action.
    // Keep the latest click intent until it expires or the next click replaces
    // it, so a preliminary event cannot consume the actual PDF's metadata.
    return pendingMetadata;
  }
  if (!isAiritiDownload) return null;

  const searchResultMetadata = await metadataFromAiritiSearchResults(download);
  if (searchResultMetadata) return searchResultMetadata;

  const [sessionStored, localStored] = await Promise.all([
    chrome.storage.session.get("airitiActiveMetadata"),
    chrome.storage.local.get("airitiActiveMetadata"),
  ]);
  const metadata = normalizeCitationMetadata(
    sessionStored.airitiActiveMetadata || localStored.airitiActiveMetadata
  );
  return metadata && Date.now() - metadata.savedAt <= 2 * 60 * 60 * 1000 ? metadata : null;
}

async function metadataFromAiritiSearchResults(download) {
  const tabKey = download.tabId >= 0 ? `airitiSearchResults-${download.tabId}` : "";
  const [tabStored, sessionStored, localStored] = await Promise.all([
    tabKey ? chrome.storage.session.get(tabKey) : Promise.resolve({}),
    chrome.storage.session.get("airitiSearchResults"),
    chrome.storage.local.get("airitiSearchResults"),
  ]);
  const snapshots = [tabStored[tabKey], sessionStored.airitiSearchResults, localStored.airitiSearchResults]
    .filter((snapshot) => snapshot && Date.now() - Number(snapshot.savedAt) <= 2 * 60 * 60 * 1000);
  const originalTitle = titleFromDownloadFilename(download.filename);
  if (!originalTitle) return null;

  for (const snapshot of snapshots) {
    const match = (Array.isArray(snapshot.results) ? snapshot.results : [])
      .map(normalizeCitationMetadata)
      .find((metadata) => comparableAiritiTitle(metadata?.title) === comparableAiritiTitle(originalTitle));
    if (match) return match;
  }
  return null;
}

function titleFromDownloadFilename(rawFilename) {
  let filename = String(rawFilename || "").split(/[\\/]/u).pop() || "";
  try {
    filename = decodeURIComponent(filename);
  } catch {
    // Keep the browser-provided filename when it is not URL encoded.
  }
  return filename.replace(/\.pdf$/iu, "").replace(/ \(\d+\)$/u, "").trim();
}

function comparableAiritiTitle(value) {
  return CiteNameCitation.clean(value)
    .normalize("NFKC")
    .replace(/[\s：:－—–_-]+/gu, "")
    .toLowerCase();
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
  if (!pmcID) return null;

  // Europe PMC's compact record is more reliable than an HTML fetch while the
  // download filename callback is waiting.  It also works for direct main.pdf
  // links, where there is no article tab metadata to reuse.
  try {
    const response = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`PMCID:${pmcID}`)}&format=json`, {
      headers: { Accept: "application/json" },
    });
    const record = response.ok ? (await response.json())?.resultList?.result?.[0] : null;
    const metadata = CiteNameCitation.metadataFromEuropePMCRecord(record);
    if (metadata) return metadata;
  } catch {
    // The official PMC article page remains a useful fallback below.
  }

  try {
    const response = await fetch(articleURL, {
      credentials: "include",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    return response.ok ? CiteNameCitation.metadataFromHTML(await response.text()) : null;
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
    doi: CiteNameCitation.doiFromText(raw.doi),
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
  if (isAiritiArticleURL(pageURL)) return metadata;
  return null;
}

function isAiritiArticleURL(rawURL) {
  try {
    const url = new URL(rawURL);
    return isAiritiHostname(url.hostname) &&
      /^\/Article\/Detail(?:\/|$)/iu.test(url.pathname);
  } catch {
    return false;
  }
}

function isAiritiURL(rawURL) {
  try {
    return isAiritiHostname(new URL(rawURL).hostname);
  } catch {
    return false;
  }
}

function isAiritiDownloadURL(rawURL) {
  try {
    const url = new URL(rawURL);
    // Airiti fetches the PDF with XHR, then starts the browser download from
    // an object URL such as blob:https://www-airitilibrary-com.../<uuid>.
    // A blob URL itself has no hostname, so recover the embedded origin.
    const hostname = url.protocol === "blob:"
      ? new URL(url.pathname).hostname.toLowerCase()
      : url.hostname.toLowerCase();
    return isAiritiHostname(hostname)
      || hostname === "download.nthulib-oc.nthu.edu.tw";
  } catch {
    return false;
  }
}

function isAiritiHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return /(^|\.)airitilibrary\.com$/u.test(normalized)
    // University library proxies turn dots in the original hostname into
    // hyphens, e.g. www-airitilibrary-com.nthulib-oc.nthu.edu.tw.
    || /(^|\.)www-airitilibrary-com\.[a-z0-9.-]+$/u.test(normalized);
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
