import Foundation

/// Как строки «Избранного» находят свой экран в каждом стеке, который
/// открывает «Избранное» (review раунда 3, P2). Модель повторяет правило
/// SwiftUI, которое приложение уже проверило на устройстве (прогон
/// 16.10.2026, аудит #1172): переход по значению ищет экран среди
/// `navigationDestination` своего экрана и экранов стека, открытых по
/// значению; экран, открытый ссылкой с экраном (`NavigationLink { … }`), в
/// путь стека не входит, и экраны, зарегистрированные корнем стека, для
/// переходов из него не действуют (переход встаёт под него).
///
/// Модель читает исходники приложения, а не ищет одну строку: результат это
/// список строк «Избранного», у которых в данном стеке нет экрана. Файл без
/// XCTest, чтобы ту же модель можно было прогнать на пробном слиянии с
/// #1172 вне тестовой сборки.
enum FavoritesNavigationModel {
    struct Stack: Equatable {
        let file: String
        /// «Избранное» открыто по значению, и корень знает экран для него.
        let favoritesPushedByValue: Bool
        /// Типы значений строк «Избранного» без экрана в этом стеке.
        let unresolvedRowTypes: [String]
    }

    /// - Parameters:
    ///   - favorites: исходник `FavoritesView.swift`.
    ///   - sources: остальные исходники приложения (имя файла → текст):
    ///     корни стеков и определение `portalRouteDestinations()`.
    static func stacks(favorites: String, sources: [String: String]) -> [Stack] {
        let rowTypes = rowValueTypes(favorites)
        let own = destinationTypes(favorites, sources: sources)
        return sources.keys.sorted().compactMap { file -> Stack? in
            let source = sources[file]!
            let byClosure = source.contains(#/NavigationLink\s*\{\s*FavoritesView\(\)/#)
            let valueType = source.firstMatch(of: #/NavigationLink\(value:\s*([A-Z][A-Za-z0-9]*)\.favorites\)/#).map { String($0.output.1) }
            guard byClosure || valueType != nil else { return nil }
            let root = destinationTypes(source, sources: sources)
            let byValue = !byClosure && valueType.map(root.contains) == true
            let unresolved = rowTypes.filter { type in !(own.contains(type) || (byValue && root.contains(type))) }
            return Stack(file: file, favoritesPushedByValue: byValue, unresolvedRowTypes: unresolved)
        }
    }

    /// Типы значений `NavigationLink(value:)` в строках «Избранного».
    /// `item.id` строки это `UUID` вуза; другое выражение без явного типа
    /// считается неизвестным и экрана не находит.
    static func rowValueTypes(_ source: String) -> [String] {
        var types: [String] = []
        for match in source.matches(of: #/NavigationLink\(value:\s*([A-Za-z_][A-Za-z0-9_.]*)/#) {
            let expression = String(match.output.1)
            let type: String
            if let first = expression.first, first.isUppercase {
                type = String(expression.prefix { $0 != "." && $0 != "(" })
            } else if expression.hasSuffix(".id") {
                type = "UUID"
            } else {
                type = "?\(expression)"
            }
            if !types.contains(type) { types.append(type) }
        }
        return types
    }

    /// Типы, для которых исходник регистрирует экран, в том числе через
    /// `.portalRouteDestinations()` (#1172), если его определение есть среди
    /// исходников.
    static func destinationTypes(_ source: String, sources: [String: String]) -> Set<String> {
        var types = Set(source.matches(of: #/navigationDestination\(for:\s*([A-Za-z][A-Za-z0-9]*)\.self/#).map { String($0.output.1) })
        if source.contains(".portalRouteDestinations()") {
            for other in sources.values {
                guard let start = other.range(of: "func portalRouteDestinations()") else { continue }
                let rest = other[start.upperBound...]
                let body = rest.range(of: "\n}").map { rest[..<$0.lowerBound] } ?? rest
                types.formUnion(String(body).matches(of: #/navigationDestination\(for:\s*([A-Za-z][A-Za-z0-9]*)\.self/#).map { String($0.output.1) })
            }
        }
        return types
    }
}
