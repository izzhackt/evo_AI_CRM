import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { positiveInteger } from "@/lib/request";
import {
  syncPlatformLeadAgentSessionStatus,
  syncPlatformLeadAgentWhatsApp,
} from "@/lib/server/platform-lead-agent-sync";

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
  return process.env.EVO_LEAD_AGENT_SYNC_SECRET?.trim() || null;
}

function verifiedTimestampSeconds(
  rawBody: string,
  secret: string,
  req: NextRequest,
): number | null {
  const timestamp = req.headers.get("x-evo-agent-timestamp")?.trim();
  const signature = req.headers.get("x-evo-agent-signature")?.trim();
  const algorithm = req.headers.get("x-evo-agent-signature-algorithm")?.trim().toLowerCase();
  if (algorithm && algorithm !== "sha256") return null;
  if (!timestamp || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return null;

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isSafeInteger(timestampSeconds)) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) return null;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))
    ? timestampSeconds
    : null;
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
  const timestampSeconds = verifiedTimestampSeconds(rawBody, secret, req);
  if (timestampSeconds === null) {
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
    try {
      const platform = await syncPlatformLeadAgentSessionStatus({
        session,
        status,
        phone: optionalString(body.phone, 32),
        providerOccurredAt: new Date(timestampSeconds * 1000).toISOString(),
        payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
      });
      return NextResponse.json({
        ok: true,
        platformSynced: true,
        platformDeduplicated: platform.deduplicated,
        currentStateUpdated: platform.currentStateUpdated,
      });
    } catch {
      return NextResponse.json({ error: "platform_sync_failed" }, { status: 503 });
    }
  }

  if (body.event !== "whatsapp.message") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const inboundText = boundedString(body.text, 4000);
  const inboundWaId = boundedString(body.providerMessageId, 256);
  const chatId = boundedString(body.chatId, 64);
  const providerOccurredAt = optionalString(body.providerOccurredAt, 32);
  const amoAccountId = positiveInteger(body.amoAccountId);
  const amoLeadId = positiveInteger(body.amoLeadId);
  const amoContactId = positiveInteger(body.amoContactId);
  if (
    !session || !inboundText || !inboundWaId || !chatId ||
    !providerOccurredAt || !amoAccountId || !amoLeadId || !amoContactId
  ) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  try {
    const platform = await syncPlatformLeadAgentWhatsApp({
      session,
      providerMessageId: inboundWaId,
      chatId,
      bodyText: inboundText,
      pushName: optionalString(body.pushName, 160),
      providerOccurredAt,
      amoAccountId,
      amoLeadId,
      amoContactId,
      payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
    });
    return NextResponse.json({
      ok: true,
      platformSynced: true,
      platformDeduplicated: platform.deduplicated ?? false,
    });
  } catch {
    return NextResponse.json({ error: "platform_sync_failed" }, { status: 503 });
  }
}
