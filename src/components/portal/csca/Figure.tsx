import type { ReactNode } from "react";

import type { Locale } from "@/lib/i18n-data";
import { darkFigureSvg, svgDataUrl, type CscaFigure } from "@/lib/portal/csca";

/**
 * Рисунок урока или задания (контракт §15): SVG по профилю через
 * `<img src="data:image/svg+xml,…">` (скрипты в таком контексте не
 * выполняются). Тёмная тема: та же картинка с заменой шести цветов один к
 * одному; обе версии в разметке, видимую выбирает CSS по `<html data-theme>`,
 * поэтому кнопка темы переключает рисунок без перезагрузки. Скрытая версия
 * убрана из дерева доступности (display: none), alt у видимой из altRu/altKy.
 */
export function Figure({
  figure,
  locale,
  caption,
  size = "wide",
}: {
  figure: CscaFigure;
  locale: Locale;
  caption?: ReactNode;
  size?: "wide" | "item";
}) {
  const alt = locale === "ky" ? figure.altKy : figure.altRu;
  const light = svgDataUrl(figure.svg);
  const dark = svgDataUrl(darkFigureSvg(figure.svg));
  return (
    <figure className="cs-figure" data-size={size}>
      <div className="cs-figure-frame" style={{ aspectRatio: `${figure.width} / ${figure.height}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: SVG по профилю, оптимизатор не нужен */}
        <img className="cs-figure-light" src={light} alt={alt} width={figure.width} height={figure.height} decoding="async" />
        {/* eslint-disable-next-line @next/next/no-img-element -- тёмная версия того же рисунка */}
        <img className="cs-figure-dark" src={dark} alt={alt} width={figure.width} height={figure.height} decoding="async" />
      </div>
      {caption ? <figcaption className="cs-figure-caption">{caption}</figcaption> : null}
    </figure>
  );
}
