(function (root) {
  "use strict";

  const Citation = root.CiteNameCitation;
  const AFFILIATION_WORDS = [
    "university", "college", "institute", "department", "school of",
    "faculty", "hospital", "laboratory", "centre", "center", "academy",
  ];

  function fontSize(item) {
    const matrixSize = Math.hypot(Number(item.transform?.[2]) || 0, Number(item.transform?.[3]) || 0);
    return Number(item.height) || matrixSize || 0;
  }

  function textLines(items) {
    const entries = items
      .filter((item) => Citation.clean(item.str))
      .map((item, index) => ({
        text: Citation.clean(item.str),
        x: Number(item.transform?.[4]) || 0,
        y: Number(item.transform?.[5]) || 0,
        width: Number(item.width) || 0,
        size: fontSize(item),
        hasEOL: Boolean(item.hasEOL),
        index,
      }));

    const groups = [];
    for (const entry of entries) {
      let group = groups.find((candidate) => Math.abs(candidate.y - entry.y) <= Math.max(2, entry.size * 0.22));
      if (!group) {
        group = { y: entry.y, items: [] };
        groups.push(group);
      }
      group.items.push(entry);
      group.y = group.items.reduce((total, item) => total + item.y, 0) / group.items.length;
    }

    return groups
      .sort((left, right) => right.y - left.y)
      .slice(0, 60)
      .map((group, index) => {
        const sorted = group.items.sort((left, right) => left.x - right.x || left.index - right.index);
        let text = "";
        let previous;
        for (const item of sorted) {
          if (previous) {
            const estimatedEnd = previous.x + Math.max(0, Number(previous.width) || 0);
            const needsSpace = item.x - estimatedEnd > Math.max(1, item.size * 0.12) ||
              !/[-‐‑‒–—\s]$/u.test(text);
            if (needsSpace) text += " ";
          }
          text += item.text;
          previous = item;
        }
        return {
          text: Citation.clean(text),
          fontSize: Math.max(...sorted.map((item) => item.size), 0),
          index,
        };
      })
      .filter((line) => line.text);
  }

  function plainText(items) {
    let text = "";
    for (const item of items) {
      const value = Citation.clean(item.str);
      if (!value) continue;
      text += `${text && !text.endsWith("\n") ? " " : ""}${value}${item.hasEOL ? "\n" : ""}`;
    }
    return text.trim();
  }

  function looksLikeSectionHeading(text) {
    const normalized = Citation.clean(text).toLowerCase();
    return normalized === "abstract" || normalized.startsWith("abstract ") ||
      normalized === "摘要" || normalized === "introduction" ||
      normalized.startsWith("1. introduction") || normalized.startsWith("keywords");
  }

  function looksLikeAuthorLine(text) {
    const lower = text.toLowerCase();
    if (lower.includes("@") || AFFILIATION_WORDS.some((word) => lower.includes(word)) ||
        lower.includes("corresponding author")) return true;
    return (text.match(/,/gu) || []).length >= 2 && text.length < 120;
  }

  function titleFromTypography(lines) {
    const sectionIndex = lines.findIndex((line) => looksLikeSectionHeading(line.text));
    const cutoff = sectionIndex >= 0 ? sectionIndex : Math.min(lines.length, 35);
    const eligible = lines.slice(0, cutoff).filter((line) =>
      Citation.isPlausibleTitle(line.text) && !looksLikeAuthorLine(line.text)
    );
    if (eligible.length === 0) return "";
    const largest = Math.max(...eligible.map((line) => line.fontSize), 0);
    const allSizes = lines.map((line) => line.fontSize).filter((size) => size > 0).sort((left, right) => left - right);
    const typicalSize = allSizes[Math.floor(allSizes.length * 0.25)] || 0;
    const titleIsProminent = largest >= 15 || (typicalSize > 0 && largest >= typicalSize * 1.35);
    if (!titleIsProminent) return "";
    const first = eligible.find((line) => largest === 0 || line.fontSize >= largest - 0.6);
    if (!first) return "";

    const parts = [first.text];
    for (const line of lines) {
      if (line.index <= first.index || line.index - first.index > 3) continue;
      const lower = line.text.toLowerCase();
      if (lower === "by" || lower.startsWith("by ") || looksLikeAuthorLine(line.text)) break;
      if (largest > 0 && Math.abs(line.fontSize - first.fontSize) > 0.6) break;
      parts.push(line.text);
    }
    const joined = Citation.clean(parts.join(" "));
    return Citation.isPlausibleTitle(joined) ? joined : first.text;
  }

  function titleFromPlainText(text) {
    const lines = text.split(/\r?\n/u).slice(0, 50).map(Citation.clean).filter(Boolean);
    const sectionIndex = lines.findIndex(looksLikeSectionHeading);
    const cutoff = sectionIndex >= 0 ? sectionIndex : Math.min(lines.length, 30);
    const candidates = lines.slice(0, cutoff)
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => Citation.isPlausibleTitle(value) && !looksLikeAuthorLine(value));
    candidates.sort((left, right) => {
      const score = ({ value, index }) => Math.min(value.length, 140) + Math.max(0, 25 - index * 2) -
        (value.endsWith(".") && value.length > 120 ? 40 : 0);
      return score(right) - score(left);
    });
    return candidates[0]?.value || "";
  }

  function looksLikePersonName(line) {
    const lower = Citation.clean(line).toLowerCase();
    if (["research trends", "learning sciences", "core issues"].some((term) => lower.includes(term))) return false;
    if (AFFILIATION_WORDS.some((term) => lower.includes(term))) return false;
    if (lower.includes("@") || lower.includes("http") || line.includes(":")) return false;
    if (line.length < 3 || line.length > 100 || !/\p{L}/u.test(line)) return false;
    const words = line.split(/\s+/u);
    if (!/[\u3400-\u9fff]/u.test(line) && (words.length < 2 || words.length > 8)) return false;
    return !line.includes(".") || words.length <= 6;
  }

  function authorsFromFirstPage(lines, title) {
    const titleLower = title.toLowerCase();
    const titleEndIndex = lines.reduce((lastIndex, line, index) => {
      const value = line.text.toLowerCase();
      return value && titleLower.includes(value) ? index : lastIndex;
    }, -1);
    if (titleEndIndex < 0) return "";
    const names = [];
    for (const line of lines.slice(titleEndIndex + 1, titleEndIndex + 13)) {
      const lower = line.text.toLowerCase();
      if (names.length > 0 && (line.text === line.text.toUpperCase() || lower === "abstract" || lower === "摘要")) break;
      if (looksLikePersonName(line.text)) names.push(line.text);
    }
    if (names.length === 0) return "";
    if (names.length === 1) return Citation.normalizeAuthor(names[0]);
    if (names.length === 2) return `${Citation.normalizeAuthor(names[0])} & ${Citation.normalizeAuthor(names[1])}`;
    return `${Citation.normalizeAuthor(names[0])} et al.`;
  }

  function publicationYear(firstPageText, creationDate) {
    const patterns = [
      /(?:©|copyright|published|publication)\D{0,30}((?:19|20)\d{2})/iu,
      /arxiv:.{0,80}((?:19|20)\d{2})/iu,
      /^\s*((?:19|20)\d{2})\s*$/mu,
    ];
    for (const pattern of patterns) {
      const year = firstPageText.match(pattern)?.[1];
      if (year) return year;
    }
    return String(creationDate || "").match(/(?:19|20)\d{2}/u)?.[0] || "";
  }

  function hasAcademicSignals(firstPageText) {
    const text = Citation.clean(firstPageText).toLowerCase();
    const signals = [
      /\babstract\b/u,
      /\bkeywords?\b/u,
      /\bdoi\s*:/u,
      /\breceived\s*:/u,
      /\baccepted\s*:/u,
      /\bjournal\b/u,
      /\bvolume\s+\d+/u,
      /\bmanuscript\b/u,
      /摘要/u,
      /關鍵詞|关键词/u,
      /參考文獻|参考文献/u,
      /學報|学报|期刊|論文|论文/u,
    ];
    return signals.some((pattern) => pattern.test(text));
  }

  async function analyzeDocument(document, sourceFilename = "") {
    const metadata = await document.getMetadata().catch(() => ({ info: {} }));
    const info = metadata?.info || {};
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const lines = textLines(content.items || []);
    const pageText = plainText(content.items || []);
    const sourceBase = String(sourceFilename).replace(/\.pdf$/iu, "");
    const academic = hasAcademicSignals(pageText);

    let title = "";
    if (Citation.shouldUseMetadataTitle(info.Title, sourceBase)) {
      title = Citation.preferredSingleLanguageTitle(info.Title);
    } else {
      title = Citation.preferredSingleLanguageTitle(titleFromTypography(lines));
    }
    if (!title) return null;

    const result = {
      title,
      author: academic ? Citation.formattedAuthors(info.Author) || authorsFromFirstPage(lines, title) : "",
      year: academic ? publicationYear(pageText, info.CreationDate) : "",
    };
    const doi = Citation.doiFromText(pageText);
    if (doi) result.doi = doi;
    return result;
  }

  async function analyzeData(pdfjsLib, data, options = {}) {
    const source = {
      data: data instanceof Uint8Array ? data : new Uint8Array(data),
      cMapPacked: true,
      useWorkerFetch: true,
    };
    if (options.cMapUrl) source.cMapUrl = options.cMapUrl;
    if (options.standardFontDataUrl) source.standardFontDataUrl = options.standardFontDataUrl;
    if (options.wasmUrl) source.wasmUrl = options.wasmUrl;
    if (Number.isInteger(options.verbosity)) source.verbosity = options.verbosity;
    const loadingTask = pdfjsLib.getDocument(source);
    const document = await loadingTask.promise;
    try {
      return await analyzeDocument(document, options.sourceFilename || "");
    } finally {
      await loadingTask.destroy();
    }
  }

  root.CiteNamePDF = {
    analyzeData,
    analyzeDocument,
    authorsFromFirstPage,
    hasAcademicSignals,
    publicationYear,
    textLines,
    titleFromPlainText,
    titleFromTypography,
  };
})(globalThis);
