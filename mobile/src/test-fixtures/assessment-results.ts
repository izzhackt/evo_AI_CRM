// Синтетические завершённые попытки тестов для экрана результата (G60, G61): все поля, которые показывает сайт (названия шкал и
// описания, профессии с источником, подписи навыков, ограничения). Тексты придуманы, настоящего содержания тестов здесь нет.
export const RESULT_ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
export const RESULT_VERSION_ID = "55555555-5555-4555-8555-555555555555";

const LIMITS = ["Ограничение один: это не сертификат.", "Ограничение два: результат личный."];

/** Десять заданий: грамматика 4 (3 верно), слова 4 (1 верно), чтение 2 (2 верно). Первое задание - с текстом для чтения. */
export function completedEnglish() {
  const topics = ["grammar", "grammar", "grammar", "grammar", "vocabulary", "vocabulary", "vocabulary", "vocabulary", "reading", "reading"];
  const correctIds = new Set(["e1", "e2", "e3", "e5", "e9", "e10"]);
  const questions = topics.map((topic, i) => ({
    id: `e${i + 1}`,
    prompt: `Choose the answer ${i + 1}`,
    options: [
      { id: "a", label: `alpha ${i + 1}` },
      { id: "b", label: `beta ${i + 1}` },
      { id: "unknown", label: "Не знаю" },
    ],
    topic,
    ...(i === 0 ? { passage: "A short passage for the first task." } : {}),
  }));
  const answers = Object.fromEntries(questions.map((q) => [q.id, correctIds.has(q.id) ? "a" : "b"]));
  const metadata = {
    title: "Английский",
    description: "Описание теста",
    instructions: ["Инструкция"],
    limitations: LIMITS,
    bands: [
      { id: "basic", label: "Базовый результат на этом тесте" },
      { id: "developing", label: "Развивающийся результат на этом тесте" },
    ],
    recommendations: { grammar: "Совет по грамматике.", vocabulary: "Совет по словам.", reading: "Совет по чтению." },
    // Подпись навыка есть только у первого задания: у остальных подпись берётся по теме.
    blueprint: [{ questionId: "e1", skill: "present-simple" }],
    skillLabels: { "present-simple": "Регулярные действия: Present Simple" },
  };
  return {
    attemptId: RESULT_ATTEMPT_ID,
    instrumentKey: "english36",
    versionId: RESULT_VERSION_ID,
    version: "1.0.0",
    locale: "ru",
    status: "completed",
    revision: 4,
    metadata,
    questions,
    answers,
    result: {
      instrumentKey: "english36",
      version: "1.0.0",
      metadata,
      answeredCount: 10,
      questionCount: 10,
      completedAt: "2026-11-09T22:05:00+00:00",
      english: {
        correctCount: 6,
        totalCount: 10,
        band: "developing",
        topics: [
          { topic: "grammar", correctCount: 3, totalCount: 4 },
          { topic: "vocabulary", correctCount: 1, totalCount: 4 },
          { topic: "reading", correctCount: 2, totalCount: 2 },
        ],
        feedback: questions.map((q) => ({
          questionId: q.id,
          selectedOptionId: answers[q.id],
          correctOptionId: "a",
          correct: correctIds.has(q.id),
          explanation: `Разбор задания ${q.id}.`,
          topic: q.topic,
        })),
      },
    },
    createdAt: "2026-11-09T09:00:00+00:00",
    updatedAt: "2026-11-09T22:05:00+00:00",
    completedAt: "2026-11-09T22:05:00+00:00",
  };
}

const SCALES = ["leadership", "organization", "altruism", "creativity", "analysis", "production", "adventure", "erudition"] as const;
/** Средние: анализ и эрудиция выше всех, остальные ниже; порядок сервера нарочно не по убыванию. */
const MEANS: Record<(typeof SCALES)[number], number> = { leadership: 2.0, organization: 1.5, altruism: 3.25, creativity: 2.75, analysis: 4.5, production: 3.0, adventure: 1.25, erudition: 4.0 };
/** Русские названия из содержания (у приложения в словаре другие, короче): по ним видно, откуда взята подпись. */
const CONTENT_LABELS: Record<(typeof SCALES)[number], string> = {
  leadership: "Лидерство и влияние (содержание)",
  organization: "Организация и порядок (содержание)",
  altruism: "Помощь людям (содержание)",
  creativity: "Творчество (содержание)",
  analysis: "Анализ и исследование (содержание)",
  production: "Практическая работа и создание (содержание)",
  adventure: "Активность и приключения (содержание)",
  erudition: "Языки и гуманитарные интересы (содержание)",
};

function profession(id: string, title: string, scaleIds: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    scaleIds,
    summary: `Краткое описание: ${title}.`,
    tasks: [`Задача один: ${title}.`, `Задача два: ${title}.`],
    skills: ["Навык А", "Навык Б"],
    studyDirections: ["Направление А", "Направление Б"],
    tryActivity: `Попробуйте задание для профессии ${title}.`,
    editorialNote: `Редакционная связь: ${title}.`,
    source: { url: `https://onet.example.test/${id}`, occupationId: `00-${id.length}000.00`, version: "O*NET 31.0", retrievedOn: "2026-09-09", license: "CC BY 4.0", licenseUrl: "https://license.example.test/by" },
    ...extra,
  };
}

/** Восемь утверждений (по одному на шкалу), четыре профессии: две под лучшие шкалы (анализ, эрудиция), две нет. */
export function completedCareer() {
  const questions = SCALES.map((scale, i) => ({
    id: `o${i + 1}`,
    prompt: `Утверждение ${i + 1}`,
    options: [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: `Вариант ${n}` })),
  }));
  const answers = Object.fromEntries(questions.map((q) => [q.id, "3"]));
  const metadata = {
    title: "Профориентация",
    description: "Описание теста",
    instructions: ["Инструкция"],
    limitations: LIMITS,
    scales: SCALES.map((id) => ({ id, label: CONTENT_LABELS[id], description: `Пояснение к шкале: ${id}.` })),
    professionAttribution: "Использованы сведения O*NET (синтетическая пометка для теста).",
    professions: [
      profession("data-analyst", "Аналитик данных", ["analysis"], { careerPath: ["Стажёр", "Аналитик", "Ведущий аналитик"] }),
      profession("translator", "Переводчик", ["erudition"]),
      profession("manager", "Менеджер проектов", ["leadership"]),
      profession("teacher", "Учитель", ["altruism"]),
    ],
  };
  return {
    attemptId: RESULT_ATTEMPT_ID,
    instrumentKey: "orvis92",
    versionId: RESULT_VERSION_ID,
    version: "1.0.0",
    locale: "ru",
    status: "completed",
    revision: 4,
    metadata,
    questions,
    answers,
    result: {
      instrumentKey: "orvis92",
      version: "1.0.0",
      metadata,
      answeredCount: 8,
      questionCount: 8,
      completedAt: "2026-11-09T22:05:00+00:00",
      orvis: { scales: SCALES.map((scale) => ({ scale, rawSum: Math.round(MEANS[scale] * 10), itemCount: 10, mean: MEANS[scale] })), topScales: ["analysis", "erudition"] },
    },
    createdAt: "2026-11-09T09:00:00+00:00",
    updatedAt: "2026-11-09T22:05:00+00:00",
    completedAt: "2026-11-09T22:05:00+00:00",
  };
}
