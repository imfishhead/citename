import AppKit
import Foundation
import PDFKit

enum PDFTitleExtractor {
    private struct Line {
        let text: String
        let fontSize: CGFloat
        let index: Int
    }

    static func extract(from url: URL) -> String? {
        guard let document = PDFDocument(url: url) else { return nil }

        if let metadataTitle = document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String,
           shouldUseMetadataTitle(metadataTitle, sourceFilename: url.deletingPathExtension().lastPathComponent) {
            return preferredSingleLanguageTitle(metadataTitle)
        }

        guard let page = document.page(at: 0) else { return nil }
        if let attributed = page.attributedString,
           let title = titleFromTypography(attributed) {
            return preferredSingleLanguageTitle(title)
        }

        return titleFromPlainText(page.string ?? "").map(preferredSingleLanguageTitle)
    }

    private static func titleFromTypography(_ attributed: NSAttributedString) -> String? {
        let source = attributed.string as NSString
        var lines: [Line] = []
        var cursor = 0
        var lineNumber = 0

        while cursor < source.length && lineNumber < 60 {
            var lineStart = 0
            var lineEnd = 0
            var contentsEnd = 0
            source.getLineStart(&lineStart, end: &lineEnd, contentsEnd: &contentsEnd, for: NSRange(location: cursor, length: 0))

            let range = NSRange(location: lineStart, length: max(0, contentsEnd - lineStart))
            let text = clean(source.substring(with: range))
            if !text.isEmpty {
                var largestFont: CGFloat = 0
                if range.length > 0 {
                    attributed.enumerateAttribute(.font, in: range) { value, _, _ in
                        if let font = value as? NSFont {
                            largestFont = max(largestFont, font.pointSize)
                        }
                    }
                }
                lines.append(Line(text: text, fontSize: largestFont, index: lineNumber))
            }

            cursor = max(lineEnd, cursor + 1)
            lineNumber += 1
        }

        let cutoff = lines.firstIndex { looksLikeSectionHeading($0.text) } ?? min(lines.count, 35)
        let eligible = Array(lines.prefix(cutoff)).filter {
            isPlausibleTitle($0.text, sourceFilename: nil) && !looksLikeAuthorLine($0.text)
        }
        guard !eligible.isEmpty else { return nil }

        let largest = eligible.map(\.fontSize).max() ?? 0
        let prominent = eligible.filter { largest == 0 || $0.fontSize >= largest - 0.6 }
        guard let first = prominent.first else { return nil }

        var titleParts = [first.text]
        for line in lines where line.index > first.index && line.index - first.index <= 3 {
            let normalized = line.text.lowercased()
            if normalized == "by" || normalized.hasPrefix("by ") || looksLikeAuthorLine(line.text) {
                break
            }
            guard largest == 0 || abs(line.fontSize - first.fontSize) <= 0.6 else { break }
            titleParts.append(line.text)
        }
        let joined = titleParts.joined(separator: " ")

        return isPlausibleTitle(joined, sourceFilename: nil) ? clean(joined) : clean(first.text)
    }

    private static func titleFromPlainText(_ text: String) -> String? {
        let lines = text
            .components(separatedBy: .newlines)
            .prefix(50)
            .map(clean)
            .filter { !$0.isEmpty }

        let cutoff = lines.firstIndex(where: looksLikeSectionHeading) ?? min(lines.count, 30)
        let candidates = lines.prefix(cutoff).enumerated().filter {
            isPlausibleTitle($0.element, sourceFilename: nil) && !looksLikeAuthorLine($0.element)
        }

        return candidates.max { lhs, rhs in
            plainTextScore(lhs.element, index: lhs.offset) < plainTextScore(rhs.element, index: rhs.offset)
        }.map { clean($0.element) }
    }

    private static func plainTextScore(_ text: String, index: Int) -> Int {
        let usefulLength = min(text.count, 140)
        let earlyBonus = max(0, 25 - index * 2)
        let sentencePenalty = text.hasSuffix(".") && text.count > 120 ? 40 : 0
        return usefulLength + earlyBonus - sentencePenalty
    }

    private static func looksLikeSectionHeading(_ text: String) -> Bool {
        let normalized = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized == "abstract" || normalized.hasPrefix("abstract ") ||
            normalized == "摘要" || normalized == "introduction" ||
            normalized.hasPrefix("1. introduction") || normalized.hasPrefix("keywords")
    }

    private static func looksLikeAuthorLine(_ text: String) -> Bool {
        let lower = text.lowercased()
        if lower.contains("@") || lower.contains("university") || lower.contains("institute") ||
            lower.contains("department") || lower.contains("corresponding author") {
            return true
        }

        let commaCount = text.filter { $0 == "," }.count
        return commaCount >= 2 && text.count < 120
    }

    static func shouldUseMetadataTitle(_ raw: String, sourceFilename: String) -> Bool {
        guard isPlausibleTitle(raw, sourceFilename: sourceFilename) else { return false }

        let title = clean(raw)
        let lower = title.lowercased()
        let internalWorkflowWords = [
            "文字面", "校稿", "送印", "印刷檔", "工作檔", "完稿版",
            "proof copy", "print ready", "working file"
        ]
        if internalWorkflowWords.contains(where: lower.contains) {
            return false
        }

        let letters = title.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        let lowercaseLetters = letters.filter { CharacterSet.lowercaseLetters.contains($0) }
        let digitCount = title.filter(\.isNumber).count
        let separatorCount = title.filter { "-_.".contains($0) }.count
        let looksLikeArchiveIdentifier = title.contains("-") &&
            lowercaseLetters.isEmpty &&
            digitCount >= 3 &&
            separatorCount >= 3

        return !looksLikeArchiveIdentifier
    }

    static func preferredSingleLanguageTitle(_ raw: String) -> String {
        let title = clean(raw)
        let containsCJK = title.unicodeScalars.contains {
            (0x3400...0x9FFF).contains(Int($0.value))
        }
        guard containsCJK,
              let boundary = title.range(
                of: #"\s*[-–—/／|]\s*(?=[A-Za-z])"#,
                options: .regularExpression
              ) else { return title }

        let chineseTitle = clean(String(title[..<boundary.lowerBound]))
        let englishTitle = clean(String(title[boundary.upperBound...]))
        guard chineseTitle.count >= 8, englishTitle.count >= 8 else { return title }
        return chineseTitle
    }

    private static func isPlausibleTitle(_ raw: String, sourceFilename: String?) -> Bool {
        let title = clean(raw)
        let lower = title.lowercased()
        let rejected = ["untitled", "microsoft word", "acrobat distiller", "doi:", "http://", "https://"]

        guard title.count >= 8, title.count <= 350 else { return false }
        guard !rejected.contains(where: lower.contains) else { return false }
        guard title.rangeOfCharacter(from: .letters) != nil else { return false }
        guard !looksLikeExtractionNoise(title) else { return false }

        if let sourceFilename, lower == sourceFilename.lowercased() { return false }
        return true
    }

    private static func looksLikeExtractionNoise(_ title: String) -> Bool {
        let words = title.split(whereSeparator: \Character.isWhitespace).map(String.init)
        let isolatedLetters = words.filter {
            $0.count == 1 && $0.rangeOfCharacter(from: .letters) != nil
        }.count
        if isolatedLetters >= 3 { return true }

        guard words.count >= 4 else { return false }
        for length in 2...min(6, words.count / 2) {
            for start in 0...(words.count - length * 2) {
                let first = words[start..<(start + length)].map { $0.lowercased() }
                let second = words[(start + length)..<(start + length * 2)].map { $0.lowercased() }
                if first == second { return true }
            }
        }
        return false
    }

    private static func clean(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
