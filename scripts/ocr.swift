import Foundation
import Vision
import AppKit

// Input contains only canvases of the current question and choices.
do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    let images = try JSONDecoder().decode([String].self, from: data)
    var output: [String] = []
    for encoded in images {
        guard let data = Data(base64Encoded: encoded), let image = NSImage(data: data),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw NSError(domain: "OCR", code: 1)
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: cgImage).perform([request])
        let observations = (request.results ?? []).sorted {
            if abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.01 {
                return $0.boundingBox.midY > $1.boundingBox.midY
            }
            return $0.boundingBox.minX < $1.boundingBox.minX
        }
        let lines = try observations.map { observation -> String in
            guard let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.5 else {
                throw NSError(domain: "OCR", code: 2)
            }
            return candidate.string
        }
        guard !lines.isEmpty else { throw NSError(domain: "OCR", code: 3) }
        output.append(lines.joined(separator: "\n"))
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(output))
} catch {
    FileHandle.standardError.write(Data("本机题目识别失败，请检查字体现象或人工处理\n".utf8))
    exit(1)
}
