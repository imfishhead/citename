function normalizedLabel(text) {
  return String(text || "").replace(/\s+/g, "").replace(/[：:]$/, "");
}

function thesisField(...expectedLabels) {
  const expected = new Set(expectedLabels.map(normalizedLabel));
  for (const row of document.querySelectorAll("tr")) {
    const cells = Array.from(row.children).filter((element) =>
      element.matches("th, td")
    );
    if (cells.length < 2 || !expected.has(normalizedLabel(cells[0].innerText))) continue;
    return cells[1].innerText.replace(/\s+/g, " ").trim();
  }
  return "";
}

function sendCurrentThesisMetadata() {
  const sessionKey = extractNDLTDSessionKey(location.href);
  const metadata = normalizeNDLTDMetadata({
    author: thesisField("研究生"),
    title: thesisField("論文名稱"),
    year: thesisField("論文出版年"),
    sessionKey,
    savedAt: Date.now(),
  });
  if (!metadata) return;
  chrome.runtime.sendMessage({ type: "ndltd-thesis-metadata", metadata });
}

sendCurrentThesisMetadata();
document.addEventListener("click", sendCurrentThesisMetadata, true);
