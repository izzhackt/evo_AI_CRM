import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "./db";

export function aiClient(): Anthropic | null {
  const apiKey = getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export const AI_MODEL = "claude-opus-4-8";

export const AI_SYSTEM = `Ты — AI-ассистент образовательного консалтингового агентства из Кыргызстана.
Агентство помогает студентам и выпускникам поступать в зарубежные вузы: подбор университетов,
подготовка документов, мотивационные письма, визовая поддержка.

Правила:
- Отвечай на языке клиента (обычно русский, иногда кыргызский или английский).
- Тон тёплый и профессиональный, без канцелярита.
- Не выдумывай цены, даты и условия — если их нет в контексте, предложи уточнить у менеджера.
- Ответы для WhatsApp держи короткими: 2–4 предложения.`;

export async function generateText(prompt: string, maxTokens = 1024): Promise<string> {
  const client = aiClient();
  if (!client) throw new Error("not_configured");
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system: AI_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
