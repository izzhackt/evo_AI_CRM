"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Icon } from "@/components/icons";
import { btnCls, btnGhostCls } from "@/components/ui";
import type { Locale } from "@/lib/i18n-data";

import {
  CANONICAL_QUEUE_ROUTE_COPY,
  type CanonicalQueueRoute,
} from "./canonical-queue-route-copy";

function subscribeToDocumentLocale(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  return () => observer.disconnect();
}

function getDocumentLocale(): Locale {
  const locale = document.documentElement.lang;
  return locale === "ru" || locale === "ky" || locale === "en" ? locale : "ru";
}

export function CanonicalQueueRouteError({
  route,
  href,
  reset,
}: {
  route: CanonicalQueueRoute;
  href: `/${string}`;
  reset: () => void;
}) {
  const locale = useSyncExternalStore<Locale>(
    subscribeToDocumentLocale,
    getDocumentLocale,
    () => "ru",
  );
  const copy = CANONICAL_QUEUE_ROUTE_COPY[route][locale];

  return (
    <section
      role="alert"
      data-testid={`${route}-route-error`}
      className="mx-auto max-w-2xl rounded-card border border-danger/30 bg-surface p-5 shadow-evo sm:p-7"
    >
      <span
        aria-hidden="true"
        className="grid h-11 w-11 place-items-center rounded-card bg-danger-weak text-danger"
      >
        <Icon name="alert" size={20} />
      </span>
      <h1 className="mt-4 text-xl font-bold text-fg">{copy.errorTitle}</h1>
      <p className="mt-2 text-sm leading-6 text-fg-2">
        {copy.errorDescription}
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={reset} className={btnCls}>
          {copy.retry}
        </button>
        <Link href={href} className={btnGhostCls}>
          {copy.backToQueue}
        </Link>
      </div>
    </section>
  );
}
