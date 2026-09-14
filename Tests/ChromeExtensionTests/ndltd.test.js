const assert = require("node:assert/strict");
const {
  extractNDLTDSessionKey,
  preferredNDLTDName,
  normalizeNDLTDMetadata,
  ndltdFilename,
  ndltdZipFilename,
} = require("../../ChromeExtension/ndltd.js");

assert.equal(
  extractNDLTDSessionKey("https://ndltd.ncl.edu.tw/cgi-bin/gs32/gsweb.cgi/ccd=6lu5rQ/fulltextdeclare"),
  "6lu5rQ"
);
assert.equal(extractNDLTDSessionKey("https://example.com/ccd=6lu5rQ/file.zip"), null);
assert.equal(preferredNDLTDName("Yen-Jung 陳彥蓉-Chen"), "陳彥蓉");

const metadata = normalizeNDLTDMetadata({
  author: " 吳承穎 ",
  title: "高中生自主學習表現之多元樣貌",
  year: "2024",
  sessionKey: "6lu5rQ",
  savedAt: 1,
});
assert.equal(
  ndltdZipFilename(metadata, true),
  "吳承穎 (2024) - 高中生自主學習表現之多元樣貌.zip"
);
assert.equal(
  ndltdZipFilename(metadata, false),
  "高中生自主學習表現之多元樣貌.zip"
);
assert.equal(
  ndltdFilename({
    author: "陳彥蓉",
    title: "提問課程設計促進國小中年級學生提問行為之行動研究",
    year: "2025",
  }, true, "pdf"),
  "陳彥蓉 (2025) - 提問課程設計促進國小中年級學生提問行為之行動研究.pdf"
);
assert.equal(ndltdZipFilename({ title: "缺作者" }, true), null);

console.log("NDLTD filename tests passed");
