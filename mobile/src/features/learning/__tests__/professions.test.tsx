// «Профессии» как на сайте (#1446, #1447): «Подходят вам», поиск и группы, «Где учиться в EVO» с ценой,
// набором и избранным. Чтения идут по настоящему пути приложения (RPC-слой, разборщики веба) на поддельном
// транспорте; данные синтетические.
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { topProfessionMatches } from "@web/lib/portal/profession-guide";
import { parseProfessionCards } from "@web/lib/portal/professions";
import { parseStudentUniversityIndexResponse } from "@web/lib/portal/university-index";

import { loadProfessionPrograms } from "@/features/learning/professions/api";
import { institutionIdsForRefs, monthLabel, orvisProfileFromAttempt, resolveProgramRows, tuitionLabel } from "@/features/learning/professions/model";
import { ProfessionCardScreen } from "@/features/learning/professions/ProfessionCardScreen";
import { ProfessionsScreen } from "@/features/learning/professions/ProfessionsScreen";
import { normalizeAssessmentAttempt } from "@/features/learning/tests/assessment-decode";
import { RpcError } from "@/lib/rpc";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport, universityContent, uuidN } from "@/test-fixtures/universities";
import { indexBody } from "@/test-fixtures/university-index";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn() },
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => false, navigate: jest.fn() }),
}));
jest.mock("@/config", () => ({ getConfig: () => ({ supabaseUrl: "http://localhost:46421", supabasePublishableKey: "k", portalBaseUrl: "http://localhost:46430" }) }));
jest.mock("expo-file-system", () => {
  const files = new Map<string, string>();
  class Directory {
    exists = true;
    create() {}
    delete() {
      files.clear();
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : "dir")).join("/");
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.set(this.uri, "");
    }
    write(text: string) {
      files.set(this.uri, text);
    }
    async text() {
      return files.get(this.uri) ?? "";
    }
    delete() {
      files.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: "cache" }, __files: files };
});

beforeEach(() => {
  jest.requireMock("expo-file-system").__files.clear();
  jest.mocked(router.navigate).mockClear();
});

const CARD_A = uuidN(1, "dddddddd");
const CARD_B = uuidN(2, "dddddddd");
const CARD_C = uuidN(3, "dddddddd");
const CARD_D = uuidN(4, "dddddddd");
const CARD_E = uuidN(5, "dddddddd");
const ATTEMPT = uuidN(7, "eeeeeeee");

const summary = (id: string, key: string, ru: string, scales: string[], summaryRu: string | null = null) => ({
  cardId: id, cardKey: key, version: "1.1.0", titleRu: ru, titleKy: `${ru} (ky)`, orvisScales: scales, summaryRu, summaryKy: summaryRu ? `${summaryRu} (ky)` : null,
});

const CARDS = {
  cards: [
    summary(CARD_A, "analyst", "Аналитик данных", ["analysis", "erudition"], "Ищет закономерности в данных."),
    summary(CARD_B, "designer", "Дизайнер", ["creativity"]),
    summary(CARD_C, "engineer", "Инженер", ["production", "analysis"]),
    summary(CARD_D, "teacher", "Учитель", ["altruism"]),
    summary(CARD_E, "manager", "Менеджер", ["leadership", "organization"]),
  ],
};

/** Завершённый orvis92 с высоким интересом к анализу и эрудиции; остальные шкалы низкие. */
function orvisAttempt() {
  const questions = Array.from({ length: 92 }, (_, i) => ({ id: `q${i}`, prompt: `Утверждение ${i}`, options: [{ id: "a", label: "Да" }, { id: "b", label: "Нет" }] }));
  const mean: Record<string, number> = { analysis: 4.8, erudition: 4.4, production: 3.2, creativity: 2, altruism: 1.5, leadership: 1.2, organization: 1.4, adventure: 1 };
  return {
    attemptId: ATTEMPT, instrumentKey: "orvis92", versionId: uuidN(8, "eeeeeeee"), version: "1", locale: "ru", status: "completed", revision: 3,
    metadata: { title: "Тест интересов", description: "Синтетический", instructions: ["Отвечайте"], limitations: ["Ориентир"] },
    questions, answers: Object.fromEntries(questions.map((q) => [q.id, "a"])),
    result: {
      instrumentKey: "orvis92", version: "1", answeredCount: 92, questionCount: 92, completedAt: "2026-11-01T10:00:00+00:00",
      metadata: { title: "Тест интересов", description: "Синтетический", instructions: ["Отвечайте"], limitations: ["Ориентир"] },
      orvis: { scales: Object.entries(mean).map(([scale, m]) => ({ scale, rawSum: Math.round(m * 10), itemCount: 10, mean: m })), topScales: ["analysis", "erudition"] },
    },
    createdAt: "2026-11-01T09:00:00+00:00", updatedAt: "2026-11-01T10:00:00+00:00", completedAt: "2026-11-01T10:00:00+00:00",
  };
}

const catalogWithTest = {
  instruments: [{ instrumentKey: "orvis92", versionId: uuidN(8, "eeeeeeee"), version: "1", locale: "ru", metadata: { title: "Тест интересов", description: "Синтетический", instructions: ["Отвечайте"], limitations: ["Ориентир"] }, questionCount: 92, draftAttemptId: null, latestCompletedAttemptId: ATTEMPT }],
  attempts: [],
};
const catalogNoTest = { instruments: [{ ...catalogWithTest.instruments[0], latestCompletedAttemptId: null }], attempts: [] };

const baseHandlers = (withTest: boolean) => ({
  profession_cards_v1: CARDS,
  student_assessments_v1: withTest ? catalogWithTest : catalogNoTest,
  student_assessment_attempt_v1: orvisAttempt(),
});

describe("модель: профиль теста и «Подходят вам»", () => {
  it("профиль собирается из шкал собственной попытки; нет шкал или попытки - null", () => {
    const profile = orvisProfileFromAttempt(normalizeAssessmentAttempt(orvisAttempt()));
    expect(profile?.means.analysis).toBe(4.8);
    expect(profile?.topScales).toEqual(["analysis", "erudition"]);
    expect(orvisProfileFromAttempt(null)).toBeNull();
    expect(orvisProfileFromAttempt(undefined)).toBeNull();
  });

  it("три лучших совпадения с процентом по формуле веба", () => {
    const profile = orvisProfileFromAttempt(normalizeAssessmentAttempt(orvisAttempt()))!;
    const top = topProfessionMatches(parseProfessionCards(CARDS), profile);
    expect(top.map((match) => match.card.cardKey)).toEqual(["analyst", "engineer", "designer"]);
    // analysis 4.8 и erudition 4.4: ((3.8 + 3.4) / 2) / 4 = 90 %.
    expect(top[0]?.percent).toBe(90);
    expect(top[0]?.reasons).toEqual(["analysis", "erudition"]);
  });
});

const REF_FOUND = { institution_photo_key: "apu", program_hint: "Информатика" };
const REF_NO_PROGRAM = { institution_photo_key: "apu", program_hint: "Нет такой программы" };
const REF_NO_UNI = { institution_photo_key: "sunway-x", program_hint: "Информатика" };

function detail(extra: Record<string, unknown> = {}) {
  return {
    university: { id: uuidN(1), version: 3, publishedAt: "2026-10-01T00:00:00+00:00", content: { ...universityContent("Университет Зета"), photoKey: "apu" } },
    country: { code: "MY", name: { ru: "Малайзия", ky: "Малайзия (ky)" } },
    city: null,
    favored: false,
    openConsultation: null,
    preparations: null,
    costs: {
      rows: [
        { id: uuidN(50), kind: "tuition", period: "year", studyLevel: "bachelor", programId: null, teachingLanguage: "en", currency: "MYR", exponent: 2, amountMinMinor: 3500000, amountMaxMinor: null, usdApproxMin: 7500, usdApproxMax: null, academicYear: "2026/27", note: null, source: { kind: "agency", url: null }, verifiedOn: "2026-10-16" },
      ],
      fxRates: [{ currency: "MYR", unitsPerUsd: 4.67, asOf: "2026-10-16", sourceName: "Central Bank of Malaysia" }],
    },
    ...extra,
  };
}

const CARD_BODY = {
  cardId: CARD_A, cardKey: "analyst", version: "1.1.0",
  body: {
    id: "analyst", title_ru: "Аналитик данных", title_ky: "Маалымат талдоочу", orvis_scales: ["analysis", "erudition"],
    day_in_work_ru: "Разбирает таблицы и строит выводы.", day_in_work_ky: "Таблицаларды талдайт.",
    environment_ru: "Офис или дом.", environment_ky: "Кеңсе.",
    skills_ru: ["Статистика"], skills_ky: ["Статистика (ky)"],
    interesting_ru: ["Находить закономерности"], interesting_ky: ["Мыйзам ченемдүүлүк"],
    hard_ru: ["Рутина"], hard_ky: ["Рутина (ky)"],
    trial_task_ru: "Разберите таблицу продаж.", trial_task_ky: "Таблица.",
    study_directions_ru: ["Информатика"], study_directions_ky: ["Информатика (ky)"],
    linked_program_refs: [REF_FOUND, REF_NO_PROGRAM, REF_NO_UNI],
    sources: ["https://example.org/onet"],
    summary_ru: "Ищет закономерности в данных.", summary_ky: "Маалыматтарда мыйзам ченемдүүлүктү издейт.",
    school_subjects_ru: ["Математика"], school_subjects_ky: ["Математика (ky)"],
  },
};

describe("модель: «Где учиться в EVO»", () => {
  const index = parseStudentUniversityIndexResponse(indexBody("v1"));
  const universities = index && !index.notModified ? index.index.universities : [];
  const parsed = (value: unknown) => {
    const { transport } = fakeTransport({ student_university_detail_v1: value });
    return loadProfessionPrograms(transport, [REF_FOUND, REF_NO_PROGRAM, REF_NO_UNI], universities, new Date("2026-11-18T12:00:00Z"));
  };

  it("вуз ищется по ключу фото; повторы и чужие ключи не читаются", () => {
    expect(institutionIdsForRefs([REF_FOUND, REF_NO_PROGRAM, REF_NO_UNI], universities)).toEqual([uuidN(1)]);
  });

  it("цена, ближайший набор, избранное и честные строки без вуза и без программы", async () => {
    const rows = await parsed(detail({ favored: true }));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ institutionId: uuidN(1), programFound: true, favored: true, nextStartMonth: "2027-09" });
    expect(rows[0]?.tuition).toMatchObject({ currency: "MYR", usdMin: 7500 });
    expect(rows[1]).toMatchObject({ institutionId: uuidN(1), programFound: false, nextStartMonth: null });
    expect(rows[2]).toMatchObject({ institutionId: null, countryName: null, tuition: null });
  });

  it("вуз снят с публикации (42501) - строка без ссылки; иной сбой поднимается", async () => {
    const gone = fakeTransport({ student_university_detail_v1: failure("42501", 403) });
    const rows = await loadProfessionPrograms(gone.transport, [REF_FOUND], universities, new Date());
    expect(rows[0]).toMatchObject({ institutionId: null, programFound: false });
    const broken = fakeTransport({ student_university_detail_v1: new RpcError("server", "500", 500) });
    await expect(loadProfessionPrograms(broken.transport, [REF_FOUND], universities, new Date())).rejects.toBeTruthy();
    expect(await loadProfessionPrograms(broken.transport, [], universities, new Date())).toEqual([]);
  });

  it("подписи: валюта вуза с ориентиром USD, USD как есть, месяц набора на двух языках", () => {
    const tuition = { currency: "MYR", exponent: 2, minMinor: 3500000, maxMinor: null, usdMin: 7500, usdMax: null };
    expect(tuitionLabel(tuition, "ru", "≈ {amount}")).toBe("≈ $7\u00a0500");
    expect(tuitionLabel({ ...tuition, currency: "EUR", usdMin: null }, "ru", "≈ {amount}")).toBe("35\u00a0000 EUR");
    expect(tuitionLabel({ currency: "USD", exponent: 0, minMinor: 3000, maxMinor: 4200, usdMin: 3000, usdMax: 4200 }, "ru", "≈ {amount}")).toBe("$3\u00a0000–4\u00a0200");
    expect(monthLabel("2027-09", "ru")).toBe("Сентябрь 2027");
    expect(resolveProgramRows([REF_FOUND], [], new Date())[0]?.institutionName).toBeNull();
  });
});

describe("экран «Профессии»", () => {
  it("«Подходят вам»: три карточки с процентом и причиной, справка раскрывается, карточка открывается", async () => {
    const { transport } = fakeTransport(baseHandlers(true));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByTestId("profession-matches")).toBeTruthy();
    expect(screen.getByTestId("match-percent-analyst").props.children.join("")).toBe("90%");
    expect(screen.getAllByTestId(/^match-[a-z]+$/)).toHaveLength(3);
    expect(screen.getByText("Сильные стороны: Анализ, Эрудиция")).toBeTruthy();
    expect(screen.queryByTestId("matches-help")).toBeNull();
    await fireEvent.press(screen.getByTestId("matches-help-toggle"));
    expect(screen.getByTestId("matches-help")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("match-analyst"));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/professions/[cardId]", params: { cardId: CARD_A } });
  });

  it("без пройденного теста блока «Подходят вам» нет; фильтр по интересу его тоже прячет", async () => {
    const none = fakeTransport(baseHandlers(false));
    await renderPortal(<ProfessionsScreen />, testApi(none.transport));
    expect(await screen.findByTestId("profession-analyst")).toBeTruthy();
    expect(screen.queryByTestId("profession-matches")).toBeNull();
  });

  it("группы по основной шкале с числом профессий, поиск по названию и строке о работе", async () => {
    const { transport } = fakeTransport(baseHandlers(true));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByTestId("group-analysis")).toBeTruthy();
    expect(screen.getByTestId("group-creativity")).toBeTruthy();
    expect(screen.getAllByText("1 профессия").length).toBeGreaterThan(0);
    await fireEvent.changeText(screen.getByTestId("professions-search"), "закономерност");
    await waitFor(() => expect(screen.queryByTestId("profession-designer")).toBeNull());
    expect(screen.getByTestId("profession-analyst")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("professions-search"), "zzz");
    expect(await screen.findByTestId("professions-search-empty")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("professions-search"), "");
    await fireEvent.press(await screen.findByTestId("filter-altruism"));
    expect(screen.queryByTestId("profession-matches")).toBeNull();
    expect(screen.getByTestId("profession-teacher")).toBeTruthy();
    expect(screen.queryByTestId("profession-analyst")).toBeNull();
  });

  it("KY: заголовки и названия на кыргызском", async () => {
    const { transport } = fakeTransport(baseHandlers(true));
    await renderPortal(<ProfessionsScreen />, testApi(transport), "ky");
    expect(await screen.findByText("Сизге туура келет")).toBeTruthy();
    expect(screen.getAllByText("Аналитик данных (ky)").length).toBeGreaterThan(0);
  });
});

describe("экран профессии: «Где учиться в EVO»", () => {
  const handlers = (extra: Record<string, unknown> = {}) => ({
    profession_card_v1: CARD_BODY,
    student_university_index_v1: indexBody(),
    student_university_detail_v1: detail(),
    student_university_favorites_v1: [],
    set_university_favorite_v1: { institutionId: uuidN(1), favored: true, favoritesCount: 1 },
    ...extra,
  });

  it("программы: вуз-ссылка, цена, набор, страна; строки без вуза и без программы с пояснением", async () => {
    const t = fakeTransport(handlers());
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(t.transport));
    expect(await screen.findByTestId("profession-programs")).toBeTruthy();
    expect(screen.getAllByText("Университет Зета")).toHaveLength(2);
    expect(screen.getByText("≈ $7\u00a0500")).toBeTruthy();
    expect(screen.getByText("Сентябрь 2027")).toBeTruthy();
    expect(screen.getAllByText("Малайзия").length).toBeGreaterThan(0);
    expect(screen.getByText(/Точной программы в карточке вуза сейчас нет/)).toBeTruthy();
    expect(screen.getByText(/Вуза с этой программой сейчас нет в каталоге/)).toBeTruthy();
    // Предметы, навыки и итог «чем занимается» на странице; «Подробнее» свёрнуто.
    expect(screen.getByText("• Математика")).toBeTruthy();
    expect(screen.getByTestId("profession-summary")).toBeTruthy();
    expect(screen.queryByTestId("profession-more")).toBeNull();
    await fireEvent.press(screen.getByTestId("profession-more-toggle"));
    expect(screen.getByText("Разберите таблицу продаж.")).toBeTruthy();
    // Вуз открывается карточкой каталога.
    await fireEvent.press(screen.getAllByTestId(`program-uni-${uuidN(1)}`)[0]!);
    expect(router.push).toHaveBeenCalledWith(`/universities/${uuidN(1)}`);
  });

  it("избранное: сердечко пишет состояние вуза и меняет подпись", async () => {
    const t = fakeTransport(handlers());
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(t.transport));
    await screen.findByTestId("profession-programs");
    // Две связи ведут в один вуз: сердечек два, состояние у них общее.
    const hearts = await screen.findAllByTestId(`program-fav-${uuidN(1)}`);
    expect(hearts).toHaveLength(2);
    const heart = hearts[0]!;
    expect(heart.props.accessibilityLabel).toBe("В избранное — Университет Зета");
    await fireEvent.press(heart);
    await waitFor(() => expect(t.calls.some((c) => c.name === "set_university_favorite_v1")).toBe(true));
    expect(t.calls.find((c) => c.name === "set_university_favorite_v1")?.args).toEqual({ p_institution_id: uuidN(1), p_favored: true });
    await waitFor(() => expect(screen.getAllByTestId(`program-fav-${uuidN(1)}`).map((n) => n.props.accessibilityLabel)).toEqual(Array(2).fill("Убрать из избранного — Университет Зета")));
  });

  it("каталог недоступен: направления остаются текстом, как на сайте", async () => {
    const t = fakeTransport(handlers({ student_university_index_v1: failure("500", 500) }));
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(t.transport));
    expect(await screen.findByTestId("profession-directions")).toBeTruthy();
    expect(screen.getByText("• Информатика")).toBeTruthy();
    expect(screen.queryByTestId("profession-programs")).toBeNull();
  });
});
