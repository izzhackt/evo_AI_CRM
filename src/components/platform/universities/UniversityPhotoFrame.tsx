"use client";
/* eslint-disable @next/next/no-img-element -- Reviewed fixed campus images; no arbitrary image proxy. */

import { useState, type ReactNode } from "react";

/** Only image failure is interactive; the server supplies the photo and attribution. */
export function UniversityPhotoFrame({
  src,
  alt,
  className,
  imageClassName,
  emptyClassName,
  failedText,
  children,
}: {
  src: string;
  alt: string;
  className: string;
  imageClassName: string;
  emptyClassName: string;
  failedText: string;
  children: ReactNode;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === src) return <div className={emptyClassName}>{failedText}</div>;

  return (
    <figure className={className}>
      <img
        src={src}
        alt={alt}
        width={1280}
        height={850}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(src)}
        className={imageClassName}
      />
      {children}
    </figure>
  );
}
