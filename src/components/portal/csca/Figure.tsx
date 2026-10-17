import type { CSSProperties, ReactNode } from "react";

import type { Locale } from "@/lib/i18n-data";
import { darkFigureSvg, figureMinWidth, svgDataUrl, type CscaFigure } from "@/lib/portal/csca";

import { FigureFrame } from "./FigureFrame";

/**
 * Рисунок урока или задания (контракт §15): SVG по профилю через
 * `<img src="data:image/svg+xml,…">` (скрипты в таком контексте не
 * выполняются). Тёмная тема: та же картинка с заменой шести цветов один к
 * одному; обе версии в разметке, видимую выбирает CSS по `<html data-theme>`,
 * поэтому кнопка темы переключает рисунок без перезагрузки. Скрытая версия
 * убрана из дерева доступности (display: none), alt у видимой из altRu/altKy.
 *
 * Подписи не мельче планки (§15: текст 12 px, индексы 11 px): на телефоне
 * рисунок занимает всю ширину карточки, а уже ширины, при которой самая
 * мелкая подпись упала бы ниже планки, он не сжимается и прокручивается в
 * своей рамке.
 */
export function Figure({
  figure,
  locale,
  caption,
  size = "wide",
  scrollHint,
}: {
  figure: CscaFigure;
  locale: Locale;
  caption?: ReactNode;
  size?: "wide" | "item";
  /** «Рисунок прокручивается вбок»: показывается, только когда рамка прокручивается. */
  scrollHint?: string;
}) {
  const alt = locale === "ky" ? figure.altKy : figure.altRu;
  const light = svgDataUrl(figure.svg);
  const dark = svgDataUrl(darkFigureSvg(figure.svg));
  const frameStyle = { "--cs-figure-min": `${figureMinWidth(figure.svg, figure.width)}px` } as CSSProperties;
  return (
    <figure className="cs-figure" data-size={size}>
      <FigureFrame style={frameStyle} label={alt} hint={scrollHint}>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: SVG по профилю, оптимизатор не нужен */}
        <img className="cs-figure-light" src={light} alt={alt} width={figure.width} height={figure.height} decoding="async" />
        {/* eslint-disable-next-line @next/next/no-img-element -- тёмная версия того же рисунка */}
        <img className="cs-figure-dark" src={dark} alt={alt} width={figure.width} height={figure.height} decoding="async" />
      </FigureFrame>
      {caption ? <figcaption className="cs-figure-caption">{caption}</figcaption> : null}
    </figure>
  );
}
