const assert = require("node:assert/strict");

global.sanitizeDownloadBaseName = (raw) => String(raw)
  .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
  .replace(/\s+/g, " ")
  .trim();

const {
  extractTPLSysId,
  preferredTPLTitle,
  gregorianYearFromTPL,
  normalizeTPLMetadata,
  tplFilename,
} = require("../../ChromeExtension/tpl.js");

const detailURL = "https://tpl.ncl.edu.tw/NclService/JournalContentDetail?SysId=A99032746";
assert.equal(extractTPLSysId(detailURL), "A99032746");
assert.equal(extractTPLSysId("https://example.com/?SysId=A99032746"), null);
assert.equal(gregorianYearFromTPL("44:1/2 民88.10"), "1999");
assert.equal(gregorianYearFromTPL("2024 年 6 月"), "2024");
assert.equal(
  preferredTPLTitle("網路科技支援之電腦教學軟體對學生學習科學概念的影響=The Impacts on Science Learning"),
  "網路科技支援之電腦教學軟體對學生學習科學概念的影響"
);

const metadata = normalizeTPLMetadata({
  author: "許瑛玿;",
  title: "網路科技支援之電腦教學軟體對學生學習科學概念的影響=The Impacts on Science Learning",
  year: "44:1/2 民88.10",
  sysId: "A99032746",
  savedAt: 1,
});
assert.equal(
  tplFilename(metadata, true),
  "許瑛玿 (1999) - 網路科技支援之電腦教學軟體對學生學習科學概念的影響.pdf"
);
assert.equal(tplFilename(metadata, false), "許瑛玿 - 網路科技支援之電腦教學軟體對學生學習科學概念的影響.pdf");

console.log("TPL journal filename tests passed");
