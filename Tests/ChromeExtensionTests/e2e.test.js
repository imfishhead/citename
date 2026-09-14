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
