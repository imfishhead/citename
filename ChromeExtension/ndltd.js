function isNDLTDURL(rawURL) {
  if (!rawURL) return false;
  try {
    return new URL(rawURL).hostname.toLowerCase() === "ndltd.ncl.edu.tw";
  } catch {
    return false;
  }
}

function extractNDLTDSessionKey(rawURL) {
  if (!isNDLTDURL(rawURL)) return null;
  const match = rawURL.match(/(?:^|[/?&])ccd=([^/?&#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeNDLTDMetadata(raw) {
  if (!raw || typeof raw !== "object") return null;
  const clean = (value, maximum) => String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
  const metadata = {
    author: preferredNDLTDName(clean(raw.author, 120)),
    title: clean(raw.title, 350),
    year: clean(raw.year, 4),
    sessionKey: clean(raw.sessionKey, 100),
    savedAt: Number(raw.savedAt) || Date.now(),
  };
  if (!metadata.author || !metadata.title) return null;
  if (metadata.year && !/^(?:19|20)\d{2}$/.test(metadata.year)) metadata.year = "";
  return metadata;
}

function preferredNDLTDName(rawName) {
  const name = String(rawName || "").replace(/\s+/g, " ").trim();
  const chineseName = name.match(/[\u3400-\u9fff]{2,6}/u);
  return chineseName ? chineseName[0] : name;
}

function sanitizeDownloadBaseName(raw) {
  const result = String(raw || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return Array.from(result).slice(0, 180).join("") || "download";
}

function ndltdFilename(metadata, citationFormat, extension) {
  const normalized = normalizeNDLTDMetadata(metadata);
  if (!normalized) return null;
  if (!["pdf", "zip"].includes(extension)) return null;
  const prefix = citationFormat && normalized.year
    ? `${normalized.author} (${normalized.year})`
    : normalized.author;
  return `${sanitizeDownloadBaseName(`${prefix} - ${normalized.title}`)}.${extension}`;
}

function ndltdZipFilename(metadata, citationFormat) {
  return ndltdFilename(metadata, citationFormat, "zip");
}

if (typeof module !== "undefined") {
  module.exports = {
    isNDLTDURL,
    extractNDLTDSessionKey,
    preferredNDLTDName,
    normalizeNDLTDMetadata,
    sanitizeDownloadBaseName,
    ndltdFilename,
    ndltdZipFilename,
  };
}
