export type PreparedAiPrompt = {
  id: string;
  title: string;
  purpose: string;
  instructions: string[];
};

export type PreparedAiScenarioId =
  | "price-boundary"
  | "consultation-booking"
  | "program-fit"
  | "documents-next-step";

export type PreparedAiScenarioResponse = {
  id: PreparedAiScenarioId;
  title: string;
  promptId: string;
  trigger: string;
  response: string;
  checks: string[];
};

export type PreparedAiBundle = {
  mode: "prepared_first_presentation";
  label: string;
  selectedScenarioId: PreparedAiScenarioId;
  promptLibrary: PreparedAiPrompt[];
  scenarios: PreparedAiScenarioResponse[];
  facts: string[];
};

type PreparedConversation = {
  phone: string;
  name: string | null;
};

type PreparedLead = {
  name: string;
  source: string | null;
  status: string;
  amount: number | null;
  currency: string;
  target_country: string | null;
  notes: string | null;
  manager_name: string | null;
};

type PreparedMessage = {
  direction: string;
  text: string;
  created_at: string;
  author_name: string | null;
};

export type PreparedWhatsAppInput = {
  conversation: PreparedConversation;
  lead?: PreparedLead;
  messages: PreparedMessage[];
};

export const PREPARED_AI_PROMPT_LIBRARY: PreparedAiPrompt[] = [
  {
    id: "wa-price-boundary",
    title: "WhatsApp price boundary",
    purpose: "Answer a pricing question without inventing terms or overpromising.",
    instructions: [
      "Use only CRM facts already visible in the conversation and linked lead.",
      "State that final pricing is confirmed by the manager after qualification.",
      "Ask one concrete next-step question.",
    ],
  },
  {
    id: "wa-consultation-booking",
    title: "Consultation booking",
    purpose: "Move a qualified lead toward a consultation slot.",
    instructions: [
      "Acknowledge the destination or program goal.",
      "Keep the reply short enough for WhatsApp.",
      "Offer a consultation without claiming availability that is not in CRM.",
    ],
  },
  {
    id: "wa-program-fit",
    title: "Program fit triage",
    purpose: "Collect missing education-fit details for country and program matching.",
    instructions: [
      "Ask for current class or degree level, target intake, and language background.",
      "Mention the target country only when it exists in CRM.",
      "Do not promise admission probability.",
    ],
  },
  {
    id: "wa-documents-next-step",
    title: "Document next step",
    purpose: "Explain the first document checkpoint without pretending a review happened.",
    instructions: [
      "Name common first documents only as a starting checklist.",
      "Ask the client to send what they already have.",
      "Avoid claiming that submitted files were checked unless CRM says so.",
    ],
  },
];

const SCENARIO_TITLES: Record<PreparedAiScenarioId, string> = {
  "price-boundary": "Цена и рамки",
  "consultation-booking": "Запись на консультацию",
  "program-fit": "Подбор программы",
  "documents-next-step": "Документы",
};

function lastInbound(messages: PreparedMessage[]): PreparedMessage | undefined {
  return [...messages].reverse().find((message) => message.direction === "in");
}

function compact(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function contactName(input: PreparedWhatsAppInput): string {
  return compact(input.conversation.name) ?? compact(input.lead?.name) ?? "Здравствуйте";
}

function leadCountry(input: PreparedWhatsAppInput): string | null {
  return compact(input.lead?.target_country);
}

function priceFact(input: PreparedWhatsAppInput): string | null {
  const amount = input.lead?.amount;
  const currency = compact(input.lead?.currency);
  if (!amount || !currency) return null;
  return `${amount.toLocaleString("ru-RU")} ${currency}`;
}

function buildFacts(input: PreparedWhatsAppInput): string[] {
  const latest = lastInbound(input.messages);
  return [
    compact(input.conversation.name) ? `Контакт: ${input.conversation.name}` : `Телефон: ${input.conversation.phone}`,
    compact(input.lead?.source) ? `Источник: ${input.lead?.source}` : null,
    compact(input.lead?.status) ? `Статус лида: ${input.lead?.status}` : null,
    leadCountry(input) ? `Целевая страна: ${leadCountry(input)}` : null,
    priceFact(input) ? `CRM-ориентир суммы: ${priceFact(input)}` : null,
    compact(input.lead?.notes) ? `Заметка менеджера: ${input.lead?.notes}` : null,
    latest ? `Последнее входящее: ${latest.text}` : null,
  ].filter((fact): fact is string => Boolean(fact));
}

function chooseScenario(input: PreparedWhatsAppInput): PreparedAiScenarioId {
  const latestText = lastInbound(input.messages)?.text.toLocaleLowerCase("ru-RU") ?? "";
  if (/(сколько|стоим|цен|прайс|оплат|услуг)/i.test(latestText)) return "price-boundary";
  if (/(консультац|встреч|созвон|когда|удобно)/i.test(latestText)) return "consultation-booking";
  if (/(документ|аттестат|сертификат|ielts|паспорт|перевод)/i.test(latestText)) return "documents-next-step";
  return leadCountry(input) ? "program-fit" : "consultation-booking";
}

function responseForScenario(id: PreparedAiScenarioId, input: PreparedWhatsAppInput): string {
  const name = contactName(input);
  const country = leadCountry(input);
  const price = priceFact(input);

  if (id === "price-boundary") {
    const priceLine = price
      ? `В CRM указан ориентир по сумме ${price}, но финальную стоимость и состав пакета менеджер подтвердит после короткой консультации.`
      : "Финальную стоимость и состав пакета менеджер подтвердит после короткой консультации.";
    const countryLine = country ? `По направлению ${country} сначала уточним ваш профиль и сроки поступления.` : "Сначала уточним ваш профиль и сроки поступления.";
    return `${name}, здравствуйте! ${priceLine} ${countryLine} Подскажите, пожалуйста, в каком вы сейчас классе или на каком курсе?`;
  }

  if (id === "consultation-booking") {
    const countryLine = country ? `по ${country}` : "по вашему направлению";
    return `${name}, добрый день! Можем начать с консультации ${countryLine}: разберём цель, бюджет, сроки и документы. Напишите, пожалуйста, когда вам удобно созвониться сегодня или завтра.`;
  }

  if (id === "documents-next-step") {
    return `${name}, для первого разбора обычно нужны паспорт, аттестат или транскрипт, языковой сертификат при наличии и краткая цель по стране/программе. Отправьте, пожалуйста, что уже есть, а менеджер отметит недостающие документы.`;
  }

  const countryLine = country ? `по ${country}` : "по подходящей стране";
  return `${name}, спасибо за детали. Чтобы подобрать программы ${countryLine}, уточните, пожалуйста: текущий класс или курс, желаемый год поступления и уровень английского. После этого менеджер предложит ближайшие реалистичные шаги.`;
}

function scenario(id: PreparedAiScenarioId, input: PreparedWhatsAppInput): PreparedAiScenarioResponse {
  const promptIdByScenario: Record<PreparedAiScenarioId, string> = {
    "price-boundary": "wa-price-boundary",
    "consultation-booking": "wa-consultation-booking",
    "program-fit": "wa-program-fit",
    "documents-next-step": "wa-documents-next-step",
  };
  const triggerByScenario: Record<PreparedAiScenarioId, string> = {
    "price-boundary": "Последнее сообщение или CRM-контекст содержит вопрос о цене.",
    "consultation-booking": "Нужно перевести диалог к консультации без выдуманных слотов.",
    "program-fit": "Нужно собрать вводные для подбора страны, программы и intake.",
    "documents-next-step": "Нужно дать стартовый список документов без фальшивой проверки.",
  };
  return {
    id,
    title: SCENARIO_TITLES[id],
    promptId: promptIdByScenario[id],
    trigger: triggerByScenario[id],
    response: responseForScenario(id, input),
    checks: [
      "Prepared content for first presentation",
      "Uses current CRM conversation context",
      "Does not claim live Anthropic generation",
      "Does not claim WhatsApp delivery",
    ],
  };
}

export function buildPreparedWhatsAppAssistant(input: PreparedWhatsAppInput): PreparedAiBundle {
  const scenarioIds: PreparedAiScenarioId[] = [
    "price-boundary",
    "consultation-booking",
    "program-fit",
    "documents-next-step",
  ];

  return {
    mode: "prepared_first_presentation",
    label: "Prepared AI",
    selectedScenarioId: chooseScenario(input),
    promptLibrary: PREPARED_AI_PROMPT_LIBRARY,
    scenarios: scenarioIds.map((id) => scenario(id, input)),
    facts: buildFacts(input),
  };
}
