"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Рамка рисунка урока (critique F8). Уже планки подписей рисунок не
 * сжимается, а прокручивается в рамке (контракт §15). Когда прокрутка
 * действительно есть, рамка становится областью с именем из alt и
 * получает фокус с клавиатуры (стрелки двигают рисунок), у правого края
 * появляется затухание, под рисунком подсказка. Без прокрутки рамка
 * обычная, лишней остановки Tab нет.
 */
export function FigureFrame({
  style,
  label,
  hint,
  children,
}: {
  style: CSSProperties;
  label: string;
  hint: string | undefined;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => {
      // Пара пикселей округления не считается прокруткой: подсказка была бы лишней.
      const overflow = node.scrollWidth - node.clientWidth > 4;
      setScrolls(overflow);
      setAtEnd(!overflow || node.scrollLeft + node.clientWidth >= node.scrollWidth - 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", measure);
    };
  }, []);

  return (
    <>
      <div className="cs-figure-scroller" data-scrolls={scrolls ? "" : undefined} data-end={atEnd ? "" : undefined}>
        <div
          ref={frame}
          className="cs-figure-frame"
          style={style}
          tabIndex={scrolls ? 0 : undefined}
          role={scrolls ? "region" : undefined}
          aria-label={scrolls ? label : undefined}
        >
          {children}
        </div>
      </div>
      {scrolls && hint ? <p className="cs-figure-hint">{hint}</p> : null}
    </>
  );
}
