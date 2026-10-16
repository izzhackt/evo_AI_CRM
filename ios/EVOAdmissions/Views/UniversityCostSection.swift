import SwiftUI

/// Блок «Стоимость» на странице вуза (план 4.5, 7.3, контракт 2.2). Есть
/// только при опубликованных строках (`UniversityCostPolicy.plan` не nil):
/// нет данных, нет блока. Содержание то же, что у `CostTable.tsx` веба:
/// подпись строки и уточнения, сумма в валюте вуза и период, ориентир
/// «≈ USD» (уже округлён сервером); под строками учебный год, источник и
/// дата проверки, курс с источником и датой. Раскладка своя: на телефоне
/// строки идут столбиком, как в узкой раскладке веба.
struct UniversityCostSection: View {
    let plan: UniversityCostPlan
    /// Названия программ вуза по id: строка обучения программы подписана
    /// её названием, как на вебе.
    var programTitles: [String: String] = [:]

    private var locale: Locale { AppLocale.current }
    private var kyrgyz: Bool { AppLocale.isKyrgyz }
    private var nbsp: String { UniversityCostPolicy.nbsp }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("catalog_costs_heading")
                .font(.title3.bold())
                .accessibilityAddTraits(.isHeader)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(plan.groups.enumerated()), id: \.offset) { position, group in
                    if position > 0 { Divider().padding(.vertical, 12) }
                    Text(kindLabel(group.kind))
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                        .padding(.bottom, 6)
                    ForEach(Array(group.rows.enumerated()), id: \.element.id) { rowPosition, row in
                        if rowPosition > 0 { Divider().padding(.vertical, 8) }
                        rowView(row, group: group.kind)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AtlasStyle.surface, in: RoundedRectangle(cornerRadius: AtlasStyle.cardRadius, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                ForEach(notes, id: \.self) { note in
                    Text(note)
                        .font(.footnote)
                        .foregroundStyle(AtlasStyle.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            ForEach(plan.officialSources, id: \.self) { url in
                Link(destination: url) {
                    HStack(spacing: 6) {
                        Text(officialLinkTitle(url))
                            .multilineTextAlignment(.leading)
                        Image(systemName: "arrow.up.right")
                            .imageScale(.small)
                            .accessibilityHidden(true)
                    }
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.linkText)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
            }
        }
    }

    // MARK: - Строка

    private var texts: UniversityCostPolicy.Texts {
        .init(level: universityLevelLabel, language: languageLabel, kind: kindLabel)
    }

    private func rowView(_ row: UniversityCostRow, group: UniversityCostKind) -> some View {
        let label = UniversityCostPolicy.rowLabel(row, programTitles: programTitles, kyrgyz: kyrgyz, texts: texts)
        return VStack(alignment: .leading, spacing: 3) {
            // Подпись, совпавшая с заголовком вида («Страховка» под
            // «Страховкой»), не повторяется.
            if label.label != kindLabel(group) || label.details != nil {
                Text(label.label)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
            }
            Text(amountLine(row))
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.primary)
            if plan.showsUsd, let usd = usdValue(row) {
                Text(String(format: String(localized: "catalog_cost_usd"), usd))
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .accessibilityLabel(Text(String(format: String(localized: "catalog_cost_usd_a11y"), usd)))
            }
            if let details = label.details {
                Text(details)
                    .font(.footnote)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .padding(.top, 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    /// «от 25 000 до 35 000 CNY в год»: валюта не отрывается от суммы.
    private func amountLine(_ row: UniversityCostRow) -> String {
        let min = UniversityCostPolicy.amount(minor: row.amountMinMinor, exponent: row.exponent, locale: locale)
        let value: String
        if let maxMinor = row.amountMaxMinor {
            let max = UniversityCostPolicy.amount(minor: maxMinor, exponent: row.exponent, locale: locale)
            value = String(format: String(localized: "catalog_cost_range"), min, max)
        } else {
            value = min
        }
        return "\(value)\(nbsp)\(row.currency) \(periodLabel(row.period))"
    }

    private func usdValue(_ row: UniversityCostRow) -> String? {
        guard let usdMin = row.usdApproxMin else { return nil }
        let min = UniversityCostPolicy.whole(usdMin, locale: locale)
        guard let usdMax = row.usdApproxMax else { return min }
        let max = UniversityCostPolicy.whole(usdMax, locale: locale)
        return String(format: String(localized: "catalog_cost_range"), min, max)
    }

    // MARK: - Строки под таблицей

    /// Три абзаца, как под таблицей веба: год и источник, курс, оговорка.
    private var notes: [String] {
        var result: [String] = []
        let join = String(localized: "catalog_costs_join")
        let sources = plan.sourceKinds.map(sourceLabel).joined(separator: join)
        var first = String(format: String(localized: "catalog_costs_source"), sources,
                           UniversityCostPolicy.dateLabel(plan.latestVerifiedOn, locale: locale))
        first = UniversityCostPolicy.sentenceEnd(first)
        if !plan.academicYears.isEmpty {
            first = String(format: String(localized: "catalog_costs_year"), plan.academicYears.joined(separator: join)) + " " + first
        }
        result.append(first)
        if !plan.rates.isEmpty {
            let rates = plan.rates.map { rate in
                String(
                    format: String(localized: "catalog_costs_rate_item"),
                    UniversityCostPolicy.rate(rate.unitsPerUsd, locale: locale),
                    rate.currency,
                    rateSourceLabel(rate.sourceName),
                    UniversityCostPolicy.dateLabel(rate.asOf, locale: locale)
                )
            }
            result.append(String(format: String(localized: "catalog_costs_rates"), rates.joined(separator: "; ")))
        }
        result.append(String(localized: "catalog_costs_closing"))
        return result
    }

    private func officialLinkTitle(_ url: URL) -> String {
        let title = String(localized: "catalog_costs_official_link")
        guard plan.officialSources.count > 1, let host = url.host else { return title }
        return "\(title): \(host.replacingOccurrences(of: "www.", with: ""))"
    }

    // MARK: - Словарь

    private func kindLabel(_ kind: UniversityCostKind) -> String {
        switch kind {
        case .tuition: return String(localized: "catalog_cost_kind_tuition")
        case .accommodation: return String(localized: "catalog_cost_kind_accommodation")
        case .applicationFee: return String(localized: "catalog_cost_kind_application_fee")
        case .insurance: return String(localized: "catalog_cost_kind_insurance")
        case .other: return String(localized: "catalog_cost_kind_other")
        }
    }

    private func periodLabel(_ period: UniversityCostPeriod) -> String {
        switch period {
        case .year: return String(localized: "catalog_cost_period_year")
        case .semester: return String(localized: "catalog_cost_period_semester")
        case .month: return String(localized: "catalog_cost_period_month")
        case .week: return String(localized: "catalog_cost_period_week")
        case .day: return String(localized: "catalog_cost_period_day")
        case .once: return String(localized: "catalog_cost_period_once")
        case .program: return String(localized: "catalog_cost_period_program")
        }
    }

    /// «на английском» (словарь веба `costLanguage.*`); другой код:
    /// «язык обучения: XX».
    private func languageLabel(_ code: String) -> String {
        switch code {
        case "en": return String(localized: "catalog_cost_language_en")
        case "zh": return String(localized: "catalog_cost_language_zh")
        case "cs": return String(localized: "catalog_cost_language_cs")
        case "it": return String(localized: "catalog_cost_language_it")
        case "tr": return String(localized: "catalog_cost_language_tr")
        case "ms": return String(localized: "catalog_cost_language_ms")
        case "ar": return String(localized: "catalog_cost_language_ar")
        case "ru": return String(localized: "catalog_cost_language_ru")
        default: return String(format: String(localized: "catalog_cost_language_other"), code.uppercased())
        }
    }

    private func sourceLabel(_ kind: UniversityCostSourceKind) -> String {
        switch kind {
        case .official: return String(localized: "catalog_costs_source_official")
        case .agency: return String(localized: "catalog_costs_source_agency")
        case .evoDocument: return String(localized: "catalog_costs_source_evo")
        }
    }

    private func rateSourceLabel(_ name: String) -> String {
        switch UniversityCostPolicy.rateSource(name) {
        case .europeanCentralBank: return String(localized: "catalog_fx_source_ecb")
        case .centralBankUAE: return String(localized: "catalog_fx_source_cbuae")
        case .verbatim(let value): return value
        }
    }
}
