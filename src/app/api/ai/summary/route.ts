import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { generateText } from "@/lib/ai";
import { positiveInteger, readJsonObject } from "@/lib/request";
import { roleCanAccessStaffRoute } from "@/lib/domain";
import {
  getClient, clientApplications, clientDocuments,
  clientVisaCase, clientPayments, clientUpdates,
} from "@/lib/queries";

// Сводка по клиенту: где находимся, что блокирует, что делать дальше
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user || !roleCanAccessStaffRoute(user.role, "/clients")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await readJsonObject(req);
  const clientId = positiveInteger(body?.clientId);
  if (!clientId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const client = getClient(clientId);
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const apps = clientApplications(client.id);
  const docs = clientDocuments(client.id);
  const visa = clientVisaCase(client.id);
  const payments = clientPayments(client.id);
  const updates = clientUpdates(client.id).slice(0, 5);

  const prompt = `Собери краткую сводку по клиенту для команды (5-7 пунктов): текущее состояние, что блокирует, ближайшие шаги и риски по дедлайнам.

Клиент: ${client.name}, этап: ${client.stage}, цель: ${client.target_country ?? "—"} / ${client.target_degree ?? "—"}.
Заметки: ${client.notes ?? "—"}

Заявки в вузы:
${apps.map((a) => `- ${a.university} (${a.program ?? "—"}), статус: ${a.status}, дедлайн: ${a.deadline ?? "—"}`).join("\n") || "нет"}

Документы:
${docs.map((d) => `- ${d.name}: ${d.status}`).join("\n") || "нет"}

Виза: ${visa ? `${visa.country}, статус: ${visa.status}` : "не открыта"}

Платежи:
${payments.map((p) => `- ${p.title}: ${p.amount} ${p.currency}, статус: ${p.status}`).join("\n") || "нет"}

Последние обновления клиенту:
${updates.map((u) => `- ${u.message}`).join("\n") || "нет"}`;

  try {
    const summary = await generateText(prompt, 1024);
    return NextResponse.json({ summary });
  } catch (e) {
    if (e instanceof Error && e.message === "not_configured") {
      return NextResponse.json({ error: "not_configured" }, { status: 400 });
    }
    console.error("AI summary error:", e);
    return NextResponse.json({ error: "ai_error" }, { status: 500 });
  }
}
