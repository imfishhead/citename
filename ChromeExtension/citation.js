(function (root) {
  "use strict";

  const REJECTED_TITLES = [
    "untitled", "microsoft word", "acrobat distiller", "doi:", "http://", "https://",
  ];
  const REJECTED_AUTHORS = [
    "pc", "user", "admin", "administrator", "author", "unknown",
    "microsoft word", "microsoft office", "acrobat", "research trends",
    "core issues", "learning sciences", "jbranch",
  ];
  const NON_ACADEMIC_TERMS = [
    "導覽手冊", "旅遊手冊", "使用手冊", "操作手冊", "活動手冊",
    "路線圖", "導覽地圖", "visitor guide", "travel guide", "user manual",
  ];

  function clean(value) {
    return String(value || "").replace(/\s+/gu, " ").trim();
  }

  function sanitize(value, maximumLength = 180) {
    const cleaned = clean(value)
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, "-")
      .replace(/^\.+|\.+$/gu, "") || "未命名論文";
    return Array.from(cleaned).slice(0, maximumLength).join("").trim();
  }

  function containsCJK(value) {
    return /[\u3400-\u9fff]/u.test(value);
  }

  function preferredSingleLanguageTitle(raw) {
    const title = clean(raw);
    if (!containsCJK(title)) return title;
    const match = title.match(/\s*[-–—/／|]\s*(?=[A-Za-z])/u);
    if (!match || match.index === undefined) return title;
    const chinese = clean(title.slice(0, match.index));
    const english = clean(title.slice(match.index + match[0].length));
    return chinese.length >= 8 && english.length >= 8 ? chinese : title;
  }

  function looksLikeExtractionNoise(title) {
    const words = clean(title).split(/\s+/u);
    const isolatedLetters = words.filter((word) => /^\p{L}$/u.test(word)).length;
    if (isolatedLetters >= 3) return true;
    if (words.length < 4) return false;
    for (let length = 2; length <= Math.min(6, Math.floor(words.length / 2)); length += 1) {
      for (let start = 0; start <= words.length - length * 2; start += 1) {
        const first = words.slice(start, start + length).join(" ").toLowerCase();
        const second = words.slice(start + length, start + length * 2).join(" ").toLowerCase();
        if (first === second) return true;
      }
    }
    return false;
  }

  function isPlausibleTitle(raw, sourceFilename = "") {
    const title = clean(raw);
    const lower = title.toLowerCase();
    if (title.length < 8 || title.length > 350) return false;
    if (!/\p{L}/u.test(title)) return false;
    if (/^[A-Za-z]:[\\/]/u.test(title) || (/\\/u.test(title) && /\.(?:ps|eps)\.pdf$/iu.test(title))) return false;
    if (REJECTED_TITLES.some((term) => lower.includes(term))) return false;
    if (looksLikeExtractionNoise(title)) return false;
    if (sourceFilename && lower === clean(sourceFilename).toLowerCase()) return false;
    return true;
  }

  function shouldUseMetadataTitle(raw, sourceFilename = "") {
    if (!isPlausibleTitle(raw, sourceFilename)) return false;
    const title = clean(raw);
    const lower = title.toLowerCase();
    const workflowWords = [
      "文字面", "校稿", "送印", "印刷檔", "工作檔", "完稿版",
      "proof copy", "print ready", "working file",
    ];
    if (workflowWords.some((term) => lower.includes(term))) return false;
    const letters = Array.from(title).filter((character) => /\p{L}/u.test(character));
    const lowercaseLetters = letters.filter((character) => /\p{Ll}/u.test(character));
    const digitCount = (title.match(/\d/gu) || []).length;
    const separatorCount = (title.match(/[-_.]/gu) || []).length;
    return !(title.includes("-") && lowercaseLetters.length === 0 && digitCount >= 3 && separatorCount >= 3);
  }

  function chineseName(value) {
    const matches = clean(value).match(/[\u3400-\u9fff]{2,}/gu);
    return matches?.[0] || "";
  }

  function normalizeAuthor(raw) {
    const name = clean(raw).replace(/^[,\s]+|[,\s]+$/gu, "");
    const chinese = chineseName(name);
    if (chinese) return chinese;
    const parts = name.split(/,(.+)/u).map(clean).filter(Boolean);
    return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
  }

  function formattedAuthors(raw) {
    if (!raw) return "";
    const cleaned = clean(raw);
    if (!cleaned || REJECTED_AUTHORS.some((term) => cleaned.toLowerCase().includes(term))) return "";
    const names = cleaned
      .replace(/\s+(?:and|&)\s+/giu, ";")
      .split(";")
      .map(normalizeAuthor)
      .filter(Boolean);
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names[0]} et al.`;
  }

  function formatAuthorList(rawAuthors) {
    const names = rawAuthors.map(normalizeAuthor).filter(Boolean);
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    return `${names[0]} et al.`;
  }

  function extractYear(raw) {
    return clean(raw).match(/(?:19|20)\d{2}/u)?.[0] || "";
  }

  function decodeHTML(value) {
    return clean(value)
      .replace(/&amp;/giu, "&").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">")
      .replace(/&quot;/giu, '"').replace(/&#39;|&#x27;/giu, "'").replace(/&nbsp;/giu, " ")
      .replace(/&#(\d+);/gu, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/giu, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
  }

  function metadataFromValues(values) {
    const first = (...names) => names.flatMap((name) => values.get(name) || [])[0] || "";
    const title = first("citation_title", "dc.title", "dcterms.title");
    if (!isPlausibleTitle(title)) return null;
    const authors = values.get("citation_author") || values.get("dc.creator") || [];
    const pdfURLs = [
      ...(values.get("citation_pdf_url") || []),
      ...(values.get("citation_fulltext_html_url") || []).filter((url) => /\.pdf(?:$|[?#])/iu.test(url)),
    ];
    return {
      title: preferredSingleLanguageTitle(title),
      author: formatAuthorList(authors),
      year: extractYear(first(
        "citation_publication_date", "citation_date", "citation_online_date",
        "dc.date", "dcterms.issued", "article:published_time",
      )),
      pdfURLs,
    };
  }

  function shouldUseCitationFormat(title) {
    const lower = clean(title).toLowerCase();
    return !NON_ACADEMIC_TERMS.some((term) => lower.includes(term));
  }

  function filename(metadata, citationFormat = true) {
    const title = preferredSingleLanguageTitle(metadata?.title);
    if (!isPlausibleTitle(title)) return "";
    const author = clean(metadata?.author);
    const year = extractYear(metadata?.year);
    if (citationFormat && author && year && shouldUseCitationFormat(title)) {
      return `${sanitize(`${author} (${year}) - ${title}`)}.pdf`;
    }
    return `${sanitize(title)}.pdf`;
  }

  function metadataFromDocument(document) {
    const values = new Map();
    for (const element of document.querySelectorAll("meta[name], meta[property]")) {
      const name = clean(element.getAttribute("name") || element.getAttribute("property")).toLowerCase();
      const content = clean(element.getAttribute("content"));
      if (!name || !content) continue;
      const list = values.get(name) || [];
      list.push(content);
      values.set(name, list);
    }

    return metadataFromValues(values);
  }

  function metadataFromHTML(html) {
    const values = new Map();
    for (const tag of String(html || "").match(/<meta\b[^>]*>/giu) || []) {
      const attributes = {};
      for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/gu)) {
        attributes[match[1].toLowerCase()] = decodeHTML(match[3]);
      }
      const name = clean(attributes.name || attributes.property).toLowerCase();
      const content = clean(attributes.content);
      if (!name || !content) continue;
      const list = values.get(name) || [];
      list.push(content);
      values.set(name, list);
    }
    return metadataFromValues(values);
  }

  function metadataFromPMCXML(xml) {
    const text = (tag) => decodeHTML(String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "iu"))?.[1] || "");
    const title = text("article-title").replace(/<[^>]+>/gu, "");
    if (!isPlausibleTitle(title)) return null;
    const authors = [...String(xml || "").matchAll(/<contrib[^>]*contrib-type=["']author["'][^>]*>[\s\S]*?<surname>([^<]+)<\/surname>[\s\S]*?<given-names>([^<]+)<\/given-names>[\s\S]*?<\/contrib>/giu)]
      .map((match) => `${match[2]} ${match[1]}`);
    return {
      title: preferredSingleLanguageTitle(title),
      author: formatAuthorList(authors),
      year: extractYear(text("year")),
      pdfURLs: [],
    };
  }

  function dspaceItemURL(rawURL) {
    try {
      const url = new URL(rawURL);
      const match = url.pathname.match(/\/entities\/publication\/([0-9a-f-]{36})(?:\/|$)/iu);
      return match ? `${url.origin}/server/api/core/items/${match[1]}` : "";
    } catch {
      return "";
    }
  }

  function metadataFromDSpaceItem(item) {
    const values = item?.metadata || {};
    const first = (...names) => names.flatMap((name) => values[name] || []).map((entry) => clean(entry?.value))[0] || "";
    const title = first("dc.title");
    if (!isPlausibleTitle(title)) return null;
    const authors = (values["dc.contributor.author"] || [])
      .map((entry) => clean(entry?.value)).filter(Boolean);
    return {
      title: preferredSingleLanguageTitle(title),
      author: formatAuthorList(authors),
      year: extractYear(first("dc.date.issued", "dc.date.created", "dc.date.available")),
      pdfURLs: [],
    };
  }

  function doiFromURL(rawURL) {
    try {
      const decoded = decodeURIComponent(new URL(rawURL).href);
      return decoded.match(/10\.\d{4,9}\/[\w.()/:;-]+/iu)?.[0].replace(/[).,;]+$/u, "") || "";
    } catch {
      return "";
    }
  }

  function metadataFromCrossrefWork(work) {
    const title = clean(work?.title?.[0]);
    if (!isPlausibleTitle(title)) return null;
    const authors = (work?.author || []).map((author) => clean([
      author.given,
      author.family,
    ].filter(Boolean).join(" "))).filter(Boolean);
    const dateParts = work?.published?.["date-parts"]
      || work?.["published-print"]?.["date-parts"]
      || work?.["published-online"]?.["date-parts"];
    return {
      title: preferredSingleLanguageTitle(title),
      author: formatAuthorList(authors),
      year: clean(dateParts?.[0]?.[0]),
      pdfURLs: [],
    };
  }

  function articleURLForPMC(rawURL) {
    try {
      const url = new URL(rawURL);
      if (url.hostname.toLowerCase() !== "pmc.ncbi.nlm.nih.gov") return "";
      const match = `${url.pathname}${url.search}`.match(/(PMC\d+)/iu);
      return match ? `https://pmc.ncbi.nlm.nih.gov/articles/${match[1].toUpperCase()}/` : "";
    } catch {
      return "";
    }
  }

  root.CiteNameCitation = {
    articleURLForPMC,
    clean,
    extractYear,
    filename,
    dspaceItemURL,
    doiFromURL,
    formattedAuthors,
    isPlausibleTitle,
    metadataFromDocument,
    metadataFromDSpaceItem,
    metadataFromCrossrefWork,
    metadataFromHTML,
    metadataFromPMCXML,
    normalizeAuthor,
    preferredSingleLanguageTitle,
    sanitize,
    shouldUseMetadataTitle,
  };
})(globalThis);
