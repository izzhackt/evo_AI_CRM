/** Значки справки «что это за документ». Цвет — от текста (`currentColor`). */

export function GuideMarkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.6v5.3" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="8" cy="12.2" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function ExpandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v12M8 12l4 4 4-4M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** «Как сфотографировать»: лист с углами, солнце, камера над листом, стопка страниц. */
export function PhotoTipIcon({ kind }: { kind: "whole" | "light" | "sharp" | "pdf" }) {
  const common = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {kind === "whole" ? (
        <>
          <rect x="7" y="6" width="10" height="12" rx="1.5" {...common} />
          <path d="M3 7V3h4M21 7V3h-4M3 17v4h4M21 17v4h-4" {...common} />
        </>
      ) : kind === "light" ? (
        <>
          <circle cx="12" cy="12" r="3.6" {...common} />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" {...common} />
        </>
      ) : kind === "sharp" ? (
        <>
          <path d="M8 4h8l1.2 2H20v8H4V6h2.8L8 4Z" {...common} />
          <circle cx="12" cy="10" r="2.6" {...common} />
          <path d="M6 20h12" {...common} />
        </>
      ) : (
        <>
          <path d="M8 7V4h10l3 3v11h-3" {...common} />
          <rect x="4" y="7" width="12" height="14" rx="1.5" {...common} />
          <path d="M7 12h6M7 15.5h6" {...common} />
        </>
      )}
    </svg>
  );
}
