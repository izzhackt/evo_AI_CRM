"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export function WahaQr({ baseSrc = "/api/waha/qr", intervalMs = 15000 }: { baseSrc?: string; intervalMs?: number }) {
  const [stamp, setStamp] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setStamp(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return (
    <Image
      src={`${baseSrc}?t=${stamp}`}
      alt="WAHA QR"
      width={176}
      height={176}
      unoptimized
      className="h-44 w-44 rounded-ctl border border-border bg-white object-contain p-2"
    />
  );
}
