import katex from "katex";
import type { ElementType } from "react";

import { splitMathText } from "@/lib/portal/csca";

/**
 * Текст с формулами `$…$` (контракт §14): текст как есть, формулы через
 * KaTeX 0.19.0 с выводом HTML+MathML. Экранные читалки получают MathML,
 * видимая HTML-часть у KaTeX помечена aria-hidden. Контент проверен
 * генератором (белый список, strict), здесь сбой формулы не роняет экран:
 * KaTeX рисует исходник формулы цветом ошибки.
 *
 * Компонент без "use client": один и тот же код рисует формулы на сервере
 * (урок) и в раннерах (разбор после ответа). KaTeX попадает только в
 * чанки маршрутов /portal/csca.
 */

const cache = new Map<string, string>();

export function renderTex(tex: string, display: boolean): string {
  const cacheKey = `${display ? "D" : "I"}${tex}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  const html = katex.renderToString(tex, {
    displayMode: display,
    output: "htmlAndMathml",
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
  if (cache.size > 2000) cache.clear();
  cache.set(cacheKey, html);
  return html;
}

export function TexDisplay({ tex, className }: { tex: string; className?: string }) {
  return (
    <div
      className={className ? `cs-tex-display ${className}` : "cs-tex-display"}
      dangerouslySetInnerHTML={{ __html: renderTex(tex, true) }}
    />
  );
}

export function TexInline({ tex }: { tex: string }) {
  return <span className="cs-tex" dangerouslySetInnerHTML={{ __html: renderTex(tex, false) }} />;
}

export function MathText({
  text,
  as: Tag = "span",
  className,
  lang,
  id,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  lang?: string;
  id?: string;
}) {
  return (
    <Tag className={className} lang={lang} id={id}>
      {splitMathText(text).map((segment, index) =>
        segment.math
          ? <TexInline key={index} tex={segment.value} />
          : <span key={index}>{segment.value}</span>)}
    </Tag>
  );
}
