import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PlatformStaffWhatsAppWorkspace } from "@/components/platform/communications/PlatformStaffWhatsApp";
import { buildRouteMetadata } from "@/lib/route-metadata";
import { getT } from "@/lib/i18n";
import {
  listPlatformConversations,
  parsePlatformConversationCursor,
  type PlatformConversationCursor,
} from "@/lib/platform-communications";
import { requirePlatformMessagingActor } from "@/lib/platform-guards";

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
  const page = await listPlatformConversations(actor, {
    cursor,
    pageSize: 50,
  });

  return (
    <PlatformStaffWhatsAppWorkspace
      locale={locale}
      actorRole={actor.presentationRole}
      conversations={page.rows}
      queueCursor={cursor}
      queueResetHref={cursor ? "/whatsapp" : null}
      queueNextHref={page.nextCursor ? queueHref(page.nextCursor) : null}
    />
  );
}

function parseQueueCursor(params: SearchParams): PlatformConversationCursor | null {
  const beforeAt = singleValue(params.before_at);
  const beforeId = singleValue(params.before_id);
  if (beforeAt === undefined && beforeId === undefined) return null;
  if (beforeAt === undefined || beforeId === undefined) notFound();

  const cursor = parsePlatformConversationCursor(beforeAt, beforeId);
  if (cursor === null) notFound();
  return cursor;
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

function queueHref(cursor: PlatformConversationCursor) {
  const query = new URLSearchParams({
    before_at: cursor.sortAt,
    before_id: cursor.id,
  });
  return `/whatsapp?${query.toString()}`;
}
