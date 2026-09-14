const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const projectRoot = path.resolve(__dirname, "../..");
require(path.join(projectRoot, "ChromeExtension/citation.js"));
require(path.join(projectRoot, "ChromeExtension/pdf-analyzer.js"));

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
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

test("PDF.js extracts a citation filename entirely inside the extension", async () => {
  const pdfjsURL = pathToFileURL(path.join(projectRoot, "node_modules/pdfjs-dist/legacy/build/pdf.mjs"));
  const pdfjsLib = await import(pdfjsURL.href);
  const metadata = await globalThis.CiteNamePDF.analyzeData(
    pdfjsLib,
    createPDF({
      title: "The Education of a Computer",
      author: "Grace Hopper",
      year: "1952",
    }),
    {
      sourceFilename: "opaque-download.pdf",
      verbosity: 0,
    }
  );

  assert.deepEqual(metadata, {
    title: "The Education of a Computer",
    author: "Grace Hopper",
    year: "1952",
  });
  assert.equal(
    globalThis.CiteNameCitation.filename(metadata, true),
    "Grace Hopper (1952) - The Education of a Computer.pdf"
  );
});

test("citation metadata produces a title-only filename when author or year is absent", () => {
  assert.equal(
    globalThis.CiteNameCitation.filename({ title: "A Reliable Paper Title", author: "", year: "" }, true),
    "A Reliable Paper Title.pdf"
  );
});

test("internal PostScript source paths in PDF metadata fall back to the page title", async () => {
  const fakeDocument = {
    async getMetadata() {
      return { info: { Title: "K:\\\\SagePub\\\\paper.ps.pdf", Author: "JBranch", CreationDate: "D:20000101000000Z" } };
    },
    async getPage() {
      return {
        async getTextContent() {
          return { items: [
            { str: "Do Messages About Health Risks Threaten", height: 20, transform: [20, 0, 0, 20, 0, 600], hasEOL: true },
            { str: "the Self? Increasing the Acceptance of", height: 20, transform: [20, 0, 0, 20, 0, 576], hasEOL: true },
            { str: "Threatening Health Messages Via Self-Affirmation", height: 20, transform: [20, 0, 0, 20, 0, 552], hasEOL: true },
            { str: "David A. K. Sherman", height: 10, transform: [10, 0, 0, 10, 0, 520], hasEOL: true },
            { str: "Abstract", height: 10, transform: [10, 0, 0, 10, 0, 480], hasEOL: true },
          ] };
        },
      };
    },
  };
  const metadata = await globalThis.CiteNamePDF.analyzeDocument(fakeDocument, "s26p9b_3.ps.pdf");
  assert.equal(metadata.title, "Do Messages About Health Risks Threaten the Self? Increasing the Acceptance of Threatening Health Messages Via Self-Affirmation");
  assert.equal(metadata.author, "David A. K. Sherman");
});

test("PMC article metadata is converted into a complete citation", () => {
  const tags = [
    ["citation_title", "Can high quality listening predict lower speakers' prejudiced attitudes?"],
    ["citation_author", "Itzchakov, Guy"],
    ["citation_author", "Reis, Harry T."],
    ["citation_author", "Weinstein, Netta"],
    ["citation_publication_date", "2020/08/06"],
    ["citation_pdf_url", "/articles/PMC7409873/pdf/main.pdf"],
  ].map(([name, content]) => ({
    getAttribute(attribute) {
      if (attribute === "name") return name;
      if (attribute === "content") return content;
      return null;
    },
  }));
  const metadata = globalThis.CiteNameCitation.metadataFromDocument({
    querySelectorAll() { return tags; },
  });

  assert.deepEqual(metadata, {
    title: "Can high quality listening predict lower speakers' prejudiced attitudes?",
    author: "Guy Itzchakov et al.",
    year: "2020",
    pdfURLs: ["/articles/PMC7409873/pdf/main.pdf"],
  });
  assert.equal(
    globalThis.CiteNameCitation.articleURLForPMC(
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC7409873/pdf/main.pdf"
    ),
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC7409873/"
  );
});

test("PMC HTML metadata can be parsed without a DOM", () => {
  const metadata = globalThis.CiteNameCitation.metadataFromHTML(`
    <meta name="citation_title" content="Can high quality listening predict lower speakers&#x27; prejudiced attitudes?">
    <meta name="citation_author" content="Guy Itzchakov">
    <meta name="citation_author" content="Netta Weinstein">
    <meta name="citation_publication_date" content="2020 Aug 6">
  `);
  assert.deepEqual(metadata, {
    title: "Can high quality listening predict lower speakers' prejudiced attitudes?",
    author: "Guy Itzchakov & Netta Weinstein",
    year: "2020",
    pdfURLs: [],
  });
});

test("download filenames replace characters rejected by Chrome", () => {
  assert.equal(
    globalThis.CiteNameCitation.filename({
      title: "Can high quality listening predict lower speakers' prejudiced attitudes?",
      author: "Guy Itzchakov et al.",
      year: "2020",
    }),
    "Guy Itzchakov et al. (2020) - Can high quality listening predict lower speakers' prejudiced attitudes-.pdf"
  );
});

test("DSpace item metadata takes priority over a PDF working filename", () => {
  const metadata = globalThis.CiteNameCitation.metadataFromDSpaceItem({
    metadata: {
      "dc.title": [{ value: "The power of being heard: The benefits of perspective-giving in the context of intergroup conflict" }],
      "dc.contributor.author": [{ value: "Bruneau, Emile G." }, { value: "Saxe, Rebecca R." }],
      "dc.date.issued": [{ value: "2012-03" }],
    },
  });
  assert.deepEqual(metadata, {
    title: "The power of being heard: The benefits of perspective-giving in the context of intergroup conflict",
    author: "Emile G. Bruneau & Rebecca R. Saxe",
    year: "2012",
    pdfURLs: [],
  });
  assert.equal(
    globalThis.CiteNameCitation.dspaceItemURL(
      "https://dspace.mit.edu/entities/publication/8fcf0702-037d-4597-846d-d562a664b5f5"
    ),
    "https://dspace.mit.edu/server/api/core/items/8fcf0702-037d-4597-846d-d562a664b5f5"
  );
});

test("DOI URLs use Crossref metadata before reading the PDF", () => {
  assert.equal(
    globalThis.CiteNameCitation.doiFromURL(
      "https://onlinelibrary.wiley.com/doi/epdf/10.1111/j.1745-9125.2012.00289.x"
    ),
    "10.1111/j.1745-9125.2012.00289.x"
  );
  const metadata = globalThis.CiteNameCitation.metadataFromCrossrefWork({
    title: ["Shaping Citizen Perceptions of Police Legitimacy: A Randomized Field Trial of Procedural Justice"],
    author: [
      { given: "Lorraine", family: "Mazerolle" },
      { given: "Emma", family: "Antrobus" },
      { given: "Sarah", family: "Bennett" },
      { given: "Tom R.", family: "Tyler" },
    ],
    published: { "date-parts": [[2013, 2, 1]] },
  });
  assert.equal(
    globalThis.CiteNameCitation.filename(metadata),
    "Lorraine Mazerolle et al. (2013) - Shaping Citizen Perceptions of Police Legitimacy- A Randomized Field Trial of Procedural Justice.pdf"
  );
});
