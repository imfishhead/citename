import Foundation

struct PDFRenameItem: Identifiable {
    enum State: Equatable {
        case ready
        case renamed
        case failed(String)

        var label: String {
            switch self {
            case .ready: "待重新命名"
            case .renamed: "完成"
            case .failed(let message): message
            }
        }
    }

    let id = UUID()
    let originalURL: URL
    var title: String
    var author: String
    var year: String
    var state: State = .ready

    func proposedFilename(includeCitationFormat: Bool) -> String {
        if includeCitationFormat {
            return PDFBibliographicExtractor.filename(author: author, year: year, title: title)
        }
        return "\(FilenameSanitizer.sanitize(title)).pdf"
    }
}
