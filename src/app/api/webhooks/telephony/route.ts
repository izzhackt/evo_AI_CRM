import { NextRequest, NextResponse } from "next/server";
import { db, getSetting } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_SERVICE_UNAVAILABLE = 503;
const MAX_WEBHOOK_BODY_BYTES = 128 * 1024;
const CALL_DIRECTIONS = new Set(["in", "out"]);
const CALL_STATUSES = new Set(["answered", "missed", "busy"]);

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function parseJsonBody(rawBody: string): Record<string, unknown> | null {
  try {
    const body = JSON.parse(rawBody);
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseDuration(value: unknown): number {
  const duration = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isFinite(duration) || duration < 0) return 0;
  return Math.min(duration, 60 * 60 * 6);
}

// Универсальный webhook о звонках для АТС (Sipuni, Zadarma, Mango Office и др.).
// Ожидает JSON: { direction: "in"|"out", phone: "+996...", duration_sec: 120,
//                 status: "answered"|"missed"|"busy", recording_url?: "...", api_key?: "..." }
// Большинство АТС позволяют настроить шаблон тела запроса; для специфичных форматов
// добавьте преобразование полей ниже.
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }
    const body = parseJsonBody(rawBody);
    if (!body) return NextResponse.json({ error: "invalid json" }, { status: HTTP_BAD_REQUEST });

    const provider = getSetting("tel_provider")?.trim();
    const expectedKey = getSetting("tel_api_key")?.trim();
    const missing = [
      ...(provider ? [] : ["tel_provider"]),
      ...(expectedKey ? [] : ["tel_api_key"]),
    ];
    if (missing.length > 0) {
      return NextResponse.json({ error: "not_configured", missing }, { status: HTTP_SERVICE_UNAVAILABLE });
    }

    const providedKey = boundedString(body.api_key ?? req.headers.get("x-api-key"), 256);
    if (providedKey !== expectedKey) {
      return NextResponse.json({ error: "invalid api key" }, { status: HTTP_FORBIDDEN });
    }

    const rawPhone = boundedString(body.phone ?? body.caller ?? body.from, 32);
    const phone = normalizePhone(rawPhone);
    if (!rawPhone || !/^\+?\d[\d\s().-]{5,31}$/.test(rawPhone) || !phone) {
      return NextResponse.json({ error: "phone required" }, { status: HTTP_BAD_REQUEST });
    }
    const direction = boundedString(body.direction, 16) ?? "in";
    const status = boundedString(body.status, 24) ?? "answered";
    if (!CALL_DIRECTIONS.has(direction) || !CALL_STATUSES.has(status)) {
      return NextResponse.json({ error: "invalid call status" }, { status: HTTP_BAD_REQUEST });
    }
    const recordingUrl = boundedString(body.recording_url ?? body.record, 512);
    const notes = boundedString(body.notes, 1000);

    const d = db();
    // привязываем звонок к лиду по номеру телефона
    const lead = d.prepare("SELECT id, manager_id FROM leads WHERE phone = ?").get(phone) as
      | { id: number; manager_id: number | null }
      | undefined;

    d.prepare(
      "INSERT INTO calls (direction, phone, manager_id, lead_id, duration_sec, status, recording_url, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      direction,
      phone,
      lead?.manager_id ?? null,
      lead?.id ?? null,
      parseDuration(body.duration_sec ?? body.duration),
      status,
      recordingUrl,
      notes
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Telephony webhook error:", e);
    return NextResponse.json({ ok: false }, { status: HTTP_BAD_REQUEST });
  }
}
