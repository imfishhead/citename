(async function () {
  "use strict";

  const metadata = await metadataForCurrentPage();
  if (!metadata) return;
  metadata.pdfURLs = metadata.pdfURLs.flatMap((rawURL) => {
    try {
      return [new URL(rawURL, document.baseURI).href];
    } catch {
      return [];
    }
  });

  chrome.runtime.sendMessage({
    type: "citation-page-metadata",
    metadata: {
      ...metadata,
      pageURL: location.href,
      savedAt: Date.now(),
    },
  });

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
