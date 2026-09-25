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

function createPDF({ title, author, year, academic = true }) {
  const academicText = academic ? " 0 -30 Td (Abstract) Tj" : "";
  const pageText = `BT /F1 18 Tf 72 720 Td (${escapePDFString(title)}) Tj 0 -30 Td /F1 12 Tf (${escapePDFString(author)}) Tj${academicText} ET`;
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

test("citation metadata uses the available citation parts when author or year is absent", () => {
  assert.equal(
    globalThis.CiteNameCitation.filename({ title: "A Reliable Paper Title", author: "", year: "" }, true),
    "A Reliable Paper Title.pdf"
  );
  assert.equal(
    globalThis.CiteNameCitation.filename({ title: "A Reliable Paper Title", author: "", year: "2026" }, true),
    "(2026) - A Reliable Paper Title.pdf"
  );
  assert.equal(
    globalThis.CiteNameCitation.filename({ title: "A Reliable Paper Title", author: "Ada Lovelace", year: "" }, true),
    "Ada Lovelace - A Reliable Paper Title.pdf"
  );
});

test("citation metadata supports each selected filename format", () => {
  const metadata = {
    author: "Ada Lovelace",
    year: "2024",
    title: "Analytical Engines",
  };
  assert.equal(globalThis.CiteNameCitation.filename(metadata, "author-year-title"), "Ada Lovelace (2024) - Analytical Engines.pdf");
  assert.equal(globalThis.CiteNameCitation.filename(metadata, "author-title"), "Ada Lovelace - Analytical Engines.pdf");
  assert.equal(globalThis.CiteNameCitation.filename(metadata, "year-title"), "(2024) - Analytical Engines.pdf");
  assert.equal(globalThis.CiteNameCitation.filename(metadata, "title"), "Analytical Engines.pdf");
});

test("a generic PDF without academic signals uses only its title", async () => {
  const pdfjsURL = pathToFileURL(path.join(projectRoot, "node_modules/pdfjs-dist/legacy/build/pdf.mjs"));
  const pdfjsLib = await import(pdfjsURL.href);
  const metadata = await globalThis.CiteNamePDF.analyzeData(
    pdfjsLib,
    createPDF({ title: "Annual Report", author: "Finance Office", year: "2024", academic: false }),
    { sourceFilename: "report.pdf", verbosity: 0 }
  );
  assert.deepEqual(metadata, { title: "Annual Report", author: "", year: "" });
  assert.equal(globalThis.CiteNameCitation.filename(metadata), "Annual Report.pdf");
});

test("an authors note identifies a journal PDF without an abstract heading", () => {
  assert.equal(
    globalThis.CiteNamePDF.hasAcademicSignals("Authors’ Note: Correspondence should be addressed to the first author."),
    true
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

test("layout-program working filenames are rejected as PDF titles", () => {
  assert.equal(globalThis.CiteNameCitation.isPlausibleTitle("社会心理出片.indd.pdf"), false);
  assert.equal(globalThis.CiteNameCitation.isPlausibleTitle("manuscript-final.docx"), false);
  assert.equal(globalThis.CiteNameCitation.isPlausibleTitle("FI-01沈伯洋.tpf"), false);
});

test("a PDF without a prominent title preserves its original filename", async () => {
  const document = {
    async getMetadata() {
      return { info: { Title: "社会心理出片.indd.pdf" } };
    },
    async getPage() {
      return {
        async getTextContent() {
          return { items: [
            { str: "社会心理学资料", height: 10, transform: [10, 0, 0, 10, 0, 700], hasEOL: true },
            { str: "第 20 页", height: 10, transform: [10, 0, 0, 10, 0, 680], hasEOL: true },
            { str: "内部使用", height: 10, transform: [10, 0, 0, 10, 0, 660], hasEOL: true },
          ] };
        },
      };
    },
  };
  assert.equal(await globalThis.CiteNamePDF.analyzeDocument(document, "20090518150216684.pdf"), null);
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

test("Europe PMC records provide a fast fallback for direct PMC PDF links", () => {
  assert.deepEqual(globalThis.CiteNameCitation.metadataFromEuropePMCRecord({
    title: "Can high quality listening predict lower speakers' prejudiced attitudes?",
    authorString: "Itzchakov G, Weinstein N, Legate N, Amar M.",
    firstPublicationDate: "2020-08-06",
  }), {
    title: "Can high quality listening predict lower speakers' prejudiced attitudes?",
    author: "G Itzchakov et al.",
    year: "2020",
    pdfURLs: [],
  });
});

test("Airiti search results provide metadata for their own download buttons", () => {
  const values = {
    ".ustyle_heading_H3 a": { textContent: "中國認知領域作戰模型初探：以2020臺灣選舉為例" },
    ".sourcedate": { textContent: "(2021 / 01)" },
  };
  const result = {
    querySelector(selector) {
      return values[selector] || null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, ".點擊作者");
      return [{ textContent: "沈伯洋(Puma Shen)" }];
    },
  };

  assert.deepEqual(globalThis.CiteNameCitation.metadataFromAiritiSearchResult(result), {
    title: "中國認知領域作戰模型初探：以2020臺灣選舉為例",
    author: "沈伯洋",
    year: "2021",
    pdfURLs: [],
  });
});

test("Airiti search results support author and date fields without legacy wrappers", () => {
  const values = {
    ".ustyle_heading_H3 a": { textContent: "可教化量刑與矯治之探討" },
    ".source": { textContent: "《玄奘法律學報》 37期 (2022 / 06) Pp. 101-134" },
  };
  const result = {
    querySelector(selector) {
      return values[selector] || null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, ".點擊作者");
      return [{ textContent: "李錫棟(Lii, Shyi-Dong)" }];
    },
  };

  assert.deepEqual(globalThis.CiteNameCitation.metadataFromAiritiSearchResult(result), {
    title: "可教化量刑與矯治之探討",
    author: "李錫棟",
    year: "2022",
    pdfURLs: [],
  });
});

test("PMC XML accepts author groups without per-author contrib-type attributes", () => {
  assert.deepEqual(globalThis.CiteNameCitation.metadataFromPMCXML(`
    <article-title>Can high quality listening predict lower speakers' prejudiced attitudes?</article-title>
    <contrib-group content-type="author">
      <contrib><name><surname>Itzchakov</surname><given-names>Guy</given-names></name></contrib>
      <contrib><name><surname>Weinstein</surname><given-names>Netta</given-names></name></contrib>
      <contrib><name><surname>Legate</surname><given-names>Nicole</given-names></name></contrib>
    </contrib-group>
    <pub-date><year>2020</year></pub-date>
  `), {
    title: "Can high quality listening predict lower speakers' prejudiced attitudes?",
    author: "Guy Itzchakov et al.",
    year: "2020",
    pdfURLs: [],
  });
});

test("Airiti citation metadata retains its DOI", () => {
  const metadata = globalThis.CiteNameCitation.metadataFromHTML(`
    <meta name="citation_title" content="資優班生的系統性壓力：落後者觀點">
    <meta name="citation_author" content="吳玟秀">
    <meta name="citation_author" content="曾正宜">
    <meta name="citation_date" content="2023/09/30">
    <meta name="citation_doi" content="10.53106/102887082023096903003">
  `);
  assert.deepEqual(metadata, {
    title: "資優班生的系統性壓力：落後者觀點",
    author: "吳玟秀 & 曾正宜",
    year: "2023",
    pdfURLs: [],
    doi: "10.53106/102887082023096903003",
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
  assert.equal(
    globalThis.CiteNameCitation.doiFromURL(
      "https://link.springer.com/content/pdf/10.1023/B:SERS.0000029102.66384.a2.pdf"
    ),
    "10.1023/B:SERS.0000029102.66384.a2"
  );
  assert.equal(
    globalThis.CiteNameCitation.kargerDOIFromURL(
      "https://karger.com/pho/article-pdf/75/3/219/3432237/000484938.pdf"
    ),
    "10.1159/000484938"
  );
  assert.equal(
    globalThis.CiteNameCitation.scienceDirectPIIFromURL(
      "https://pdf.sciencedirectassets.com/path/main.pdf?pii=S0747563217303527&X-Amz-Signature=example"
    ),
    "S0747563217303527"
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

test("a DOI printed in a PDF can be used for formal citation metadata", () => {
  assert.equal(
    globalThis.CiteNameCitation.doiFromText("DOI: 10.1177/30504554251328462"),
    "10.1177/30504554251328462"
  );
  assert.equal(
    globalThis.CiteNameCitation.doiFromText("doi: 10.1159/0004 84938"),
    "10.1159/000484938"
  );
  const metadata = globalThis.CiteNameCitation.metadataFromCrossrefWork({
    title: ["Small Targets Detection in LIDAR Point Clouds Based on Deep Learning"],
    author: [
      { given: "Zhipeng", family: "Zhai" },
      { given: "Jinju", family: "Shao" },
      { given: "Meng", family: "Zhang" },
    ],
    published: { "date-parts": [[2025, 4, 1]] },
  });
  assert.equal(
    globalThis.CiteNameCitation.filename(metadata),
    "Zhipeng Zhai et al. (2025) - Small Targets Detection in LIDAR Point Clouds Based on Deep Learning.pdf"
  );
});

test("OJS PDF URLs resolve to their article metadata page", () => {
  assert.equal(
    globalThis.CiteNameCitation.ojsArticleURL(
      "https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/22004/21782"
    ),
    "https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/22004"
  );
  const metadata = globalThis.CiteNameCitation.metadataFromHTML(`
    <meta name="citation_title" content="The New Faculty Highlights Program at AAAI-21">
    <meta name="citation_author" content="Leyton-Brown, Kevin">
    <meta name="citation_author" content="Mausam">
    <meta name="citation_author" content="Yang, Qiang">
    <meta name="citation_publication_date" content="2022-12-22">
  `);
  assert.equal(
    globalThis.CiteNameCitation.filename(metadata),
    "Kevin Leyton-Brown et al. (2022) - The New Faculty Highlights Program at AAAI-21.pdf"
  );
});
