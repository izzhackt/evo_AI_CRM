"use client";
/* eslint-disable @next/next/no-img-element -- Reviewed fixed campus images; no arbitrary image proxy. */

import { useState, type ReactNode } from "react";

/**
 * Only image failure is interactive; the server supplies the photo and
 * attribution. `srcSet`/`sizes` are reduced copies of a managed photo (план A):
 * if they fail, the frame retries once with the original `src` before it
 * shows the failure text.
 */
export function UniversityPhotoFrame({
  src,
  srcSet,
  sizes,
  priority = false,
  alt,
  className,
  imageClassName,
  emptyClassName,
  failedText,
  children,
}: {
  src: string;
  srcSet?: string | null;
  sizes?: string;
  /** The first visible photo of a screen: load it now, not lazily. */
  priority?: boolean;
  alt: string;
  className: string;
  imageClassName: string;
  emptyClassName: string;
  failedText: string;
  children: ReactNode;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [originalOnly, setOriginalOnly] = useState<string | null>(null);
  if (failedUrl === src) return <div className={emptyClassName}>{failedText}</div>;
  const reduced = srcSet && originalOnly !== src ? srcSet : undefined;

  return (
    <figure className={className}>
      <img
        src={src}
        srcSet={reduced}
        sizes={reduced ? sizes : undefined}
        alt={alt}
        width={1280}
        height={850}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => (reduced ? setOriginalOnly(src) : setFailedUrl(src))}
        className={imageClassName}
      />
      {children}
    </figure>
  );
}
