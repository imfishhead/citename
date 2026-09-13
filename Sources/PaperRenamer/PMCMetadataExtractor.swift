import AppKit
import Foundation

struct PMCArticleMetadata: Equatable {
    let title: String
    let author: String
    let year: String
}

enum PMCMetadataExtractor {
    static func articleURL(from url: URL) -> URL? {
        guard url.host?.lowercased() == "pmc.ncbi.nlm.nih.gov" else { return nil }

        let components = url.pathComponents
        guard let articlesIndex = components.firstIndex(of: "articles"),
              components.indices.contains(articlesIndex + 1) else { return nil }

        let pmcid = components[articlesIndex + 1]
        guard pmcid.range(of: #"(?i)^PMC\d+$"#, options: .regularExpression) != nil else {
            return nil
        }
        return URL(string: "https://pmc.ncbi.nlm.nih.gov/articles/\(pmcid)/")
    }

    static func extract(fromHTML html: String) -> PMCArticleMetadata? {
        let metadata = citationMetadata(in: html)
        guard let rawTitle = metadata["citation_title"]?.first else { return nil }

        let title = clean(decodeHTMLEntities(rawTitle))
        guard title.count >= 8 else { return nil }

        let authors = (metadata["citation_author"] ?? [])
            .map { clean(decodeHTMLEntities($0)) }
            .filter { !$0.isEmpty }
        let author: String
        if let first = authors.first {
            author = authors.count > 2 ? "\(normalizedAuthor(first)) et al." :
                authors.map(normalizedAuthor).joined(separator: " & ")
        } else {
            author = ""
        }

        let rawDate = metadata["citation_publication_date"]?.first ??
            metadata["citation_date"]?.first ?? ""
        let year = rawDate.range(of: #"(?:19|20)\d{2}"#, options: .regularExpression)
            .map { String(rawDate[$0]) } ?? ""

        return PMCArticleMetadata(title: title, author: author, year: year)
    }

    private static func citationMetadata(in html: String) -> [String: [String]] {
        guard let tagExpression = try? NSRegularExpression(
            pattern: #"(?is)<meta\b[^>]*>"#
        ), let attributeExpression = try? NSRegularExpression(
            pattern: #"(?is)([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*([\"'])(.*?)\2"#
        ) else { return [:] }

        var result: [String: [String]] = [:]
        let htmlRange = NSRange(html.startIndex..., in: html)
        for tagMatch in tagExpression.matches(in: html, range: htmlRange) {
            guard let tagRange = Range(tagMatch.range, in: html) else { continue }
            let tag = String(html[tagRange])
            let range = NSRange(tag.startIndex..., in: tag)
            var attributes: [String: String] = [:]

            for match in attributeExpression.matches(in: tag, range: range) {
                guard let nameRange = Range(match.range(at: 1), in: tag),
                      let valueRange = Range(match.range(at: 3), in: tag) else { continue }
                attributes[String(tag[nameRange]).lowercased()] = String(tag[valueRange])
            }

            guard let name = (attributes["name"] ?? attributes["property"])?.lowercased(),
                  name.hasPrefix("citation_"), let content = attributes["content"] else { continue }
            result[name, default: []].append(content)
        }
        return result
    }

    private static func normalizedAuthor(_ raw: String) -> String {
        let parts = raw.split(separator: ",", maxSplits: 1).map { clean(String($0)) }
        if parts.count == 2, !parts[1].isEmpty {
            return "\(parts[1]) \(parts[0])"
        }
        return clean(raw)
    }

    private static func decodeHTMLEntities(_ raw: String) -> String {
        guard let data = raw.data(using: .utf8),
              let decoded = try? NSAttributedString(
                data: data,
                options: [.documentType: NSAttributedString.DocumentType.html,
                          .characterEncoding: String.Encoding.utf8.rawValue],
                documentAttributes: nil
              ).string else { return raw }
        return decoded
    }

    private static func clean(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
