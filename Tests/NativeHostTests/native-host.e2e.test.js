const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const nativeHost = process.env.CITENAME_NATIVE_HOST;
assert.ok(nativeHost, "CITENAME_NATIVE_HOST is required");
assert.ok(fs.existsSync(nativeHost), `Native host not found: ${nativeHost}`);

function escapePDFString(value) {
  return value.replace(/([\\()])/g, "\\$1");
}

function createPDF({ title, author, year }) {
  const pageText = `BT /F1 18 Tf 72 720 Td (${escapePDFString(title)}) Tj 0 -30 Td /F1 12 Tf (${escapePDFString(author)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(pageText, "latin1")} >>\nstream\n${pageText}\nendstream`,
    `<< /Title (${escapePDFString(title)}) /Author (${escapePDFString(author)}) /CreationDate (D:${year}0101000000Z) >>`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function nativeRequest(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  const result = spawnSync(nativeHost, [], {
    input: Buffer.concat([header, payload]),
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.ok(result.stdout.length >= 4, "Native host returned no framed response");
  const length = result.stdout.readUInt32LE(0);
  return JSON.parse(result.stdout.subarray(4, 4 + length).toString());
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "citename-e2e-"));
try {
  const title = "The Education of a Computer";
  const author = "Grace Hopper";
  const source = path.join(temporaryRoot, "opaque-download.pdf");
  fs.writeFileSync(source, createPDF({ title, author, year: "1952" }));

  const response = nativeRequest({ action: "rename", path: source, citationFormat: true });
  assert.equal(response.ok, true);
  assert.equal(response.filename, "Grace Hopper (1952) - The Education of a Computer.pdf");
  assert.ok(fs.existsSync(response.newPath));
  assert.equal(fs.existsSync(source), false);

  const secondSource = path.join(temporaryRoot, "second-download.pdf");
  fs.writeFileSync(secondSource, createPDF({ title, author, year: "1952" }));
  const conflict = nativeRequest({ action: "rename", path: secondSource, citationFormat: true });
  assert.equal(conflict.ok, true);
  assert.equal(conflict.filename, "Grace Hopper (1952) - The Education of a Computer (2).pdf");

  const invalid = nativeRequest({ action: "rename" });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /指令不完整/);

  const plainSource = path.join(temporaryRoot, "plain-download.pdf");
  fs.writeFileSync(plainSource, createPDF({
    title: "Compiler Notes",
    author: "Ada Lovelace",
    year: "1843",
  }));
  const titleOnly = nativeRequest({
    action: "rename",
    path: plainSource,
    citationFormat: false,
  });
  assert.equal(titleOnly.ok, true);
  assert.equal(titleOnly.filename, "Compiler Notes.pdf");

  console.log("Native host end-to-end tests passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
