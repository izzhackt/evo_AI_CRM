import { NextRequest, NextResponse } from "next/server";
import { getSetting } from "@/lib/db";
import { receiveWhatsApp } from "@/lib/whatsapp";

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
    const body = await req.json();
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        const contacts = value?.contacts ?? [];
        for (const msg of value?.messages ?? []) {
          if (msg.type !== "text") continue;
          const phone = `+${msg.from}`;
          const name = contacts.find((c: { wa_id: string }) => c.wa_id === msg.from)?.profile?.name ?? null;
          receiveWhatsApp(phone, name, msg.text?.body ?? "", msg.id);
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("WhatsApp webhook error:", e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
