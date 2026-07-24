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
    title: "Границы ответа о стоимости",
    purpose: "Ответить на вопрос о стоимости, не выдумывая условия и не обещая лишнего.",
    instructions: [
      "Использовать только факты из диалога и связанного лида в CRM.",
      "Уточнить, что итоговую стоимость менеджер подтвердит после квалификации.",
      "Задать один конкретный вопрос о следующем шаге.",
    ],
  },
  {
    id: "wa-consultation-booking",
    title: "Запись на консультацию",
    purpose: "Перевести квалифицированного лида к выбору времени консультации.",
    instructions: [
      "Подтвердить выбранную страну или цель по программе.",
      "Сделать ответ достаточно коротким для WhatsApp.",
      "Предложить консультацию, не выдумывая свободные слоты, которых нет в CRM.",
    ],
  },
  {
    id: "wa-program-fit",
    title: "Уточнение профиля для подбора",
    purpose: "Собрать недостающие данные для подбора страны и программы.",
    instructions: [
      "Уточнить текущий класс или уровень образования, желаемый набор и знание языка.",
      "Упоминать целевую страну, только если она указана в CRM.",
      "Не обещать вероятность поступления.",
    ],
  },
  {
    id: "wa-documents-next-step",
    title: "Следующий шаг по документам",
    purpose: "Объяснить первую проверку документов, не создавая видимость уже проведённой проверки.",
    instructions: [
      "Назвать типичные первые документы только как стартовый список.",
      "Попросить клиента отправить то, что у него уже есть.",
      "Не утверждать, что файлы проверены, если этого нет в CRM.",
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
    "program-fit": "Нужно собрать вводные для подбора страны, программы и набора.",
    "documents-next-step": "Нужно дать стартовый список документов без фальшивой проверки.",
  };
  return {
    id,
    title: SCENARIO_TITLES[id],
    promptId: promptIdByScenario[id],
    trigger: triggerByScenario[id],
    response: responseForScenario(id, input),
    checks: [
      "Подготовленный материал для первой презентации",
      "Использует текущий контекст диалога из CRM",
      "Не выдаётся за результат живого запроса к Anthropic",
      "Не утверждает, что сообщение доставлено в WhatsApp",
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
    label: "Подготовленный AI",
    selectedScenarioId: chooseScenario(input),
    promptLibrary: PREPARED_AI_PROMPT_LIBRARY,
    scenarios: scenarioIds.map((id) => scenario(id, input)),
    facts: buildFacts(input),
  };
}
