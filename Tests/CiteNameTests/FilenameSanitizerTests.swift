import Foundation
import Testing
@testable import CiteName

@Test func removesForbiddenFilenameCharacters() {
    #expect(FilenameSanitizer.sanitize("A/B: C") == "A-B- C")
}

@Test func collapsesWhitespaceAndTrimsDots() {
    #expect(FilenameSanitizer.sanitize("  A   useful title... ") == "A useful title")
}

@Test func limitsFilenameLength() {
    let result = FilenameSanitizer.sanitize(String(repeating: "論", count: 200))
    #expect(result.count == 180)
}

@Test func rejectsMetadataThatDuplicatesFilename() {
    #expect(!PDFTitleExtractor.shouldUseMetadataTitle(
        "NAS-CBIII-05-1001-001 1..14",
        sourceFilename: "NAS-CBIII-05-1001-001 1..14"
    ))
}

@Test func rejectsArchiveIdentifierMetadata() {
    #expect(!PDFTitleExtractor.shouldUseMetadataTitle(
        "NAS-CBIII-05-1001-001",
        sourceFilename: "downloaded-copy"
    ))
}

@Test func acceptsNormalMetadataTitle() {
    #expect(PDFTitleExtractor.shouldUseMetadataTitle(
        "Social and Emotional Learning",
        sourceFilename: "downloaded-copy"
    ))
}

@Test func keepsChineseHalfOfBilingualTitle() {
    #expect(PDFTitleExtractor.preferredSingleLanguageTitle(
        "提問課程設計促進國小中年級學生提問行為之行動研究/Research on the Action of Questioning Curriculum Design"
    ) == "提問課程設計促進國小中年級學生提問行為之行動研究")
}

@Test func rejectsInternalProductionMetadataTitle() {
    #expect(!PDFTitleExtractor.shouldUseMetadataTitle(
        "大縱走文字面-0925",
        sourceFilename: "臺北大縱走"
    ))
}

@Test func rejectsRepeatedMapLayerTextAsMetadataTitle() {
    #expect(!PDFTitleExtractor.shouldUseMetadataTitle(
        "Sec.2 Xhinan Road Sec.2 Xhinan Road F o n",
        sourceFilename: "臺北大縱走"
    ))
}

@Test func doesNotUseCitationFormatForGuidebooks() {
    #expect(!PDFBibliographicExtractor.shouldUseCitationFormat(
        forTitle: "臺北大縱走導覽手冊"
    ))
    #expect(PDFBibliographicExtractor.shouldUseCitationFormat(
        forTitle: "Therapist Use of Socratic Questioning Predicts Symptom Change"
    ))
}

@Test func formatsCitationFilename() {
    #expect(PDFBibliographicExtractor.filename(
        author: "Rajab Idd Muyingo*",
        year: "2022",
        title: "Effects of Television Soaps on Students’ Academic Performance: Evidence from Uganda"
    ) == "Rajab Idd Muyingo* (2022) - Effects of Television Soaps on Students’ Academic Performance- Evidence from Uganda.pdf")
}

@Test func keepsFullNamesForTwoMetadataAuthors() {
    #expect(PDFBibliographicExtractor.formattedAuthors(from: "Joseph E. Zins; Maurice J. Elias") == "Joseph E. Zins & Maurice J. Elias")
}

@Test func rejectsGenericMetadataAuthor() {
    #expect(PDFBibliographicExtractor.formattedAuthors(from: "pc") == nil)
    #expect(PDFBibliographicExtractor.formattedAuthors(from: "Research Trends") == nil)
}

@Test func keepsChineseNameFromBilingualMetadataAuthor() {
    #expect(PDFBibliographicExtractor.formattedAuthors(
        from: "陳彥蓉/Chen, Yen-Jung"
    ) == "陳彥蓉")
}

@Test func prefersPrintedPublicationYear() {
    let fallback = Date(timeIntervalSince1970: 0)
    #expect(PDFBibliographicExtractor.publicationYear(
        firstPageText: "Copyright © 2004 by the publisher",
        creationDate: fallback
    ) == "2004")
}

@Test func recognizesArXivPublicationYear() {
    #expect(PDFBibliographicExtractor.publicationYear(
        firstPageText: "arXiv:2510.01395v1 [cs.CY] 1 Oct 2025",
        creationDate: nil
    ) == "2025")
}

@Test func recognizesPDFSignature() {
    #expect(RemotePDFDownloader.isPDF(Data("%PDF-1.7\n".utf8)))
    #expect(!RemotePDFDownloader.isPDF(Data("<html></html>".utf8)))
}

@Test func findsPDFLinkInWebPage() {
    let html = #"<a class="download" href="/files/paper.pdf?token=abc">Download</a>"#
    let links = RemotePDFDownloader.pdfLinkCandidates(
        in: html,
        baseURL: URL(string: "https://example.org/article/1")!
    )
    #expect(links.first?.absoluteString == "https://example.org/files/paper.pdf?token=abc")
}

@Test func derivesPMCArticleURLFromPDFURL() {
    let pdfURL = URL(string: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4449800/pdf/nihms687726.pdf")!
    #expect(PMCMetadataExtractor.articleURL(from: pdfURL)?.absoluteString ==
        "https://pmc.ncbi.nlm.nih.gov/articles/PMC4449800/")
}

@Test func extractsCitationMetadataFromPMCPage() {
    let html = #"""
    <meta name="citation_title" content="Therapist Use of Socratic Questioning &amp; Symptom Change">
    <meta content="Braun, Justin D" name="citation_author">
    <meta name="citation_author" content="Strunk, Daniel R">
    <meta name="citation_author" content="Sasso, Katherine E">
    <meta name="citation_publication_date" content="05/05/2015">
    """#

    #expect(PMCMetadataExtractor.extract(fromHTML: html) == PMCArticleMetadata(
        title: "Therapist Use of Socratic Questioning & Symptom Change",
        author: "Justin D Braun et al.",
        year: "2015"
    ))
}
