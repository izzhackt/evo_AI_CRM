import { notFound } from "next/navigation";
import { PartShell } from "@/components/v3/PartShell";
import { TeamChat } from "@/components/v3/team-chat/TeamChat";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { TEAM_CHAT_FAILURE_COPY, isTeamChatChannel, teamChatUuid } from "@/lib/platform-team-chat";
import { TeamChatReadError } from "@/lib/server/platform-team-chat-repository";
import { readV3TeamChat } from "@/lib/v3/team-chat-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "EVO · Командный чат" };

export default async function TeamChatPage({ searchParams }: {
  searchParams: Promise<{ channel?: string | string[]; message?: string | string[] }>;
}) {
  const actor = await requirePlatformStaffActor();
  const params = await searchParams;
  const channel = params.channel ?? "general";
  const messageId = params.message ?? null;
  if (!isTeamChatChannel(channel) || (messageId !== null && !teamChatUuid(messageId))) notFound();
  let initial;
  let failure: keyof typeof TEAM_CHAT_FAILURE_COPY = "unavailable";
  try { initial = await readV3TeamChat(actor, { channel, mode: messageId ? "message" : "latest", messageId }); }
  catch (error) { failure = error instanceof TeamChatReadError ? error.status : "unavailable"; }
  if (!initial) {
    return <PartShell title="Командный чат"><div className="rounded-[10px] border border-line bg-surface p-6">
      <p role="alert">{TEAM_CHAT_FAILURE_COPY[failure]}</p>
      <a className="mt-4 inline-flex min-h-11 items-center text-[var(--accent-text)] underline" href={`/v3/team-chat?channel=${channel}`}>Обновить канал</a>
    </div></PartShell>;
  }
  return <PartShell title="Командный чат"><TeamChat key={`${actor.membershipId}:${channel}:${messageId ?? "latest"}`}
    initial={initial} channel={channel} organizationId={actor.organizationId} membershipId={actor.membershipId}
    canModerate={actor.presentationRole === "admin"} initialMessageId={messageId} showChannelsInitially={params.channel === undefined} />
  </PartShell>;
}
