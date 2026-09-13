import Foundation

struct DownloadedPDF {
    let data: Data
    let suggestedFilename: String
}

enum RemotePDFDownloadError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    case fileTooLarge
    case noPDFLink
    case responseIsNotPDF

    var errorDescription: String? {
        switch self {
        case .invalidURL: "網址格式不正確"
        case .invalidResponse: "網站沒有回傳有效內容"
        case .httpError(let code): "網站回傳錯誤代碼 \(code)"
        case .fileTooLarge: "PDF 超過 100 MB，已停止下載"
        case .noPDFLink: "這個網頁找不到 PDF 下載連結"
        case .responseIsNotPDF: "下載內容不是有效的 PDF"
        }
    }
}

enum RemotePDFDownloader {
    private static let maximumBytes = 100 * 1024 * 1024

    static func fetch(from sourceURL: URL, session: URLSession = .shared) async throws -> DownloadedPDF {
        let first = try await request(sourceURL, session: session)
        if isPDF(first.data) {
            return DownloadedPDF(
                data: first.data,
                suggestedFilename: suggestedFilename(response: first.response, fallbackURL: sourceURL)
            )
        }

        guard let html = String(data: first.data, encoding: .utf8) ?? String(data: first.data, encoding: .isoLatin1),
              let pdfURL = pdfLinkCandidates(in: html, baseURL: sourceURL).first else {
            throw RemotePDFDownloadError.noPDFLink
        }

        let second = try await request(pdfURL, session: session)
        guard isPDF(second.data) else { throw RemotePDFDownloadError.responseIsNotPDF }
        return DownloadedPDF(
            data: second.data,
            suggestedFilename: suggestedFilename(response: second.response, fallbackURL: pdfURL)
        )
    }

    static func saveToDownloads(_ download: DownloadedPDF) throws -> URL {
        guard let downloadsDirectory = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first else {
            throw RemotePDFDownloadError.invalidResponse
        }

        let rawBase = download.suggestedFilename.replacingOccurrences(
            of: #"(?i)\.pdf$"#,
            with: "",
            options: .regularExpression
        )
        let base = FilenameSanitizer.sanitize(rawBase)
        var destination = downloadsDirectory.appendingPathComponent("\(base).pdf")
        var counter = 2
        while FileManager.default.fileExists(atPath: destination.path) {
            destination = downloadsDirectory.appendingPathComponent("\(base) (\(counter)).pdf")
            counter += 1
        }

        try download.data.write(to: destination, options: .atomic)
        return destination
    }

    static func isPDF(_ data: Data) -> Bool {
        data.starts(with: Data("%PDF-".utf8))
    }

    static func pdfLinkCandidates(in html: String, baseURL: URL) -> [URL] {
        let pattern = #"(?i)(?:href|src)\s*=\s*[\"']([^\"']+)[\"']"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(html.startIndex..., in: html)
        var seen = Set<URL>()

        return regex.matches(in: html, range: range).compactMap { match in
            guard let valueRange = Range(match.range(at: 1), in: html) else { return nil }
            let raw = String(html[valueRange])
                .replacingOccurrences(of: "&amp;", with: "&")
            guard let resolved = URL(string: raw, relativeTo: baseURL)?.absoluteURL else { return nil }

            let lower = resolved.absoluteString.lowercased()
            let looksDownloadable = resolved.pathExtension.lowercased() == "pdf" ||
                lower.contains("download") || lower.contains("/pdf/") || lower.contains("file")
            guard looksDownloadable, seen.insert(resolved).inserted else { return nil }
            return resolved
        }
    }

    private static func request(_ url: URL, session: URLSession) async throws -> (data: Data, response: URLResponse) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X) PaperRenamer/0.3", forHTTPHeaderField: "User-Agent")
        request.setValue("application/pdf,text/html;q=0.9,*/*;q=0.8", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RemotePDFDownloadError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw RemotePDFDownloadError.httpError(http.statusCode)
        }
        guard data.count <= maximumBytes else { throw RemotePDFDownloadError.fileTooLarge }
        return (data, response)
    }

    private static func suggestedFilename(response: URLResponse, fallbackURL: URL) -> String {
        let responseName = response.suggestedFilename?.removingPercentEncoding
        let fallbackName = fallbackURL.lastPathComponent.removingPercentEncoding
        let chosen = [responseName, fallbackName].compactMap { $0 }.first { !$0.isEmpty } ?? "download.pdf"
        return chosen.lowercased().hasSuffix(".pdf") ? chosen : "\(chosen).pdf"
    }
}
