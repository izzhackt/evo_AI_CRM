import { NextRequest, NextResponse } from "next/server";
import { db, getSetting } from "@/lib/db";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVICE_UNAVAILABLE = 503;

// Универсальный webhook о звонках для АТС (Sipuni, Zadarma, Mango Office и др.).
// Ожидает JSON: { direction: "in"|"out", phone: "+996...", duration_sec: 120,
//                 status: "answered"|"missed"|"busy", recording_url?: "...", api_key?: "..." }
// Большинство АТС позволяют настроить шаблон тела запроса; для специфичных форматов
// добавьте преобразование полей ниже.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const expectedKey = getSetting("tel_api_key")?.trim();
    if (!expectedKey) {
      return NextResponse.json({ error: "not_configured", missing: ["tel_api_key"] }, { status: HTTP_SERVICE_UNAVAILABLE });
    }

    const providedKey = body.api_key ?? req.headers.get("x-api-key");
    if (providedKey !== expectedKey) {
      return NextResponse.json({ error: "invalid api key" }, { status: HTTP_FORBIDDEN });
    }

    const phone = String(body.phone ?? body.caller ?? body.from ?? "").trim();
    if (!phone) return NextResponse.json({ error: "phone required" }, { status: HTTP_BAD_REQUEST });

    const d = db();
    // привязываем звонок к лиду по номеру телефона
    const lead = d.prepare("SELECT id, manager_id FROM leads WHERE phone = ?").get(phone) as
      | { id: number; manager_id: number | null }
      | undefined;

    d.prepare(
      "INSERT INTO calls (direction, phone, manager_id, lead_id, duration_sec, status, recording_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      body.direction === "out" ? "out" : "in",
      phone,
      lead?.manager_id ?? null,
      lead?.id ?? null,
      parseInt(body.duration_sec ?? body.duration ?? "0", 10) || 0,
      ["answered", "missed", "busy"].includes(body.status) ? body.status : "answered",
      body.recording_url ?? body.record ?? null,
      body.notes ?? null
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Telephony webhook error:", e);
    return NextResponse.json({ ok: false }, { status: HTTP_BAD_REQUEST });
  }
}
