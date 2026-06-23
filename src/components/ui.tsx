import Link from "next/link";
import type { ReactNode } from "react";

const BADGE_COLORS: Record<string, string> = {
  // client stages
  lead: "border-slate-200 bg-slate-50 text-slate-700",
  consultation: "border-sky-200 bg-sky-50 text-sky-800",
  contract: "border-blue-200 bg-blue-50 text-blue-800",
  documents: "border-amber-200 bg-amber-50 text-amber-800",
  applying: "border-cyan-200 bg-cyan-50 text-cyan-800",
  offer: "border-emerald-200 bg-emerald-50 text-emerald-800",
  visa: "border-teal-200 bg-teal-50 text-teal-800",
  enrolled: "border-green-200 bg-green-50 text-green-800",
  archived: "border-gray-200 bg-gray-50 text-gray-500",
  // application / document / visa / payment statuses
  preparing: "border-amber-200 bg-amber-50 text-amber-800",
  submitted: "border-sky-200 bg-sky-50 text-sky-800",
  rejected: "border-red-200 bg-red-50 text-red-700",
  required: "border-red-200 bg-red-50 text-red-700",
  uploaded: "border-sky-200 bg-sky-50 text-sky-800",
  review: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-green-200 bg-green-50 text-green-800",
  not_started: "border-slate-200 bg-slate-50 text-slate-600",
  docs: "border-amber-200 bg-amber-50 text-amber-800",
  appointment: "border-sky-200 bg-sky-50 text-sky-800",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  paid: "border-green-200 bg-green-50 text-green-800",
  overdue: "border-red-200 bg-red-50 text-red-700",
  open: "border-sky-200 bg-sky-50 text-sky-800",
  done: "border-green-200 bg-green-50 text-green-800",
};

export function Badge({ value, label }: { value: string; label: string }) {
  const color = BADGE_COLORS[value] ?? "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${color}`}>
      {label}
    </span>
  );
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--evo-border)] bg-white shadow-[var(--evo-shadow-sm)]">
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
          {action}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const inner = (
    <div className="min-h-24 rounded-lg border border-[var(--evo-border)] bg-white px-5 py-4 shadow-[var(--evo-shadow-sm)] transition hover:border-blue-200 hover:shadow-[var(--evo-shadow-md)]">
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export const inputCls =
  "h-10 w-full rounded-md border border-[var(--evo-border-strong)] bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15";

export const btnCls =
  "inline-flex h-10 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

export const btnGhostCls =
  "inline-flex h-8 items-center justify-center rounded-md border border-[var(--evo-border-strong)] bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50";

export const labelCls = "mb-1 block text-xs font-semibold text-slate-600";

export function EmptyState({ text }: { text: string }) {
  return <p className="py-5 text-center text-sm text-slate-400">{text}</p>;
}
