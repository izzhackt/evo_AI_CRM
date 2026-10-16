import type { ReactNode } from "react";

// KaTeX 0.19.0 (MIT): стили и шрифты из пакета, без CDN, только на маршрутах
// /portal/csca (контракт §14). Свои стили раздела рядом.
import "katex/dist/katex.min.css";
import "./csca.css";

export default function CscaLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
