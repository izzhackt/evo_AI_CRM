import Foundation

/// Standalone, Foundation-only protocol checks using the same vectors as TS.
/// This corpus is codec evidence, not an actual programme or UI acceptance run.
@main
struct ApplicationRequirementsV2CodecChecks {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            throw CheckFailure.message("Pass tests/fixtures/application-requirements-v2.json")
        }
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        guard let corpus = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let caseRaw = corpus["studentCaseId"] as? String, let caseId = UUID(uuidString: caseRaw),
              let applicationRaw = corpus["applicationId"] as? String, let applicationId = UUID(uuidString: applicationRaw),
              let vectors = corpus["cases"] as? [[String: Any]], !vectors.isEmpty else {
            throw CheckFailure.message("Invalid shared corpus envelope")
        }
        let decoder = JSONDecoder()
        var failures: [String] = []
        var v1Comparisons = 0
        var reservedFullComparisons = 0
        var validItemJSON: String?
        for vector in vectors {
            guard let name = vector["name"] as? String, let expected = vector["valid"] as? Bool,
                  let value = vector["value"] else { throw CheckFailure.message("Invalid vector") }
            let encoded = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
            var result: ApplicationRequirementsV2View?
            do {
                let decoded = try decoder.decode(ApplicationRequirementsV2View.self, from: encoded)
                try decoded.validate(studentCaseId: caseId, applicationId: applicationId)
                result = decoded
            } catch { result = nil }
            if (result != nil) != expected { failures.append(name) }
            if expected, result?.items.isEmpty == false, validItemJSON == nil {
                validItemJSON = String(data: encoded, encoding: .utf8)
            }

            // Added v2 metadata must not contaminate the independent old decoder.
            if expected, let result, var oldShape = value as? [String: Any] {
                oldShape.removeValue(forKey: "protocolVersion")
                if let items = oldShape["items"] as? [[String: Any]] {
                    oldShape["items"] = items.map { item in
                        var legacy = item
                        ["deadline", "reviewScope", "definitionImpact"].forEach { legacy.removeValue(forKey: $0) }
                        return legacy
                    }
                }
                let legacyData = try JSONSerialization.data(withJSONObject: oldShape, options: [.sortedKeys])
                let oldResult = try? decoder.decode(ApplicationRequirementsView.self, from: legacyData)
                if result.revision?.origin == .staffConfirmed {
                    reservedFullComparisons += 1
                    if oldResult != nil { failures.append(name + " (v1 accepted full revision)") }
                } else {
                    v1Comparisons += 1
                    if oldResult == nil { failures.append(name + " (v1 starter/no-revision mismatch)") }
                }
            }
        }
        // Invalid Unicode cannot live in the shared corpus envelope: Foundation
        // would reject that envelope before individual vectors could be tested.
        guard let validItemJSON,
              let labelRange = validItemJSON.range(of: "\"label\":\"[^\"]*\"", options: .regularExpression) else {
            throw CheckFailure.message("No valid item available for raw Unicode checks")
        }
        let malformedScalars = ["\\uD800", "\\uDC00", "\\uD800A"]
        for (index, escaped) in malformedScalars.enumerated() {
            let raw = validItemJSON.replacingCharacters(in: labelRange, with: "\"label\":\"" + escaped + "\"")
            if (try? decoder.decode(ApplicationRequirementsV2View.self, from: Data(raw.utf8))) != nil {
                failures.append("raw_unpaired_surrogate_\(index)")
            }
        }
        guard failures.isEmpty else {
            throw CheckFailure.message("Codec mismatches: " + failures.joined(separator: ", "))
        }
        print("PASS \(vectors.count) shared v2 codec vectors; \(v1Comparisons) v1 starter/no-revision comparisons; \(reservedFullComparisons) v1 full-revision rejections; \(malformedScalars.count) raw Unicode rejections. Protocol evidence only.")
    }

    private enum CheckFailure: Error {
        case message(String)
    }
}
