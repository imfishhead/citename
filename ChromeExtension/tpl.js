function isTPLURL(rawURL) {
  if (!rawURL) return false;
  try {
    return new URL(rawURL).hostname.toLowerCase() === "tpl.ncl.edu.tw";
  } catch {
    return false;
  }
}

function extractTPLSysId(rawURL) {
  if (!isTPLURL(rawURL)) return null;
  try {
    return new URL(rawURL).searchParams.get("SysId");
  } catch {
    return null;
  }
}

function preferredTPLTitle(rawTitle) {
  const title = String(rawTitle || "").replace(/\s+/g, " ").trim();
  const parts = title.split(/\s*=\s*/).filter(Boolean);
  if (parts.length < 2) return title;
  const chinese = parts.find((part) => /[\u3400-\u9fff]/u.test(part));
  return chinese || parts[0];
}

function gregorianYearFromTPL(raw) {
  const text = String(raw || "");
  const roc = text.match(/民(?:國)?\s*(\d{2,3})/);
  if (roc) return String(Number(roc[1]) + 1911);
  const gregorian = text.match(/(?:19|20)\d{2}/);
  return gregorian ? gregorian[0] : "";
}

function normalizeTPLMetadata(raw) {
  if (!raw || typeof raw !== "object") return null;
  const clean = (value, maximum) => String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[;；、,，\s]+$/g, "")
    .trim()
    .slice(0, maximum);
  const metadata = {
    author: clean(raw.author, 160),
    title: preferredTPLTitle(clean(raw.title, 500)).slice(0, 350),
    year: gregorianYearFromTPL(raw.year),
    sysId: clean(raw.sysId, 30),
    savedAt: Number(raw.savedAt) || Date.now(),
  };
  if (!metadata.author || !metadata.title) return null;
  return metadata;
}

function tplFilename(metadata, citationFormat) {
  const normalized = normalizeTPLMetadata(metadata);
  if (!normalized) return null;
  const prefix = citationFormat && normalized.year
    ? `${normalized.author} (${normalized.year})`
    : normalized.author;
  return `${sanitizeDownloadBaseName(`${prefix} - ${normalized.title}`)}.pdf`;
}

if (typeof module !== "undefined") {
  module.exports = {
    isTPLURL,
    extractTPLSysId,
    preferredTPLTitle,
    gregorianYearFromTPL,
    normalizeTPLMetadata,
    tplFilename,
  };
}
