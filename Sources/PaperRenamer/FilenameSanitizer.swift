import Foundation

enum FilenameSanitizer {
    static func sanitize(_ rawTitle: String, maximumLength: Int = 180) -> String {
        let forbidden = CharacterSet(charactersIn: "/:")
            .union(.controlCharacters)

        let components = rawTitle.components(separatedBy: forbidden)
        let joined = components.joined(separator: "-")
        let collapsed = joined
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))

        let fallback = collapsed.isEmpty ? "未命名論文" : collapsed
        guard fallback.count > maximumLength else { return fallback }

        let end = fallback.index(fallback.startIndex, offsetBy: maximumLength)
        return String(fallback[..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
