"use client";
/* eslint-disable @next/next/no-img-element -- Reviewed fixed place photos from our own bucket; no arbitrary image proxy. */

import { useEffect, useRef, useState } from "react";

/**
 * Фото страны или города. Уменьшенные копии (Image Transformations) при
 * сбое заменяются оригиналом, сбой оригинала оставляет тёмную подложку
 * карточки: название и счётчики на ней остаются читаемыми. Фото: фон
 * места, его смысл несёт текст рядом, поэтому alt пустой.
 */
export function PlaceImage({
  src,
  srcSet,
  sizes,
  width,
  height,
  priority = false,
  className,
}: {
  src: string;
  srcSet: string | null;
  sizes: string;
  width: number;
  height: number;
  priority?: boolean;
  className: string;
}) {
  const [originalOnly, setOriginalOnly] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement | null>(null);
  const reduced = srcSet && originalOnly !== src ? srcSet : undefined;

  // Сбой до гидратации React не видит: завершённую неудачную загрузку при
  // монтировании передаём тому же обработчику onError. Дальнейшие сбои
  // (оригинал после копии) приходят обычным событием.
  useEffect(() => {
    const image = ref.current;
    if (image && image.complete && image.naturalWidth === 0) image.dispatchEvent(new Event("error"));
  }, []);

  if (failed === src) return null;
  return (
    <img
      ref={ref}
      src={src}
      srcSet={reduced}
      sizes={reduced ? sizes : undefined}
      alt=""
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => (reduced ? setOriginalOnly(src) : setFailed(src))}
      className={className}
    />
  );
}
