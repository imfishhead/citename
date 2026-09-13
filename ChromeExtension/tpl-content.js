function normalizedTPLLabel(text) {
  return String(text || "").replace(/\s+/g, "").replace(/[：:]$/, "");
}

function tplField(...expectedLabels) {
  const expected = new Set(expectedLabels.map(normalizedTPLLabel));
  for (const row of document.querySelectorAll("tr")) {
    const cells = Array.from(row.children).filter((element) => element.matches("th, td"));
    if (cells.length < 2 || !expected.has(normalizedTPLLabel(cells[0].innerText))) continue;
    return cells[1].innerText.replace(/\s+/g, " ").trim();
  }
  return "";
}

function sendCurrentTPLMetadata() {
  const metadata = normalizeTPLMetadata({
    author: tplField("作者"),
    title: tplField("題名"),
    year: tplField("卷期", "出版年月", "出版年"),
    sysId: extractTPLSysId(location.href),
    savedAt: Date.now(),
  });
  if (!metadata) return;
  chrome.runtime.sendMessage({ type: "tpl-journal-metadata", metadata });
}

sendCurrentTPLMetadata();
document.addEventListener("click", sendCurrentTPLMetadata, true);
