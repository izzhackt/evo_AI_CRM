import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/db";
import { positiveInteger } from "@/lib/request";
import { syncLeadAgentWhatsApp, updateWahaAccountStatus } from "@/lib/whatsapp";
import { syncPlatformLeadAgentWhatsApp } from "@/lib/server/platform-lead-agent-sync";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return boundedString(value, maxLength);
}

function syncSecret(): string | null {
  return getSetting("lead_agent_sync_secret")?.trim() || process.env.EVO_LEAD_AGENT_SYNC_SECRET?.trim() || null;
}

function validSignature(rawBody: string, secret: string, req: NextRequest): boolean {
  const timestamp = req.headers.get("x-evo-agent-timestamp")?.trim();
  const signature = req.headers.get("x-evo-agent-signature")?.trim();
  const algorithm = req.headers.get("x-evo-agent-signature-algorithm")?.trim().toLowerCase();
  if (algorithm && algorithm !== "sha256") return false;
  if (!timestamp || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isSafeInteger(timestampSeconds)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}

function parseJsonObject(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const secret = syncSecret();
  if (!secret) {
    return NextResponse.json({ error: "not_configured", missing: ["lead_agent_sync_secret"] }, { status: 503 });
  }

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  if (!validSignature(rawBody, secret, req)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 403 });
  }

  const body = parseJsonObject(rawBody);
  if (!body) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const session = boundedString(body.session, 128);
  if (body.event === "whatsapp.session_status") {
    const status = boundedString(body.status, 64);
    if (!session || !status) {
      return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
    }
    updateWahaAccountStatus(session, status, optionalString(body.phone, 32));
    return NextResponse.json({ ok: true });
  }

  if (body.event !== "whatsapp.message") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const phone = boundedString(body.phone, 32);
  const inboundText = boundedString(body.text, 4000);
  const inboundWaId = boundedString(body.providerMessageId, 256);
  const chatId = boundedString(body.chatId, 64);
  const agentState = boundedString(body.agentState, 64);
  const amoLeadId = positiveInteger(body.amoLeadId);
  if (!session || !phone || !inboundText || !inboundWaId || !agentState || !amoLeadId) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const explicitOutboundText = optionalString(body.outboundText, 4000);
  const outboundWaId = optionalString(body.outboundProviderMessageId, 256);
  const replyText = optionalString(body.replyText, 4000);
  const draftReviewText =
    optionalString(body.draftReviewText, 4000) ??
    optionalString(body.draftText, 4000) ??
    (!outboundWaId ? replyText ?? explicitOutboundText : null);
  const outboundText = outboundWaId ? explicitOutboundText ?? replyText : null;

  const result = syncLeadAgentWhatsApp({
    session,
    phone,
    name: optionalString(body.pushName, 160),
    inboundText,
    inboundWaId,
    amoLeadId,
    amoContactId: positiveInteger(body.amoContactId),
    agentState,
    agentSummary: optionalString(body.agentSummary, 2000),
    agentHandoffReason: optionalString(body.handoffReason, 500),
    draftReviewText,
    draftReviewStatus: optionalString(body.draftReviewStatus, 64),
    draftReviewProvider: optionalString(body.draftReviewProvider, 64),
    draftReviewModel: optionalString(body.draftReviewModel, 128),
    outboundText,
    outboundWaId,
  });
  if (!result) return NextResponse.json({ error: "sync_failed" }, { status: 400 });

  try {
    const platform = await syncPlatformLeadAgentWhatsApp({
      session,
      providerMessageId: inboundWaId,
      chatId: chatId ?? "",
      bodyText: inboundText,
      pushName: optionalString(body.pushName, 160),
      providerOccurredAt: optionalString(body.providerOccurredAt, 32) ?? "",
      amoAccountId: positiveInteger(body.amoAccountId) ?? 0,
      amoLeadId,
      amoContactId: positiveInteger(body.amoContactId) ?? 0,
      payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
    });
    return NextResponse.json({
      ok: true,
      ...result,
      platformSynced: platform.enabled,
      platformDeduplicated: platform.deduplicated ?? false,
    });
  } catch {
    return NextResponse.json({ error: "platform_sync_failed" }, { status: 503 });
  }
}
