import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @State private var items: [CiteNameItem] = []
    @State private var isDropTargeted = false
    @State private var isImporterPresented = false
    @State private var alertMessage: String?
    @State private var remoteURLText = ""
    @State private var isDownloading = false
    @State private var downloadMessage: String?
    @AppStorage("useCitationFilenameFormat") private var useCitationFormat = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            if items.isEmpty {
                emptyState
            } else {
                fileList
            }

            Divider()
            actionBar
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .fileImporter(
            isPresented: $isImporterPresented,
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: true,
            onCompletion: handleImport
        )
        .alert("無法處理檔案", isPresented: Binding(
            get: { alertMessage != nil },
            set: { if !$0 { alertMessage = nil } }
        )) {
            Button("好", role: .cancel) { alertMessage = nil }
        } message: {
            Text(alertMessage ?? "")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text("CiteName")
                            .font(.title2.weight(.semibold))
                        Text("0.3.0")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(.secondary.opacity(0.12), in: Capsule())
                    }
                    Text("從 PDF 找出論文標題，再安全地重新命名")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("選擇 PDF") { isImporterPresented = true }
            }

            Toggle("檔名格式：作者 (年份) - 標題", isOn: $useCitationFormat)
                .toggleStyle(.checkbox)

            HStack(spacing: 8) {
                TextField("貼上 PDF 網址或含下載按鈕的網頁網址", text: $remoteURLText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(downloadFromURL)
                Button("貼上") {
                    remoteURLText = NSPasteboard.general.string(forType: .string) ?? ""
                }
                Button {
                    downloadFromURL()
                } label: {
                    if isDownloading {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("下載並加入")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isDownloading || remoteURLText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            if let downloadMessage {
                Text(downloadMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(20)
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "arrow.down.doc")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(isDropTargeted ? Color.accentColor : .secondary)
            Text("把學術 PDF 拖到這裡")
                .font(.title3.weight(.medium))
            Text("檔案只會在這台 Mac 上處理")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(isDropTargeted ? Color.accentColor : Color.secondary.opacity(0.25), style: StrokeStyle(lineWidth: 2, dash: [8]))
                .padding(28)
        }
        .onDrop(of: [UTType.fileURL], isTargeted: $isDropTargeted, perform: handleDrop)
    }

    private var fileList: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach($items) { $item in
                    VStack(alignment: .leading, spacing: 9) {
                        HStack {
                            Image(systemName: "doc.richtext")
                                .foregroundStyle(.red)
                            Text("原始檔名：\(item.originalURL.lastPathComponent)")
                                .font(.callout)
                                .lineLimit(1)
                            Spacer()
                            stateLabel(item.state)
                            Button {
                                items.removeAll { $0.id == item.id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.secondary)
                        }

                        Text("偵測標題")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("找不到標題時可在此輸入", text: $item.title)
                            .textFieldStyle(.roundedBorder)

                        if useCitationFormat {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("作者")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    TextField("例如：Joseph E. Zins & Maurice J. Elias", text: $item.author)
                                        .textFieldStyle(.roundedBorder)
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("年份")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    TextField("例如：2006", text: $item.year)
                                        .textFieldStyle(.roundedBorder)
                                        .frame(width: 110)
                                }
                            }
                        }

                        HStack(spacing: 5) {
                            Image(systemName: "arrow.turn.down.right")
                            Text(item.proposedFilename(includeCitationFormat: useCitationFormat))
                                .lineLimit(1)
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    .padding(14)
                    .background(.background, in: RoundedRectangle(cornerRadius: 12))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.secondary.opacity(0.15))
                    }
                }
            }
            .padding(20)
        }
        .contentShape(Rectangle())
        .onDrop(of: [UTType.fileURL], isTargeted: $isDropTargeted, perform: handleDrop)
    }

    private var actionBar: some View {
        HStack {
            Text("共 \(items.count) 份 PDF")
                .foregroundStyle(.secondary)
            Spacer()
            if !items.isEmpty {
                Button("清除清單") { items.removeAll() }
                Button("重新命名") { renameAll() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!items.contains(where: isReadyToRename))
            }
        }
        .padding(16)
    }

    @ViewBuilder
    private func stateLabel(_ state: CiteNameItem.State) -> some View {
        switch state {
        case .ready:
            Text(state.label).foregroundStyle(.secondary)
        case .renamed:
            Label(state.label, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed:
            Label(state.label, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
    }

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls): add(urls)
        case .failure(let error): alertMessage = error.localizedDescription
        }
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        let pdfProviders = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }
        for provider in pdfProviders {
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                let url: URL?
                if let data = item as? Data {
                    url = URL(dataRepresentation: data, relativeTo: nil)
                } else if let candidate = item as? URL {
                    url = candidate
                } else {
                    url = nil
                }

                guard let url, url.pathExtension.lowercased() == "pdf" else { return }
                DispatchQueue.main.async { add([url]) }
            }
        }
        return !pdfProviders.isEmpty
    }

    private func add(_ urls: [URL]) {
        for url in urls where url.pathExtension.lowercased() == "pdf" {
            guard !items.contains(where: { $0.originalURL.standardizedFileURL == url.standardizedFileURL }) else { continue }
            let accessed = url.startAccessingSecurityScopedResource()
            let title = PDFTitleExtractor.extract(from: url) ?? url.deletingPathExtension().lastPathComponent
            let details = PDFBibliographicExtractor.extract(from: url, title: title)
            if accessed { url.stopAccessingSecurityScopedResource() }
            items.append(CiteNameItem(
                originalURL: url,
                title: title,
                author: details.author,
                year: details.year
            ))
        }
    }

    private func downloadFromURL() {
        var raw = remoteURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !raw.contains("://") { raw = "https://\(raw)" }
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            alertMessage = RemotePDFDownloadError.invalidURL.localizedDescription
            return
        }

        isDownloading = true
        downloadMessage = "正在下載⋯⋯"
        Task { @MainActor in
            defer { isDownloading = false }
            do {
                let download = try await RemotePDFDownloader.fetch(from: url)
                let savedURL = try RemotePDFDownloader.saveToDownloads(download)
                add([savedURL])
                remoteURLText = ""
                downloadMessage = "已下載到 Downloads：\(savedURL.lastPathComponent)"
            } catch {
                downloadMessage = nil
                alertMessage = error.localizedDescription
            }
        }
    }

    private func renameAll() {
        for index in items.indices where items[index].state == .ready {
            let item = items[index]
            let source = item.originalURL
            guard isReadyToRename(item) else {
                items[index].state = .failed("請補上作者、年份與標題")
                continue
            }
            let filename = item.proposedFilename(includeCitationFormat: useCitationFormat)
            let destination = source.deletingLastPathComponent().appendingPathComponent(filename)

            guard source.standardizedFileURL != destination.standardizedFileURL else {
                items[index].state = .renamed
                continue
            }
            guard !FileManager.default.fileExists(atPath: destination.path) else {
                items[index].state = .failed("同名檔案已存在")
                continue
            }

            let accessed = source.startAccessingSecurityScopedResource()
            defer { if accessed { source.stopAccessingSecurityScopedResource() } }
            do {
                try FileManager.default.moveItem(at: source, to: destination)
                items[index].state = .renamed
            } catch {
                items[index].state = .failed(error.localizedDescription)
            }
        }
    }

    private func isReadyToRename(_ item: CiteNameItem) -> Bool {
        guard item.state == .ready, !item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return false
        }
        guard useCitationFormat else { return true }
        return !item.author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            item.year.range(of: #"^(?:19|20)\d{2}$"#, options: .regularExpression) != nil
    }
}
