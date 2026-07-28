import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { generateText } from "@/lib/ai";
import {
  getConversationForActor,
  getLeadForActor,
  waMessagesForActor,
} from "@/lib/queries";
import { positiveInteger, readJsonObject } from "@/lib/request";
import { roleCanAccessStaffRoute } from "@/lib/domain";

// Черновик ответа клиенту в WhatsApp на основе истории переписки и данных лида
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user || !roleCanAccessStaffRoute(user.role, "/whatsapp")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await readJsonObject(req);
  const conversationId = positiveInteger(body?.conversationId);
  if (!conversationId) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const conv = getConversationForActor(user, conversationId);
  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const messages = waMessagesForActor(user, conv.id).slice(-15);
  const lead = conv.lead_id ? getLeadForActor(user, conv.lead_id) : undefined;

  const history = messages
    .map((m) => `${m.direction === "in" ? "Клиент" : "Менеджер"}: ${m.text}`)
    .join("\n");
  const leadInfo = lead
    ? `Данные клиента: имя ${lead.name}${lead.target_country ? `, интересуется страной: ${lead.target_country}` : ""}${lead.source ? `, источник: ${lead.source}` : ""}${lead.notes ? `, заметки менеджера: ${lead.notes}` : ""}.`
    : "";

  const prompt = `Переписка в WhatsApp с клиентом:\n${history}\n\n${leadInfo}\n\nНапиши черновик следующего ответа клиенту от имени менеджера. Верни только текст ответа, без кавычек и пояснений.`;

  try {
    const draft = await generateText(prompt, 600);
    return NextResponse.json({ draft });
  } catch (e) {
    if (e instanceof Error && e.message === "not_configured") {
      return NextResponse.json({ error: "not_configured" }, { status: 400 });
    }
    console.error("AI draft error:", e);
    return NextResponse.json({ error: "ai_error" }, { status: 500 });
  }
}
