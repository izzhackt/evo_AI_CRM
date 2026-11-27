import { StatusBadge, type DataTableColumn, type StatusTone } from "@/components/kit";
import { CompanyFactVerifyButton } from "@/components/staff/settings/CompanyFactForm";
import { Button } from "@/components/ui/button";
import { companyFactDateLabel, type CompanyFact } from "@/lib/ai-agents/company-facts";
import {
  COMPANY_FACT_AUDIENCE_WORD,
  COMPANY_FACT_SOURCE_WORD,
  COMPANY_FACT_VALIDITY_WORD,
  companyFactTopicTitle,
  companyFactWords,
} from "@/lib/v3/wording";

const VALIDITY_TONE: Readonly<Record<CompanyFact["validity"], StatusTone>> = { unlimited: "neutral", ok: "ok", expiring: "warn", expired: "danger" };

export function unavailableLine(status: "not_ready" | "denied" | "unavailable"): string {
  return status === "denied" ? companyFactWords.denied : status === "not_ready" ? companyFactWords.notReady : companyFactWords.unavailable;
}

export function buildColumns(canEdit: boolean, onEdit: (fact: CompanyFact) => void): DataTableColumn<CompanyFact>[] {
  const columns: DataTableColumn<CompanyFact>[] = [
    {
      id: "topic", accessorFn: (fact) => `${companyFactTopicTitle(fact.topic)} ${fact.topic}`, header: companyFactWords.topic, meta: { mobile: "title" }, enableHiding: false,
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block font-medium text-fg [overflow-wrap:anywhere]">{companyFactTopicTitle(row.original.topic)}</span>
          <span className="block t-meta text-fg-3 [overflow-wrap:anywhere]">{row.original.topic}</span>
          <span className="mt-1 flex flex-wrap gap-1 md:hidden">
            <StatusBadge tone={row.original.audience === "client" ? "info" : "neutral"} label={COMPANY_FACT_AUDIENCE_WORD[row.original.audience] ?? ""} />
            {row.original.status === "retired" ? <StatusBadge tone="neutral" label={companyFactWords.retiredBadge} /> : null}
          </span>
          {row.original.status === "retired" ? <StatusBadge tone="neutral" label={companyFactWords.retiredBadge} className="mt-1 hidden md:inline-flex" /> : null}
        </span>
      ),
    },
    {
      id: "statement", accessorFn: (fact) => `${fact.statementRu} ${fact.statementKy ?? ""} ${fact.statementEn ?? ""}`, header: companyFactWords.statement,
      cell: ({ row }) => (
        <span className="block min-w-0 max-w-prose">
          <span className="line-clamp-4 t-body-compact text-fg [overflow-wrap:anywhere]">{row.original.statementRu}</span>
          {row.original.statementKy ? <span className="mt-1 line-clamp-2 block t-meta text-fg-3 [overflow-wrap:anywhere]">{companyFactWords.langKy}: {row.original.statementKy}</span> : null}
          {row.original.statementEn ? <span className="mt-1 line-clamp-2 block t-meta text-fg-3 [overflow-wrap:anywhere]">{companyFactWords.langEn}: {row.original.statementEn}</span> : null}
        </span>
      ),
    },
    {
      id: "audience", accessorFn: (fact) => COMPANY_FACT_AUDIENCE_WORD[fact.audience], header: companyFactWords.audience, meta: { mobile: "hide" },
      cell: ({ row }) => <StatusBadge tone={row.original.audience === "client" ? "info" : "neutral"} label={COMPANY_FACT_AUDIENCE_WORD[row.original.audience] ?? ""} />,
    },
    {
      id: "source", accessorFn: (fact) => `${COMPANY_FACT_SOURCE_WORD[fact.source]} ${fact.sourceRef ?? ""}`, header: companyFactWords.source, meta: { wide: true, mobile: "hide" },
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block t-body-compact text-fg-2">{COMPANY_FACT_SOURCE_WORD[row.original.source]}</span>
          {row.original.sourceRef ? <span className="block max-w-56 truncate t-meta text-fg-3" title={row.original.sourceRef}>{row.original.sourceRef}</span> : null}
        </span>
      ),
    },
    {
      id: "verified", accessorFn: (fact) => fact.verifiedAt, header: companyFactWords.verifiedAt, meta: { mobile: "hide" },
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="block tabular-nums text-fg">{companyFactDateLabel(row.original.verifiedAt)}</span>
          <span className="block max-w-44 truncate t-meta text-fg-3">{companyFactWords.verifiedBy(row.original.verifiedByName)}</span>
        </span>
      ),
    },
    {
      id: "until", accessorFn: (fact) => fact.validUntil ?? "9999-12-31", header: companyFactWords.validUntil,
      cell: ({ row }) => {
        const fact = row.original;
        const flagged = fact.status === "active" && (fact.validity === "expired" || fact.validity === "expiring");
        return (
          <span className="block min-w-0" data-validity={fact.validity}>
            <span className="block tabular-nums text-fg">{fact.validUntil ? companyFactDateLabel(fact.validUntil) : companyFactWords.noLimit}</span>
            {flagged
              ? <StatusBadge tone={VALIDITY_TONE[fact.validity]} label={COMPANY_FACT_VALIDITY_WORD[fact.validity] ?? ""} title={companyFactWords.validityLine(fact.validity, fact.daysLeft)} className="mt-1" />
              : null}
            {flagged ? <span className="block t-meta text-fg-3">{companyFactWords.validityLine(fact.validity, fact.daysLeft)}</span> : null}
            <span className="block t-meta text-fg-3 md:hidden">{companyFactWords.verifiedAt} {companyFactDateLabel(fact.verifiedAt)}</span>
          </span>
        );
      },
    },
  ];
  if (canEdit) {
    columns.push({
      id: "actions", header: companyFactWords.actions, enableSorting: false, meta: { label: companyFactWords.actions, fit: true },
      cell: ({ row }) => row.original.status === "active" ? (
        <span className="flex flex-wrap items-start gap-2">
          <CompanyFactVerifyButton fact={row.original} />
          <Button variant="outline" onClick={() => onEdit(row.original)} aria-label={`${companyFactWords.edit}: ${companyFactTopicTitle(row.original.topic)}`}>{companyFactWords.edit}</Button>
        </span>
      ) : null,
    });
  }
  return columns;
}
