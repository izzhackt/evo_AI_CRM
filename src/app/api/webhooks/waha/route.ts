import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/db";
import { getWhatsAppAccountBySession, receiveWhatsApp, updateWahaAccountStatus } from "@/lib/whatsapp";

const MAX_WEBHOOK_BODY_BYTES = 512 * 1024;

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function validWahaSignature(rawBody: string, secret: string, signatureHeader: string | null, algorithmHeader: string | null): boolean {
  if (algorithmHeader && algorithmHeader.toLowerCase() !== "sha512") return false;
  const provided = signatureHeader?.trim();
  if (!provided || !/^[a-f0-9]{128}$/i.test(provided)) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

function phoneFromChatId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{6,20})@c\.us$/);
  return match ? `+${match[1]}` : null;
}

export async function POST(req: NextRequest) {
  try {
    const secret = getSetting("waha_webhook_secret")?.trim();
    if (!secret) {
      return NextResponse.json({ error: "not_configured", missing: ["waha_webhook_secret"] }, { status: 503 });
    }

    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }
    if (!validWahaSignature(rawBody, secret, req.headers.get("x-webhook-hmac"), req.headers.get("x-webhook-hmac-algorithm"))) {
      return NextResponse.json({ error: "invalid signature" }, { status: 403 });
    }

    const body = JSON.parse(rawBody) as { event?: unknown; session?: unknown; payload?: Record<string, unknown>; me?: { id?: unknown; pushName?: unknown } };
    const event = boundedText(body.event, 64);
    const session = boundedText(body.session, 128);
    if (!event || !session) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

    const account = getWhatsAppAccountBySession(session);
    if (!account) return NextResponse.json({ error: "unknown session" }, { status: 404 });

    if (event === "session.status") {
      const status = boundedText(body.payload?.status, 64);
      if (status) updateWahaAccountStatus(session, status, phoneFromChatId(body.me?.id));
      return NextResponse.json({ ok: true });
    }

    if (event !== "message") return NextResponse.json({ ok: true, ignored: true });
    if (body.payload?.fromMe === true) return NextResponse.json({ ok: true, ignored: true });

    const from = phoneFromChatId(body.payload?.from);
    const text = boundedText(body.payload?.body, 4000);
    if (!from || !text) return NextResponse.json({ ok: true, ignored: true });

    const messageId = boundedText(body.payload?.id, 256) ?? undefined;
    receiveWhatsApp(from, null, text, messageId, { accountId: account.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("WAHA webhook error:", e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
