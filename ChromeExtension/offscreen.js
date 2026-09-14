import * as pdfjsLib from "./vendor/pdf.min.mjs";

const MAXIMUM_BYTES = 100 * 1024 * 1024;
const PDF_ANALYSIS_TIMEOUT = 18_000;

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "analyze-pdf-download") return undefined;
  analyzeDownload(message)
    .then((metadata) => sendResponse({ ok: Boolean(metadata), metadata }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function analyzeDownload(message) {
  const pmcArticleURL = globalThis.CiteNameCitation.articleURLForPMC(message.url);
  if (pmcArticleURL) {
    const document = await fetchHTMLDocument(pmcArticleURL);
    const metadata = globalThis.CiteNameCitation.metadataFromDocument(document);
    if (metadata) return metadata;
  }

  const data = await fetchPDF(message.url);
  return globalThis.CiteNamePDF.analyzeData(pdfjsLib, data, {
    sourceFilename: message.sourceFilename,
    cMapUrl: chrome.runtime.getURL("vendor/cmaps/"),
    standardFontDataUrl: chrome.runtime.getURL("vendor/standard_fonts/"),
    wasmUrl: chrome.runtime.getURL("vendor/wasm/"),
  });
}

async function fetchHTMLDocument(url) {
  const response = await fetchWithTimeout(url, {
    credentials: "include",
    headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`網站回傳 HTTP ${response.status}`);
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

async function fetchPDF(url) {
  const response = await fetchWithTimeout(url, {
    credentials: "include",
    headers: { Accept: "application/pdf,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`PDF 回傳 HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length")) || 0;
  if (declaredLength > MAXIMUM_BYTES) throw new Error("PDF 超過 100 MB");
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > MAXIMUM_BYTES) throw new Error("PDF 超過 100 MB");
  const header = new TextDecoder("latin1").decode(data.slice(0, 1024));
  if (!header.includes("%PDF-")) throw new Error("下載內容不是 PDF");
  return data;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_ANALYSIS_TIMEOUT);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("PDF 分析逾時");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
