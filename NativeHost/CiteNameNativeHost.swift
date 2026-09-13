import Foundation

private struct NativeRequest: Decodable {
    let action: String
    let path: String?
    let url: String?
    let citationFormat: Bool?
}

private struct NativeResponse: Encodable {
    let ok: Bool
    let filename: String?
    let newPath: String?
    let error: String?
}

private enum HostError: LocalizedError {
    case invalidRequest
    case invalidPDF
    case titleNotFound
    case downloadFailed
    case fileTooLarge

    var errorDescription: String? {
        switch self {
        case .invalidRequest: return "收到的指令不完整。"
        case .invalidPDF: return "下載項目不是可讀取的 PDF。"
        case .titleNotFound: return "找不到可用的 PDF 標題。"
        case .downloadFailed: return "無法預先讀取這份 PDF。"
        case .fileTooLarge: return "PDF 超過 100 MB，改為下載完成後處理。"
        }
    }
}

private let input = FileHandle.standardInput
private let output = FileHandle.standardOutput

while let message = readMessage() {
    let response: NativeResponse
    do {
        let request = try JSONDecoder().decode(NativeRequest.self, from: message)
        response = try handle(request)
    } catch {
        response = NativeResponse(ok: false, filename: nil, newPath: nil, error: error.localizedDescription)
    }
    writeMessage(response)
}

private func handle(_ request: NativeRequest) throws -> NativeResponse {
    if request.action == "suggest" {
        return try suggestFilename(request)
    }
    guard request.action == "rename", let rawPath = request.path else {
        throw HostError.invalidRequest
    }

    let sourceURL = URL(fileURLWithPath: rawPath).standardizedFileURL
    guard sourceURL.pathExtension.lowercased() == "pdf",
          FileManager.default.isReadableFile(atPath: sourceURL.path) else {
        throw HostError.invalidPDF
    }
    guard let title = PDFTitleExtractor.extract(from: sourceURL) else {
        throw HostError.titleNotFound
    }

    let baseName = extractedBaseName(from: sourceURL, title: title, citationFormat: request.citationFormat ?? true)

    let destinationURL = availableDestination(
        directory: sourceURL.deletingLastPathComponent(),
        baseName: baseName,
        excluding: sourceURL
    )

    if destinationURL != sourceURL {
        try FileManager.default.moveItem(at: sourceURL, to: destinationURL)
    }

    return NativeResponse(
        ok: true,
        filename: destinationURL.lastPathComponent,
        newPath: destinationURL.path,
        error: nil
    )
}

private func suggestFilename(_ request: NativeRequest) throws -> NativeResponse {
    guard let rawURL = request.url,
          let sourceURL = URL(string: rawURL),
          ["http", "https"].contains(sourceURL.scheme?.lowercased() ?? "") else {
        throw HostError.downloadFailed
    }

    if let articleURL = PMCMetadataExtractor.articleURL(from: sourceURL),
       let metadata = try? fetchPMCMetadata(articleURL),
       !metadata.title.isEmpty {
        let baseName: String
        if request.citationFormat ?? true,
           !metadata.author.isEmpty,
           !metadata.year.isEmpty {
            baseName = PDFBibliographicExtractor.filename(
                author: metadata.author,
                year: metadata.year,
                title: metadata.title
            ).replacingOccurrences(of: ".pdf", with: "", options: [.anchored, .backwards])
        } else {
            baseName = FilenameSanitizer.sanitize(metadata.title)
        }
        return NativeResponse(ok: true, filename: "\(baseName).pdf", newPath: nil, error: nil)
    }

    var urlRequest = URLRequest(url: sourceURL)
    urlRequest.timeoutInterval = 18
    urlRequest.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome CiteName/1.4", forHTTPHeaderField: "User-Agent")
    urlRequest.setValue("application/pdf,*/*;q=0.8", forHTTPHeaderField: "Accept")
    let data = try download(urlRequest)
    guard data.count <= 100 * 1024 * 1024 else { throw HostError.fileTooLarge }
    guard data.starts(with: Data("%PDF-".utf8)) else { throw HostError.invalidPDF }

    let temporaryURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("CiteName-\(UUID().uuidString)")
        .appendingPathExtension("pdf")
    defer { try? FileManager.default.removeItem(at: temporaryURL) }
    try data.write(to: temporaryURL, options: .atomic)

    guard let title = PDFTitleExtractor.extract(from: temporaryURL) else {
        throw HostError.titleNotFound
    }
    let baseName = extractedBaseName(
        from: temporaryURL,
        title: title,
        citationFormat: request.citationFormat ?? true
    )
    let filename = "\(baseName).pdf"
    return NativeResponse(ok: true, filename: filename, newPath: nil, error: nil)
}

private func fetchPMCMetadata(_ url: URL) throws -> PMCArticleMetadata {
    var request = URLRequest(url: url)
    request.timeoutInterval = 8
    request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome CiteName/1.4", forHTTPHeaderField: "User-Agent")
    request.setValue("text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", forHTTPHeaderField: "Accept")
    let data = try download(request)
    guard let html = String(data: data, encoding: .utf8),
          let metadata = PMCMetadataExtractor.extract(fromHTML: html) else {
        throw HostError.titleNotFound
    }
    return metadata
}

private func download(_ request: URLRequest) throws -> Data {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<Data, Error>?
    URLSession.shared.dataTask(with: request) { data, response, error in
        defer { semaphore.signal() }
        if let error {
            result = .failure(error)
            return
        }
        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let data else {
            result = .failure(HostError.downloadFailed)
            return
        }
        result = .success(data)
    }.resume()
    semaphore.wait()
    return try result?.get() ?? { throw HostError.downloadFailed }()
}

private func extractedBaseName(from url: URL, title: String, citationFormat: Bool) -> String {
    let details = PDFBibliographicExtractor.extract(from: url, title: title)
    if citationFormat,
       PDFBibliographicExtractor.shouldUseCitationFormat(forTitle: title),
       !details.author.isEmpty,
       !details.year.isEmpty {
        return PDFBibliographicExtractor.filename(
            author: details.author,
            year: details.year,
            title: title
        ).replacingOccurrences(of: ".pdf", with: "", options: [.anchored, .backwards])
    }
    return FilenameSanitizer.sanitize(title)
}

private func availableDestination(directory: URL, baseName: String, excluding source: URL) -> URL {
    var candidate = directory.appendingPathComponent(baseName).appendingPathExtension("pdf")
    if candidate.standardizedFileURL == source.standardizedFileURL ||
        !FileManager.default.fileExists(atPath: candidate.path) {
        return candidate
    }

    var suffix = 2
    while FileManager.default.fileExists(atPath: candidate.path) {
        candidate = directory
            .appendingPathComponent("\(baseName) (\(suffix))")
            .appendingPathExtension("pdf")
        suffix += 1
    }
    return candidate
}

private func readMessage() -> Data? {
    guard let lengthData = try? input.read(upToCount: 4),
          lengthData.count == 4 else { return nil }

    let length = lengthData.withUnsafeBytes { bytes in
        UInt32(littleEndian: bytes.loadUnaligned(as: UInt32.self))
    }
    guard length > 0, length <= 1_048_576,
          let payload = try? input.read(upToCount: Int(length)),
          payload.count == Int(length) else { return nil }
    return payload
}

private func writeMessage(_ response: NativeResponse) {
    guard let payload = try? JSONEncoder().encode(response) else { return }
    var length = UInt32(payload.count).littleEndian
    let lengthData = withUnsafeBytes(of: &length) { Data($0) }
    try? output.write(contentsOf: lengthData)
    try? output.write(contentsOf: payload)
}
