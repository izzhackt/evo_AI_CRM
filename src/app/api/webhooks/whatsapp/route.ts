import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getSetting } from "@/lib/db";
import { receiveWhatsApp } from "@/lib/whatsapp";

const MAX_WEBHOOK_BODY_BYTES = 512 * 1024;

function validSignature(rawBody: string, appSecret: string, header: string | null): boolean {
  const prefix = "sha256=";
  if (!header?.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

// Подтверждение webhook от Meta (GET с hub.challenge)
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && token && token === getSetting("wa_verify_token")) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// Входящие сообщения от WhatsApp Cloud API
export async function POST(req: NextRequest) {
  try {
    const appSecret = getSetting("wa_app_secret")?.trim();
    if (!appSecret) {
      return NextResponse.json({ error: "not_configured", missing: ["wa_app_secret"] }, { status: 503 });
    }
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }
    if (!validSignature(rawBody, appSecret, req.headers.get("x-hub-signature-256"))) {
      return NextResponse.json({ error: "invalid signature" }, { status: 403 });
    }
    const body = JSON.parse(rawBody);
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value;
        const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
        const messages = Array.isArray(value?.messages) ? value.messages : [];
        for (const msg of messages) {
          if (msg.type !== "text") continue;
          const from = boundedText(msg.from, 32);
          const text = boundedText(msg.text?.body, 4000);
          if (!from || !/^\d{6,20}$/.test(from) || !text) continue;
          const messageId = boundedText(msg.id, 128) ?? undefined;
          const contact = contacts.find((c: { wa_id?: unknown }) => c.wa_id === from);
          const name = boundedText(contact?.profile?.name, 120);
          receiveWhatsApp(`+${from}`, name, text, messageId);
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("WhatsApp webhook error:", e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
