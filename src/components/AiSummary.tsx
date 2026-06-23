"use client";

import { useState } from "react";

export function AiSummary({
  clientId,
  labels,
}: {
  clientId: number;
  labels: { button: string; thinking: string; notConfigured: string };
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === "not_configured" ? labels.notConfigured : (data.error ?? "Error"));
        return;
      }
      setSummary(data.summary);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="inline-flex items-center rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-50"
      >
        {loading ? labels.thinking : `✨ ${labels.button}`}
      </button>
      {error && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>}
      {summary && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-violet-100 bg-violet-50/50 px-4 py-3 text-sm text-slate-800">
          {summary}
        </div>
      )}
    </div>
  );
}
