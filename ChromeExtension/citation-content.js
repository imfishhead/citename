(async function () {
  "use strict";
  let lastAiritiResultsSignature = "";

  if (isAiritiPage()) {
    installAiritiDownloadListener();
    installAiritiSearchResultsPublisher();
  }

  const metadata = await metadataForCurrentPage();
  if (!metadata) return;
  metadata.pdfURLs = metadata.pdfURLs.flatMap((rawURL) => {
    try {
      return [new URL(rawURL, document.baseURI).href];
    } catch {
      return [];
    }
  });

  const pageMetadata = {
    ...metadata,
    pageURL: location.href,
    doi: metadata.doi || globalThis.CiteNameCitation.doiFromURL(location.href),
    savedAt: Date.now(),
  };

  chrome.runtime.sendMessage({
    type: "citation-page-metadata",
    metadata: pageMetadata,
  });

  function installAiritiDownloadListener() {
    const eventTarget = typeof globalThis.addEventListener === "function" ? globalThis : document;
    eventTarget.addEventListener("click", (event) => {
      const target = typeof event.target?.closest === "function" ? event.target : null;
      const downloadPoint = target?.closest(".downloadPoint, .tool_downloadPoint");
      if (!downloadPoint) return;

      const searchResult = downloadPoint.closest(".searchResultGroup");
      const metadataAtDownload = searchResult
        ? globalThis.CiteNameCitation.metadataFromAiritiSearchResult(searchResult)
        : (isAiritiArticlePage()
          ? globalThis.CiteNameCitation.metadataFromDocument(document)
          : null);
      if (!metadataAtDownload) return;

      const downloadMetadata = {
        ...metadataAtDownload,
        pageURL: location.href,
        doi: metadataAtDownload?.doi || globalThis.CiteNameCitation.doiFromURL(location.href),
        savedAt: Date.now(),
      };
      publishAiritiSearchResults();
      chrome.runtime.sendMessage({ type: "airiti-download-intent", metadata: downloadMetadata });
    }, true);
  }

  function installAiritiSearchResultsPublisher() {
    publishAiritiSearchResults();
    if (typeof MutationObserver === "function") {
      let timer;
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(publishAiritiSearchResults, 100);
      });
      // Airiti replaces the whole result area during pagination. Observing the
      // Document keeps working even when its documentElement or body changes.
      observer.observe(document, { childList: true, subtree: true });
    }
    // Some Airiti pagination paths replace nodes without delivering mutations
    // to the original observer. A lightweight signature check keeps the current
    // page's result metadata in sync without repeatedly writing identical data.
    if (typeof setInterval === "function") setInterval(publishAiritiSearchResults, 1000);
  }

  function publishAiritiSearchResults() {
    const results = Array.from(document.querySelectorAll?.(".searchResultGroup") || [])
      .map((result) => globalThis.CiteNameCitation.metadataFromAiritiSearchResult(result))
      .filter(Boolean);
    if (results.length === 0) return;
    const signature = JSON.stringify(results.map(({ title, author, year }) => [title, author, year]));
    if (signature === lastAiritiResultsSignature) return;
    lastAiritiResultsSignature = signature;
    chrome.runtime.sendMessage({
      type: "airiti-search-results-metadata",
      pageURL: location.href,
      savedAt: Date.now(),
      results,
    });
  }

  function isAiritiPage() {
    try {
      const url = new URL(location.href);
      return isAiritiHostname(url.hostname);
    } catch {
      return false;
    }
  }

  function isAiritiArticlePage() {
    try {
      const url = new URL(location.href);
      return isAiritiHostname(url.hostname)
        && /^\/Article\/Detail(?:\/|$)/iu.test(url.pathname);
    } catch {
      return false;
    }
  }

  function isAiritiHostname(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return /(^|\.)airitilibrary\.com$/u.test(normalized)
      || /(^|\.)www-airitilibrary-com\.[a-z0-9.-]+$/u.test(normalized);
  }

  async function metadataForCurrentPage() {
    const itemURL = globalThis.CiteNameCitation.dspaceItemURL(location.href);
    if (itemURL) {
      try {
        const response = await fetch(itemURL, { headers: { Accept: "application/json" } });
        if (response.ok) {
          const metadata = globalThis.CiteNameCitation.metadataFromDSpaceItem(await response.json());
          if (metadata) return metadata;
        }
      } catch {
        // Continue with standard citation metadata when the repository API is unavailable.
      }
    }
    return globalThis.CiteNameCitation.metadataFromDocument(document);
  }
})();
