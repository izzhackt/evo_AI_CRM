import SwiftUI

/// Блок «Стоимость» на странице вуза (план 4.5, 7.3, контракт 2.2). Есть
/// только при опубликованных строках (`UniversityCostPolicy.plan` не nil):
/// нет данных, нет блока. Сумма в валюте вуза, ориентир «≈ USD» уже
/// округлён сервером; под строками учебный год, источник, дата проверки и
/// курс с источником и датой.
struct UniversityCostSection: View {
    let plan: UniversityCostPlan

    private var locale: Locale { AppLocale.current }

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
                        rowView(row)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AtlasStyle.surface, in: RoundedRectangle(cornerRadius: AtlasStyle.cardRadius, style: .continuous))

            Text(footer)
                .font(.footnote)
                .foregroundStyle(AtlasStyle.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

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

    private func rowView(_ row: UniversityCostRow) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if let qualifiers = qualifiers(row) {
                Text(qualifiers)
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
            if let note = row.note {
                Text(note.text(kyrgyz: AtlasText.kyrgyz))
                    .font(.footnote)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .padding(.top, 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }

    /// «Бакалавриат · язык: английский». Программа (`programId`) уточняет
    /// строку только для сервера: названия программы в строке нет.
    private func qualifiers(_ row: UniversityCostRow) -> String? {
        var parts: [String] = []
        if let level = row.studyLevel { parts.append(universityLevelLabel(level)) }
        if let language = row.teachingLanguage {
            let name = locale.localizedString(forLanguageCode: language) ?? language
            parts.append(String(format: String(localized: "catalog_cost_language"), name))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func amountLine(_ row: UniversityCostRow) -> String {
        let min = UniversityCostPolicy.amount(minor: row.amountMinMinor, exponent: row.exponent, locale: locale)
        let value: String
        if let maxMinor = row.amountMaxMinor {
            let max = UniversityCostPolicy.amount(minor: maxMinor, exponent: row.exponent, locale: locale)
            value = String(format: String(localized: "catalog_cost_range"), min, max)
        } else {
            value = min
        }
        return "\(value) \(row.currency) \(periodLabel(row.period))"
    }

    private func usdValue(_ row: UniversityCostRow) -> String? {
        guard let usdMin = row.usdApproxMin else { return nil }
        let min = UniversityCostPolicy.whole(usdMin, locale: locale)
        guard let usdMax = row.usdApproxMax else { return min }
        let max = UniversityCostPolicy.whole(usdMax, locale: locale)
        return String(format: String(localized: "catalog_cost_range"), min, max)
    }

    // MARK: - Строка под таблицей

    private var footer: String {
        var parts: [String] = []
        if !plan.academicYears.isEmpty {
            parts.append(String(format: String(localized: "catalog_costs_year"), list(plan.academicYears)))
        }
        let sources = list(plan.sourceKinds.map(sourceLabel))
        parts.append(String(format: String(localized: "catalog_costs_source"), sources, AtlasText.numericDay(plan.latestVerifiedOn)))
        for rate in plan.rates {
            parts.append(String(
                format: String(localized: "catalog_costs_rate"),
                UniversityCostPolicy.rate(rate.unitsPerUsd, locale: locale),
                rate.currency,
                rateSourceLabel(rate.sourceName),
                AtlasText.numericDay(rate.asOf)
            ))
        }
        parts.append(String(localized: "catalog_costs_closing"))
        return parts.joined(separator: " ")
    }

    private func list(_ items: [String]) -> String {
        let formatter = ListFormatter()
        formatter.locale = locale
        return formatter.string(from: items) ?? items.joined(separator: ", ")
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
