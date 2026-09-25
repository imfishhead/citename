const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "../..");
const extensionRoot = path.join(projectRoot, "ChromeExtension");

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    async emit(...args) {
      return Promise.all(listeners.map((listener) => listener(...args)));
    },
  };
}

function createStorageArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(query) {
      if (typeof query === "string") return { [query]: data[query] };
      if (Array.isArray(query)) {
        return Object.fromEntries(query.map((key) => [key, data[key]]));
      }
      if (query && typeof query === "object") {
        return Object.fromEntries(
          Object.entries(query).map(([key, fallback]) => [
            key,
            Object.hasOwn(data, key) ? data[key] : fallback,
          ])
        );
      }
      return { ...data };
    },
    async set(values) {
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

function loadScript(context, filename) {
  const absolutePath = path.join(extensionRoot, filename);
  vm.runInContext(fs.readFileSync(absolutePath, "utf8"), context, {
    filename: absolutePath,
  });
}

function createBackgroundHarness({ settings, analysisHandler, fetchHandler } = {}) {
  const onInstalled = createEvent();
  const onMessage = createEvent();
  const onDeterminingFilename = createEvent();
  const onChanged = createEvent();
  const local = createStorageArea(settings);
  const session = createStorageArea();
  const notifications = [];
  const analysisCalls = [];
  const offscreenCreates = [];
  const downloadsById = new Map();

  const chrome = {
    runtime: {
      lastError: undefined,
      onInstalled,
      onMessage,
      getURL(filename) {
        return `chrome-extension://test/${filename}`;
      },
      async getContexts() {
        return [{ contextType: "OFFSCREEN_DOCUMENT" }];
      },
      async sendMessage(message) {
        analysisCalls.push(message);
        return analysisHandler
          ? analysisHandler({ message, callIndex: analysisCalls.length - 1 })
          : { ok: false, error: "No PDF analysis configured" };
      },
    },
    offscreen: {
      async createDocument(options) {
        offscreenCreates.push(options);
      },
    },
    storage: { local, session },
    downloads: {
      onDeterminingFilename,
      onChanged,
      async search({ id }) {
        const download = downloadsById.get(id);
        return download ? [download] : [];
      },
    },
    notifications: {
      create(notification) {
        notifications.push(notification);
      },
    },
  };

  const sandbox = {
    URL,
    Date,
    Promise,
    console,
    chrome,
    async fetch(url, options) {
      return fetchHandler ? fetchHandler(url, options) : { ok: false };
    },
    clearTimeout,
    setTimeout(callback, milliseconds) {
      const timer = setTimeout(callback, Math.min(milliseconds, 25));
      timer.unref();
      return timer;
    },
  };
  const context = vm.createContext(sandbox);
  sandbox.importScripts = (...filenames) => {
    for (const filename of filenames) loadScript(context, filename);
  };
  loadScript(context, "background.js");

  assert.equal(onDeterminingFilename.listeners.length, 1);
  assert.equal(onChanged.listeners.length, 1);

  return {
    chrome,
    context,
    downloadsById,
    local,
    analysisCalls,
    notifications,
    onChanged,
    onInstalled,
    onMessage,
    session,
    async determine(download) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("suggest callback timed out")), 500);
        const keepChannelOpen = onDeterminingFilename.listeners[0](download, (suggestion) => {
          clearTimeout(timeout);
          resolve(suggestion);
        });
        assert.equal(keepChannelOpen, true);
      });
    },
    async complete(download) {
      downloadsById.set(download.id, { ...download, state: "complete" });
      await onChanged.emit({ id: download.id, state: { current: "complete" } });
    },
  };
}

function fakeDocument(rows) {
  const elements = rows.map(([label, value]) => ({
    children: [label, value].map((innerText) => ({
      innerText,
      matches(selector) {
        return selector === "th, td";
      },
    })),
  }));
  return {
    querySelectorAll(selector) {
      assert.equal(selector, "tr");
      return elements;
    },
    addEventListener() {},
  };
}

function metadataMessageFromContentScript({ helper, content, href, rows }) {
  const messages = [];
  const context = vm.createContext({
    URL,
    Date,
    console,
    location: { href },
    document: fakeDocument(rows),
    chrome: {
      runtime: {
        sendMessage(message) {
          messages.push(message);
        },
      },
    },
  });
  loadScript(context, helper);
  loadScript(context, content);
  assert.equal(messages.length, 1);
  return messages[0];
}

test("manifest points only to files that exist", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
  const referencedFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((entry) => entry.js),
  ];
  assert.equal(manifest.name, "CiteName");
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(!manifest.permissions.includes("nativeMessaging"));
  assert.ok(manifest.host_permissions.includes("https://*/*"));
  for (const filename of new Set(referencedFiles)) {
    assert.ok(fs.existsSync(path.join(extensionRoot, filename)), `Missing ${filename}`);
  }
});

test("installation writes default settings without overwriting saved values", async () => {
  const harness = createBackgroundHarness({ settings: { enabled: false } });
  await harness.onInstalled.emit();
  assert.deepEqual(harness.local.data, {
    enabled: false,
    citationFormat: true,
    filenameFormat: "author-year-title",
  });
});

test("NDLTD page metadata renames a ZIP and reports completion", async () => {
  const harness = createBackgroundHarness();
  const detailURL = "https://ndltd.ncl.edu.tw/cgi-bin/gs32/gsweb.cgi/ccd=vf7ZsD/fulltextdeclare";
  const message = metadataMessageFromContentScript({
    helper: "ndltd.js",
    content: "ndltd-content.js",
    href: detailURL,
    rows: [
      ["研究生：", "陳彥蓉 / Chen, Yen-Jung"],
      ["論文名稱：", "提問課程設計促進國小中年級學生提問行為之行動研究"],
      ["論文出版年：", "2025"],
    ],
  });
  await harness.onMessage.emit(message, { url: detailURL });

  const download = {
    id: 1,
    filename: "fb260913193026.zip",
    finalUrl: "https://ndltd.ncl.edu.tw/cgi-bin/gs32/gsweb.cgi/ccd=vf7ZsD/file.zip",
    referrer: detailURL,
    mime: "application/zip",
  };
  const suggestion = await harness.determine(download);
  assert.deepEqual({ ...suggestion }, {
    filename: "陳彥蓉 (2025) - 提問課程設計促進國小中年級學生提問行為之行動研究.zip",
    conflictAction: "uniquify",
  });

  await harness.complete({ ...download, filename: `/Downloads/${suggestion.filename}` });
  assert.equal(harness.analysisCalls.length, 0);
  assert.equal(harness.notifications.at(-1).title, "論文 ZIP 已重新命名");
  assert.equal(harness.session.data["preNamed-1"], undefined);
});

test("NDLTD rejects metadata from another session and preserves the ZIP filename", async () => {
  const harness = createBackgroundHarness();
  await harness.session.set({
    ndltdActiveMetadata: {
      author: "測試作者",
      title: "不應套用到其他論文",
      year: "2024",
      sessionKey: "oldSession",
      savedAt: Date.now(),
    },
  });
  const suggestion = await harness.determine({
    id: 2,
    filename: "download.zip",
    finalUrl: "https://ndltd.ncl.edu.tw/cgi-bin/gs32/gsweb.cgi/ccd=newSession/file.zip",
    mime: "application/zip",
  });
  assert.equal(suggestion, undefined);
  assert.equal(harness.analysisCalls.length, 0);
});

test("NDLTD supports PDF downloads and title-only citation settings", async () => {
  const harness = createBackgroundHarness({
    settings: { enabled: true, citationFormat: false },
  });
  const detailURL = "https://ndltd.ncl.edu.tw/cgi-bin/gs32/gsweb.cgi/ccd=pdfSession/fulltextdeclare";
  await harness.onMessage.emit({
    type: "ndltd-thesis-metadata",
    metadata: {
      author: "Yen-Jung 陳彥蓉-Chen",
      title: "提問課程設計促進國小中年級學生提問行為之行動研究",
      year: "2025",
      sessionKey: "pdfSession",
      savedAt: Date.now(),
    },
  }, { url: detailURL });
  const suggestion = await harness.determine({
    id: 9,
    filename: "fulltext.pdf",
    finalUrl: "https://ndltd.ncl.edu.tw/cgi-bin/gs32/gsweb.cgi/ccd=pdfSession/fulltext.pdf",
    referrer: detailURL,
    mime: "application/pdf",
  });
  assert.equal(
    suggestion.filename,
    "提問課程設計促進國小中年級學生提問行為之行動研究.pdf"
  );
  assert.equal(harness.analysisCalls.length, 0);
});

test("TPL detail metadata renames a scanned journal PDF", async () => {
  const harness = createBackgroundHarness();
  const detailURL = "https://tpl.ncl.edu.tw/NclService/JournalContentDetail?SysId=A99032746";
  const message = metadataMessageFromContentScript({
    helper: "tpl.js",
    content: "tpl-content.js",
    href: detailURL,
    rows: [
      ["題　名", "網路科技支援之電腦教學軟體對學生學習科學概念的影響=The Impacts on Science Learning"],
      ["作　者", "許瑛玿;"],
      ["卷　期", "44:1/2 民88.10"],
    ],
  });
  await harness.onMessage.emit(message, { url: detailURL });

  const download = {
    id: 3,
    filename: "C-wisoftimageoutputA99032746.pdf.pdf",
    finalUrl: "https://tpl.ncl.edu.tw/NclService/pdfdownload?xmlId=0005631586",
    referrer: detailURL,
    mime: "application/pdf",
  };
  const suggestion = await harness.determine(download);
  assert.deepEqual({ ...suggestion }, {
    filename: "許瑛玿 (1999) - 網路科技支援之電腦教學軟體對學生學習科學概念的影響.pdf",
    conflictAction: "uniquify",
  });
  await harness.complete({ ...download, filename: `/Downloads/${suggestion.filename}` });
  assert.equal(harness.analysisCalls.length, 0);
  assert.equal(harness.notifications.at(-1).title, "PDF 已使用論文資料命名");
});

test("expired TPL metadata falls through to the in-extension PDF analyzer", async () => {
  const harness = createBackgroundHarness({
    analysisHandler: () => ({
      ok: true,
      metadata: { title: "Fallback title", author: "", year: "" },
    }),
  });
  await harness.session.set({
    tplActiveMetadata: {
      author: "過期作者",
      title: "過期標題",
      year: "2020",
      sysId: "OLD",
      savedAt: Date.now() - 3 * 60 * 60 * 1000,
    },
  });
  const suggestion = await harness.determine({
    id: 10,
    filename: "scan.pdf",
    finalUrl: "https://tpl.ncl.edu.tw/NclService/pdfdownload?xmlId=1",
    mime: "application/pdf",
  });
  assert.equal(suggestion.filename, "Fallback title.pdf");
  assert.equal(harness.analysisCalls.length, 1);
});

test("a generic PDF uses the in-extension PDF analyzer", async () => {
  const harness = createBackgroundHarness({
    analysisHandler: ({ message }) => {
      assert.equal(message.type, "analyze-pdf-download");
      return {
        ok: true,
        metadata: { title: "Analytical Engines", author: "Ada Lovelace", year: "2024" },
      };
    },
  });
  const download = {
    id: 4,
    filename: "paper.pdf",
    finalUrl: "https://example.org/paper.pdf",
    mime: "application/pdf",
  };
  const suggestion = await harness.determine(download);
  assert.equal(suggestion.filename, "Ada Lovelace (2024) - Analytical Engines.pdf");
  await harness.complete({ ...download, filename: `/Downloads/${suggestion.filename}` });
  assert.equal(harness.analysisCalls.length, 1);
  assert.equal(harness.notifications.at(-1).title, "PDF 已使用論文資料命名");
});

test("generic citation metadata avoids downloading and parsing the PDF twice", async () => {
  const harness = createBackgroundHarness();
  const pageURL = "https://example.org/articles/analytical-engines";
  await harness.onMessage.emit({
    type: "citation-page-metadata",
    metadata: {
      title: "Analytical Engines",
      author: "Ada Lovelace",
      year: "2024",
      pageURL,
      pdfURLs: ["https://example.org/paper.pdf"],
      savedAt: Date.now(),
    },
  }, { url: pageURL, tab: { id: 42 } });
  const suggestion = await harness.determine({
    id: 14,
    tabId: 42,
    filename: "paper.pdf",
    finalUrl: "https://example.org/paper.pdf",
    referrer: pageURL,
    mime: "application/pdf",
  });
  assert.equal(suggestion.filename, "Ada Lovelace (2024) - Analytical Engines.pdf");
  assert.equal(harness.analysisCalls.length, 0);
});

test("a DOI from the article page takes priority over a Springer book title", async () => {
  const pageURL = "https://link.springer.com/chapter/10.1007/978-3-319-24589-8_14";
  let crossrefCalls = 0;
  const harness = createBackgroundHarness({
    async fetchHandler(url) {
      crossrefCalls += 1;
      assert.match(url, /10.1007%2F978-3-319-24589-8_14/u);
      return {
        ok: true,
        async json() {
          return { message: {
            title: ["Evolutionary Changes of Pokemon Game: A Case Study with Focus On Catching Pokemon"],
            author: [
              { given: "Chetprayoon", family: "Panumate" },
              { given: "Shuo", family: "Xiong" },
              { given: "Hiroyuki", family: "Iida" },
            ],
            published: { "date-parts": [[2015]] },
          } };
        },
      };
    },
  });
  await harness.onMessage.emit({
    type: "citation-page-metadata",
    metadata: {
      title: "Entertainment Computing - ICEC 2015",
      pageURL,
      doi: "10.1007/978-3-319-24589-8_14",
      pdfURLs: [],
      savedAt: Date.now(),
    },
  }, { url: pageURL, tab: { id: 42 } });
  assert.equal(harness.session.data["citationMetadata-42"].doi, "10.1007/978-3-319-24589-8_14");

  const suggestion = await harness.determine({
    id: 42,
    filename: "Entertainment Computing - ICEC 2015.pdf",
    finalUrl: "https://link.springer.com/content/pdf/chapter.pdf",
    referrer: pageURL,
    mime: "application/pdf",
    tabId: 42,
  });
  assert.equal(crossrefCalls, 1);
  assert.deepEqual({ ...suggestion }, {
    filename: "Chetprayoon Panumate et al. (2015) - Evolutionary Changes of Pokemon Game- A Case Study with Focus On Catching Pokemon.pdf",
    conflictAction: "uniquify",
  });
  assert.equal(harness.analysisCalls.length, 0);
});

test("Airiti article metadata names a JavaScript-initiated PDF download", async () => {
  const pageURL = "https://www.airitilibrary.com/Article/Detail/P20170603003-N202311030006-00003";
  const harness = createBackgroundHarness({
    async fetchHandler(url) {
      assert.match(url, /10.53106%2F102887082023096903003/u);
      return {
        ok: true,
        async json() {
          return { message: {
            title: ["資優班生的系統性壓力：落後者觀點"],
            author: [
              { given: "玟秀", family: "吳" },
              { given: "正宜", family: "曾" },
            ],
            published: { "date-parts": [[2023]] },
          } };
        },
      };
    },
  });
  await harness.onMessage.emit({
    type: "citation-page-metadata",
    metadata: {
      title: "資優班生的系統性壓力：落後者觀點",
      author: "吳玟秀 & 曾正宜",
      year: "2023",
      doi: "10.53106/102887082023096903003",
      pageURL,
      pdfURLs: [],
      savedAt: Date.now(),
    },
  }, { url: pageURL, tab: { id: 99 } });
  await harness.onMessage.emit({
    type: "airiti-download-intent",
    metadata: {
      title: "資優班生的系統性壓力：落後者觀點",
      author: "吳玟秀 & 曾正宜",
      year: "2023",
      doi: "10.53106/102887082023096903003",
      pageURL,
      savedAt: Date.now(),
    },
  }, { url: pageURL, tab: { id: 99 } });

  const suggestion = await harness.determine({
    id: 99,
    filename: "download.pdf",
    finalUrl: "https://www.airitilibrary.com/Article/DownloadPDF",
    mime: "application/pdf",
  });
  assert.deepEqual({ ...suggestion }, {
    filename: "吳玟秀 & 曾正宜 (2023) - 資優班生的系統性壓力：落後者觀點.pdf",
    conflictAction: "uniquify",
  });
  assert.equal(harness.analysisCalls.length, 0);
});

test("Airiti query pages capture metadata from the clicked search result", () => {
  const messages = [];
  const clickListeners = [];
  const searchResult = {
    querySelector(selector) {
      const values = {
        ".ustyle_heading_H3 a": { textContent: "中國認知領域作戰模型初探：以2020臺灣選舉為例" },
        ".sourcedate": { textContent: "(2021 / 01)" },
      };
      return values[selector] || null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, ".點擊作者");
      return [{ textContent: "沈伯洋(Puma Shen)" }];
    },
  };
  const downloadPoint = {
    closest(selector) {
      return selector === ".searchResultGroup" ? searchResult : null;
    },
  };
  const document = {
    querySelectorAll(selector) {
      if (selector === ".searchResultGroup") return [searchResult];
      assert.equal(selector, "meta[name], meta[property]");
      return [];
    },
    addEventListener(type, listener, capture) {
      assert.equal(type, "click");
      assert.equal(capture, true);
      clickListeners.push(listener);
    },
  };
  const context = vm.createContext({
    URL,
    Date,
    console,
    location: { href: "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Query?queryString=author" },
    document,
    chrome: { runtime: { sendMessage(message) { messages.push(message); } } },
  });
  loadScript(context, "citation.js");
  context.CiteNameCitation.metadataFromDocument = () => ({
    title: "搜尋結果頁共用標題",
    author: "",
    year: "2026",
    pdfURLs: [],
  });
  loadScript(context, "citation-content.js");

  assert.equal(clickListeners.length, 1);
  clickListeners[0]({
    target: {
      closest(selector) {
        return selector === ".downloadPoint, .tool_downloadPoint" ? downloadPoint : null;
      },
    },
  });
  // Airiti opens a confirmation dialog after the result-level click. Its
  // Yes button is another .downloadPoint outside the selected result and
  // must not replace that result's metadata with page-level metadata.
  clickListeners[0]({
    target: {
      closest(selector) {
        return selector === ".downloadPoint, .tool_downloadPoint"
          ? { closest() { return null; } }
          : null;
      },
    },
  });
  const intent = messages.find((message) => message.type === "airiti-download-intent");
  assert.equal(messages.filter((message) => message.type === "airiti-search-results-metadata").length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(intent)), {
    type: "airiti-download-intent",
    metadata: {
      title: "中國認知領域作戰模型初探：以2020臺灣選舉為例",
      author: "沈伯洋",
      year: "2021",
      pdfURLs: [],
      pageURL: "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Query?queryString=author",
      doi: "",
      savedAt: intent.metadata.savedAt,
    },
  });
});

test("Airiti query pages capture clicks on the outer download wrapper", () => {
  const messages = [];
  let clickListener;
  const searchResult = {
    querySelector(selector) {
      return {
        ".ustyle_heading_H3 a": { textContent: "中國的境外制裁與長臂管轄：意義、效力與法理建構" },
        ".sourcedate": { textContent: "(2025 / 12)" },
      }[selector] || null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, ".點擊作者");
      return [{ textContent: "游智偉(Yu, Chih-Wei)" }];
    },
  };
  const outerDownloadWrapper = {
    closest(selector) {
      return selector === ".searchResultGroup" ? searchResult : null;
    },
  };
  const document = {
    querySelectorAll(selector) {
      return selector === ".searchResultGroup" ? [searchResult] : [];
    },
    addEventListener(_type, listener) { clickListener = listener; },
  };
  const context = vm.createContext({
    URL,
    Date,
    console,
    location: { href: "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Query?queryString=author" },
    document,
    chrome: { runtime: { sendMessage(message) { messages.push(message); } } },
  });
  loadScript(context, "citation.js");
  loadScript(context, "citation-content.js");

  clickListener({
    target: {
      closest(selector) {
        return selector === ".downloadPoint, .tool_downloadPoint"
          ? outerDownloadWrapper
          : null;
      },
    },
  });

  const intent = messages.find((message) => message.type === "airiti-download-intent");
  assert.equal(intent.metadata.title, "中國的境外制裁與長臂管轄：意義、效力與法理建構");
  assert.equal(intent.metadata.author, "游智偉");
  assert.equal(intent.metadata.year, "2025");
});

test("Airiti query snapshots match the original downloaded title when click intent is unavailable", async () => {
  const pageURL = "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Query?queryString=author";
  const harness = createBackgroundHarness();
  await harness.onMessage.emit({
    type: "airiti-search-results-metadata",
    pageURL,
    savedAt: Date.now(),
    results: [{
      title: "可教化量刑與矯治之探討",
      author: "李錫棟",
      year: "2022",
      pdfURLs: [],
    }],
  }, { url: pageURL, tab: { id: 101 } });

  const suggestion = await harness.determine({
    id: 107,
    filename: "可教化量刑與矯治之探討.pdf",
    finalUrl: "blob:https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/31b5fa52-8158-4cbb-90ba-287d82640a55",
    mime: "application/pdf",
    tabId: -1,
  });
  assert.deepEqual({ ...suggestion }, {
    filename: "李錫棟 (2022) - 可教化量刑與矯治之探討.pdf",
    conflictAction: "uniquify",
  });
  assert.equal(harness.analysisCalls.length, 0);
});

test("Airiti library proxy downloads use the article metadata", async () => {
  const pageURL = "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Detail/P20200101001-202609180001-00001";
  const harness = createBackgroundHarness();
  await harness.onMessage.emit({
    type: "airiti-download-intent",
    metadata: {
      title: "中國認知領域作戰模型初探：以2020臺灣選舉為例",
      author: "沈伯洋",
      year: "2026",
      pageURL,
      pdfURLs: [],
      savedAt: Date.now(),
    },
  }, { url: pageURL, tab: { id: 100 } });

  const suggestion = await harness.determine({
    id: 101,
    filename: "download.pdf",
    // The proxy sends the actual file through a separate download host.
    finalUrl: "https://download.nthulib-oc.nthu.edu.tw/files/article.pdf",
    mime: "application/pdf",
    tabId: 100,
  });
  assert.deepEqual({ ...suggestion }, {
    filename: "沈伯洋 (2026) - 中國認知領域作戰模型初探：以2020臺灣選舉為例.pdf",
    conflictAction: "uniquify",
  });
  assert.equal(harness.analysisCalls.length, 0);
});

test("Airiti blob downloads retain article metadata after session state is lost", async () => {
  const pageURL = "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Detail?DocID=a0000015-N202605260011-00001";
  const harness = createBackgroundHarness();
  await harness.onMessage.emit({
    type: "citation-page-metadata",
    metadata: {
      title: "我們需要的臺北市長人選剖析",
      author: "",
      year: "2026",
      pageURL,
      pdfURLs: [],
      savedAt: Date.now(),
    },
  }, { url: pageURL, tab: { id: 100 } });

  delete harness.session.data.airitiActiveMetadata;
  delete harness.session.data["citationMetadata-100"];

  const suggestion = await harness.determine({
    id: 105,
    filename: "我們需要的臺北市長人選剖析.pdf",
    finalUrl: "blob:https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/7ad1b3a0-bd67-4381-8575-f5689a5e0b79",
    mime: "application/pdf",
  });
  assert.deepEqual({ ...suggestion }, {
    filename: "(2026) - 我們需要的臺北市長人選剖析.pdf",
    conflictAction: "uniquify",
  });
  assert.equal(harness.analysisCalls.length, 0);
});

test("Airiti query-page download intent names the proxy PDF", async () => {
  const pageURL = "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Query?queryString=author";
  const harness = createBackgroundHarness();
  const staleMetadata = {
    title: "上一個詳目頁標題",
    author: "上一位作者",
    year: "2025",
    pageURL: "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Detail?DocID=old",
    savedAt: Date.now(),
  };
  harness.session.data.airitiActiveMetadata = staleMetadata;
  harness.local.data.airitiActiveMetadata = staleMetadata;
  await harness.onMessage.emit({
    type: "airiti-download-intent",
    metadata: {
      title: "中國認知領域作戰模型初探：以2020臺灣選舉為例",
      author: "沈伯洋",
      year: "2021",
      pageURL,
      pdfURLs: [],
      savedAt: Date.now(),
    },
  }, { url: pageURL, tab: { id: 100 } });
  assert.equal(harness.session.data.airitiActiveMetadata, undefined);
  assert.equal(harness.local.data.airitiActiveMetadata, undefined);

  const suggestion = await harness.determine({
    id: 102,
    filename: "FI-01沈伯洋.tpf.pdf",
    finalUrl: "https://download.nthulib-oc.nthu.edu.tw/files/article.pdf",
    mime: "application/pdf",
    tabId: 100,
  });
  assert.deepEqual({ ...suggestion }, {
    filename: "沈伯洋 (2021) - 中國認知領域作戰模型初探：以2020臺灣選舉為例.pdf",
    conflictAction: "uniquify",
  });
  assert.equal(harness.analysisCalls.length, 0);
});

test("Airiti query-page intent survives repeated detached proxy downloads", async () => {
  const pageURL = "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Query?queryString=author";
  const harness = createBackgroundHarness();
  await harness.onMessage.emit({
    type: "airiti-download-intent",
    metadata: {
      title: "中國認知領域作戰模型初探：以2020臺灣選舉為例",
      author: "沈伯洋",
      year: "2021",
      pageURL,
      savedAt: Date.now(),
    },
  }, { url: pageURL, tab: { id: 100 } });

  const suggestion = await harness.determine({
    id: 103,
    filename: "FI-01沈伯洋.tpf.pdf",
    finalUrl: "https://download.nthulib-oc.nthu.edu.tw/files/article.pdf",
    mime: "application/pdf",
    tabId: -1,
  });
  assert.deepEqual({ ...suggestion }, {
    filename: "沈伯洋 (2021) - 中國認知領域作戰模型初探：以2020臺灣選舉為例.pdf",
    conflictAction: "uniquify",
  });
  const repeatedSuggestion = await harness.determine({
    id: 106,
    filename: "FI-01沈伯洋.tpf.pdf",
    finalUrl: "https://download.nthulib-oc.nthu.edu.tw/files/article.pdf",
    mime: "application/pdf",
    tabId: -1,
  });
  assert.deepEqual({ ...repeatedSuggestion }, {
    filename: "沈伯洋 (2021) - 中國認知領域作戰模型初探：以2020臺灣選舉為例.pdf",
    conflictAction: "uniquify",
  });
  assert.equal(harness.session.data.airitiPendingMetadata.title, "中國認知領域作戰模型初探：以2020臺灣選舉為例");
  assert.equal(harness.analysisCalls.length, 0);
});

test("Airiti query-page intent names a detached blob download", async () => {
  const pageURL = "https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/Article/Query?queryString=author";
  const harness = createBackgroundHarness();
  await harness.onMessage.emit({
    type: "airiti-download-intent",
    metadata: {
      title: "中國認知領域作戰模型初探：以2020臺灣選舉為例",
      author: "沈伯洋",
      year: "2021",
      pageURL,
      savedAt: Date.now(),
    },
  }, { url: pageURL, tab: { id: 100 } });

  const suggestion = await harness.determine({
    id: 104,
    filename: "中國認知領域作戰模型初探：以2020臺灣選舉為例.pdf",
    finalUrl: "blob:https://www-airitilibrary-com.nthulib-oc.nthu.edu.tw/26bd6f30-80b6-4a01-b37a-4adfeafc8932",
    mime: "application/pdf",
    tabId: -1,
  });
  assert.deepEqual({ ...suggestion }, {
    filename: "沈伯洋 (2021) - 中國認知領域作戰模型初探：以2020臺灣選舉為例.pdf",
    conflictAction: "uniquify",
  });
  assert.equal(harness.session.data.airitiPendingMetadata.title, "中國認知領域作戰模型初探：以2020臺灣選舉為例");
  assert.equal(harness.analysisCalls.length, 0);
});

test("Airiti download intent does not rename a PDF from another site", async () => {
  const harness = createBackgroundHarness();
  await harness.onMessage.emit({
    type: "airiti-download-intent",
    metadata: {
      title: "資優班生的系統性壓力：落後者觀點",
      author: "吳玟秀 & 曾正宜",
      year: "2023",
      pageURL: "https://www.airitilibrary.com/Article/Detail/P20170603003-N202311030006-00003",
      savedAt: Date.now(),
    },
  }, { tab: { id: 99 } });

  const suggestion = await harness.determine({
    id: 100,
    filename: "mit-paper.pdf",
    finalUrl: "https://dspace.mit.edu/bitstreams/example/download",
    mime: "application/pdf",
  });
  assert.equal(suggestion, undefined);
  assert.equal(harness.analysisCalls.length, 1);
});

test("a failed in-extension analysis preserves the original filename", async () => {
  const harness = createBackgroundHarness({
    analysisHandler: () => ({ ok: false, error: "網站拒絕讀取 PDF" }),
  });
  const download = {
    id: 5,
    filename: "/Downloads/fulltext.pdf",
    finalUrl: "https://example.org/fulltext.pdf",
    mime: "application/pdf",
  };
  assert.equal(await harness.determine(download), undefined);
  await harness.complete(download);
  assert.equal(harness.analysisCalls.length, 1);
  assert.equal(harness.notifications.at(-1).title, "PDF 維持原檔名");
  assert.equal(harness.notifications.at(-1).message, "網站拒絕讀取 PDF");
});

test("PDF analysis timeout preserves the download", async () => {
  const timeoutHarness = createBackgroundHarness({
    analysisHandler: () => new Promise(() => {}),
  });
  const download = {
    id: 11,
    filename: "timeout.pdf",
    finalUrl: "https://example.org/timeout.pdf",
    mime: "application/pdf",
  };
  assert.equal(await timeoutHarness.determine(download), undefined);
  await timeoutHarness.complete({ ...download, filename: "/Downloads/timeout.pdf" });
  assert.equal(timeoutHarness.notifications.at(-1).title, "PDF 維持原檔名");
  assert.match(timeoutHarness.notifications.at(-1).message, /分析逾時/);
});

test("disabled mode and non-PDF downloads do not start PDF analysis", async () => {
  const disabled = createBackgroundHarness({ settings: { enabled: false, citationFormat: true } });
  assert.equal(await disabled.determine({
    id: 7,
    filename: "paper.pdf",
    finalUrl: "https://example.org/paper.pdf",
    mime: "application/pdf",
  }), undefined);
  await disabled.complete({
    id: 7,
    filename: "/Downloads/paper.pdf",
    finalUrl: "https://example.org/paper.pdf",
    mime: "application/pdf",
  });
  assert.equal(disabled.analysisCalls.length, 0);

  const nonPDF = createBackgroundHarness();
  assert.equal(await nonPDF.determine({
    id: 8,
    filename: "notes.txt",
    finalUrl: "https://example.org/notes.txt",
    mime: "text/plain",
  }), undefined);
  assert.equal(nonPDF.analysisCalls.length, 0);
});

test("in-progress download changes are ignored", async () => {
  const harness = createBackgroundHarness();
  await harness.onChanged.emit({ id: 13, state: { current: "in_progress" } });
  assert.equal(harness.analysisCalls.length, 0);
  assert.equal(harness.notifications.length, 0);
});
