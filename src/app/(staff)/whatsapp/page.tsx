import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { buildRouteMetadata } from "@/lib/route-metadata";
import { CanonicalStaffWhatsAppWorkspace } from "@/components/platform/communications/CanonicalStaffWhatsApp";
import { getT } from "@/lib/i18n";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";
import {
  CanonicalCrmRepositoryError,
  parseCanonicalReadCursor,
  type CanonicalReadCursor,
  listCanonicalStaffConversations,
} from "@/lib/server/canonical-crm-repository";

type SearchParams = Readonly<{
  before_at?: string | string[];
  before_id?: string | string[];
}>;

export async function generateMetadata(): Promise<Metadata> {
  return buildRouteMetadata({
    ru: "WhatsApp · Inbox",
    ky: "WhatsApp · Inbox",
    en: "WhatsApp · Inbox",
  });
}

export default async function WhatsAppPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<SearchParams>;
}>) {
  const [query, { locale }, actor] = await Promise.all([
    searchParams,
    getT(),
    requirePlatformMessagingActor(),
  ]);
  assertExpectedQueryKeys(query, ["before_at", "before_id"]);
  const cursor = parseQueueCursor(query);

  let page;
  try {
    page = await listCanonicalStaffConversations({
      actorRole: actor.platformRole,
      cursor: cursor ?? undefined,
      pageSize: 50,
    });
  } catch (error: unknown) {
    if (
      error instanceof CanonicalCrmRepositoryError &&
      error.code === "invalid_input"
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <CanonicalStaffWhatsAppWorkspace
      locale={locale}
      actorRole={actor.platformRole}
      conversations={page.rows}
      queueCursor={cursor}
      queueResetHref={cursor ? "/whatsapp" : null}
      queueNextHref={page.nextCursor ? queueHref(page.nextCursor) : null}
    />
  );
}

function parseQueueCursor(params: SearchParams): CanonicalReadCursor | null {
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
  if (beforeAt === undefined && beforeId === undefined) return null;
  try {
    return parseCanonicalReadCursor(beforeAt, beforeId);
  } catch (error: unknown) {
    if (
      error instanceof CanonicalCrmRepositoryError &&
      error.code === "invalid_input"
    ) {
      notFound();
    }
    throw error;
  }
}

function singleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) notFound();
  return value;
}

function assertExpectedQueryKeys(
  params: SearchParams,
  allowedKeys: readonly string[],
) {
  if (Object.keys(params).some((key) => !allowedKeys.includes(key))) {
    notFound();
  }
}

function queueHref(cursor: CanonicalReadCursor) {
  const query = new URLSearchParams({
    before_at: cursor.updatedAt,
    before_id: cursor.id,
  });
  return `/whatsapp?${query.toString()}`;
}
