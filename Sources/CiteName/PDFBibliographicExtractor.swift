import Foundation
import PDFKit

struct PDFBibliographicDetails: Equatable {
    var author: String
    var year: String
}

enum PDFBibliographicExtractor {
    private static let affiliationWords = [
        "university", "college", "institute", "department", "school of",
        "faculty", "hospital", "laboratory", "centre", "center", "academy"
    ]

    static func extract(from url: URL, title: String) -> PDFBibliographicDetails {
        guard let document = PDFDocument(url: url) else {
            return PDFBibliographicDetails(author: "", year: "")
        }

        let attributes = document.documentAttributes ?? [:]
        let metadataAuthor = attributes[PDFDocumentAttribute.authorAttribute] as? String
        let author = formattedAuthors(from: metadataAuthor) ??
            authorsFromFirstPage(document.page(at: 0)?.string ?? "", title: title)
        let year = publicationYear(
            firstPageText: document.page(at: 0)?.string ?? "",
            creationDate: attributes[PDFDocumentAttribute.creationDateAttribute] as? Date
        )

        return PDFBibliographicDetails(author: author ?? "", year: year ?? "")
    }

    static func filename(author: String, year: String, title: String) -> String {
        let prefix = "\(author.trimmingCharacters(in: .whitespacesAndNewlines)) (\(year.trimmingCharacters(in: .whitespacesAndNewlines)))"
        return FilenameSanitizer.sanitize("\(prefix) - \(title)") + ".pdf"
    }

    static func shouldUseCitationFormat(forTitle title: String) -> Bool {
        let normalized = title.lowercased()
        let nonAcademicDocumentTerms = [
            "導覽手冊", "旅遊手冊", "使用手冊", "操作手冊", "活動手冊",
            "路線圖", "導覽地圖", "visitor guide", "travel guide", "user manual"
        ]
        return !nonAcademicDocumentTerms.contains(where: normalized.contains)
    }

    static func formattedAuthors(from raw: String?) -> String? {
        guard let raw else { return nil }
        let cleaned = clean(raw)
        let rejectedMetadataAuthors = [
            "pc", "user", "admin", "administrator", "author", "unknown",
            "microsoft word", "microsoft office", "acrobat", "research trends",
            "core issues", "learning sciences"
        ]
        guard !cleaned.isEmpty,
              !rejectedMetadataAuthors.contains(where: cleaned.lowercased().contains) else { return nil }

        let names = cleaned
            .replacingOccurrences(of: #"\s+(?:and|&)\s+"#, with: ";", options: [.regularExpression, .caseInsensitive])
            .components(separatedBy: ";")
            .map(clean)
            .filter { !$0.isEmpty }

        return formattedAuthorList(names)
    }

    static func publicationYear(firstPageText: String, creationDate: Date?) -> String? {
        let patterns = [
            #"(?i)(?:©|copyright|published|publication)\D{0,30}((?:19|20)\d{2})"#,
            #"(?i)arxiv:.{0,80}((?:19|20)\d{2})"#,
            #"(?m)^\s*((?:19|20)\d{2})\s*$"#
        ]

        for pattern in patterns {
            if let range = firstPageText.range(of: pattern, options: .regularExpression) {
                let match = String(firstPageText[range])
                if let yearRange = match.range(of: #"(?:19|20)\d{2}"#, options: .regularExpression) {
                    return String(match[yearRange])
                }
            }
        }

        guard let creationDate else { return nil }
        let year = Calendar(identifier: .gregorian).component(.year, from: creationDate)
        return (1900...2100).contains(year) ? String(year) : nil
    }

    private static func authorsFromFirstPage(_ text: String, title: String) -> String? {
        let lines = text
            .components(separatedBy: .newlines)
            .prefix(50)
            .map(clean)
            .filter { !$0.isEmpty }

        guard let titleIndex = lines.firstIndex(where: {
            $0.caseInsensitiveCompare(title) == .orderedSame || title.localizedCaseInsensitiveContains($0)
        }) else { return nil }

        var names: [String] = []
        for line in lines.dropFirst(titleIndex + 1).prefix(12) {
            let lower = line.lowercased()
            if !names.isEmpty && (line == line.uppercased() || lower == "abstract" || lower == "摘要") {
                break
            }
            guard looksLikePersonName(line) else { continue }
            names.append(line)
        }

        return formattedAuthorList(names)
    }

    private static func looksLikePersonName(_ line: String) -> Bool {
        let lower = line.lowercased()
        let titlePhrases = ["research trends", "learning sciences", "core issues"]
        guard !titlePhrases.contains(where: lower.contains) else { return false }
        guard !affiliationWords.contains(where: lower.contains) else { return false }
        guard !lower.contains("@"), !lower.contains("http"), !line.contains(":") else { return false }
        guard line.count >= 3, line.count <= 100 else { return false }
        guard line.rangeOfCharacter(from: .letters) != nil else { return false }

        let words = line.split(separator: " ")
        let isCJKName = line.unicodeScalars.contains { scalar in
            (0x3400...0x9FFF).contains(Int(scalar.value))
        }
        guard isCJKName || (2...8).contains(words.count) else { return false }
        guard !line.contains(".") || words.count <= 6 else { return false }
        return true
    }

    private static func formattedAuthorList(_ names: [String]) -> String? {
        let formatted = names.map(normalizedName).filter { !$0.isEmpty }
        guard let first = formatted.first else { return nil }
        switch formatted.count {
        case 1: return first
        case 2: return "\(first) & \(formatted[1])"
        default: return "\(first) et al."
        }
    }

    private static func normalizedName(_ raw: String) -> String {
        let name = clean(raw)
            .trimmingCharacters(in: CharacterSet(charactersIn: ", "))

        if let chineseName = chineseName(in: name) { return chineseName }

        let commaParts = name.split(separator: ",", maxSplits: 1).map { clean(String($0)) }
        if commaParts.count == 2, !commaParts[1].isEmpty {
            return "\(commaParts[1]) \(commaParts[0])"
        }
        return name
    }

    private static func chineseName(in text: String) -> String? {
        var current = ""
        for character in text {
            let isCJK = character.unicodeScalars.allSatisfy {
                (0x3400...0x9FFF).contains(Int($0.value))
            }
            if isCJK {
                current.append(character)
            } else if current.count >= 2 {
                return current
            } else {
                current = ""
            }
        }
        return current.count >= 2 ? current : nil
    }

    private static func clean(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
