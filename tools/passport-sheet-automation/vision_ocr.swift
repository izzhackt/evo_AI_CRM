import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: vision-ocr IMAGE\n".utf8))
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url), let data = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: data), let cgImage = bitmap.cgImage else {
    FileHandle.standardError.write(Data("cannot decode image\n".utf8))
    exit(3)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.minimumTextHeight = 0.008
do {
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    for observation in request.results ?? [] {
        if let candidate = observation.topCandidates(1).first { print(candidate.string) }
    }
} catch {
    FileHandle.standardError.write(Data("Vision OCR failed: \(error)\n".utf8))
    exit(4)
}
