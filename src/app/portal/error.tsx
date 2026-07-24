"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { PortalIcon } from "@/components/platform/portal/PortalIcon";
import {
  portalStyles as styles,
} from "@/components/platform/portal/PortalPrimitives";
import { getPortalCopy } from "@/components/platform/portal/portal-copy";
import type { Locale } from "@/lib/i18n-data";

export default function PortalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore<Locale>(
    () => () => undefined,
    () => {
      const documentLocale = document.documentElement.lang;
      return documentLocale === "ky" || documentLocale === "en" ? documentLocale : "ru";
    },
    () => "ru",
  );

  const copy = getPortalCopy(locale);

  return (
    <div className={styles.statusPage} role="alert">
      <section className={styles.statusCard}>
        <span className={styles.statusIcon}>
          <PortalIcon name="alert" size={27} />
        </span>
        <h1 className={styles.statusTitle}>{copy.errorTitle}</h1>
        <p className={styles.statusBody}>{copy.errorBody}</p>
        <div className={styles.statusActions}>
          <button type="button" className={styles.button} onClick={reset}>
            <PortalIcon name="refresh" size={17} />
            {copy.retry}
          </button>
          <Link href="/portal" className={styles.buttonSecondary}>
            <PortalIcon name="home" size={17} />
            {copy.backHome}
          </Link>
        </div>
      </section>
    </div>
  );
}
