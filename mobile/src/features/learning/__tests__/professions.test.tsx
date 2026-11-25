// «Профессии» как на сайте (#1446, #1447): «Подходят вам», поиск и группы, «Где учиться в EVO» с ценой,
// набором и избранным. Чтения идут по настоящему пути приложения (RPC-слой, разборщики веба) на поддельном
// транспорте; данные синтетические.
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { AccessibilityInfo, Alert, Platform } from "react-native";

import { getPortalStrings } from "@web/lib/portal/i18n";
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

// Что сейчас в стеке «Профессий»: по нему вход в Эви решает, класть ли экран или вернуться к уже открытому.
let mockStackRoutes: { name: string }[] = [{ name: "index" }];
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ getState: () => ({ routes: mockStackRoutes }) }),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, setParams: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn() },
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => false, navigate: jest.fn() }),
}));
// Робот входа в Эви стоит (он неподвижный), но тема точек и лиц не мешает проверкам списка.
jest.mock("@/ui/useReduceMotion", () => ({ useReduceMotion: () => true }));
type RobotProps = { testID?: string; face: string; settled?: boolean; still?: boolean; size?: number };
const mockRobots: RobotProps[] = [];
jest.mock("@/features/learning/evi/EviRobot", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    ...jest.requireActual("@/features/learning/evi/EviRobot"),
    EviRobot: (props: RobotProps) => {
      mockRobots.push({ ...props });
      return React.createElement(View, { testID: props.testID ?? "evi-robot", accessibilityElementsHidden: true });
    },
  };
});
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

// Есть ли у сервера ключ Эви: ответ GET того же маршрута. Сети нет - подмена `fetch` на границе приложения.
const eviAnswer = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
let eviFetch: () => Promise<Response> = eviAnswer({ available: true });
const realFetch = globalThis.fetch;
const fetchMock = jest.fn((_url: string, _init?: RequestInit) => eviFetch());
beforeEach(() => {
  jest.requireMock("expo-file-system").__files.clear();
  jest.mocked(router.navigate).mockClear();
  jest.mocked(router.dismissTo).mockClear();
  mockStackRoutes = [{ name: "index" }];
  mockRobots.length = 0;
  eviFetch = eviAnswer({ available: true });
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
// Запросы, которые экран не дожидался (ключ Эви, избранное), доигрывают внутри act, пока экран ещё на месте.
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  jest.restoreAllMocks();
});
afterAll(() => {
  globalThis.fetch = realFetch;
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

// ---------------------------------------------------------------------------------------------------------------------------------
// 25.11.2026: верх «Профессий» как на вебе, фото профессий, без отметки «созвучно», избранное строкой

const GRANTED = { status: "granted", policyVersion: "2026-10-25", decidedAt: "2026-11-01T10:00:00Z", currentPolicyVersion: "2026-10-25" };
const DECLINED = { ...GRANTED, status: "declined" };
const withConsent = (consent: unknown, handlers: Record<string, unknown>) => ({ portal_ai_consent_get_v1: consent, ...handlers });
const heroRobot = () => [...mockRobots].reverse().find((props) => props.testID === "evi-hero-robot");

describe("верх «Профессий»: вход в Эви или карточка теста", () => {
  it("есть ключ на сервере и согласие: вход в Эви (робот, «Подбор с Эви», «Не знаешь, кем стать?»), карточки теста сверху нет", async () => {
    const { transport } = fakeTransport(withConsent(GRANTED, baseHandlers(true)));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByTestId("professions-evi-open")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByText("Подбор с Эви")).toBeTruthy();
    expect(screen.getByText("Не знаешь, кем стать?")).toBeTruthy();
    expect(screen.getByText("Несколько вопросов — и три профессии из каталога")).toBeTruthy();
    expect(screen.getByText("Поговорить с Эви")).toBeTruthy();
    expect(heroRobot()).toMatchObject({ face: "happy", settled: true, still: true, size: 56 });
    expect(screen.queryByTestId("professions-test-open")).toBeNull();
    expect(screen.queryByText("Тест интересов")).toBeNull();
  });

  it("вопрос к серверу один: GET к порталу с Bearer, без тела и без чужих заголовков", async () => {
    const { transport } = fakeTransport(withConsent(GRANTED, baseHandlers(true)));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByTestId("professions-evi-open");
    await act(async () => undefined);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://portal.example.test/api/portal/mobile/evi");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({ Accept: "application/json", Authorization: "Bearer synthetic-token" });
  });

  it("на сервере нет ключа Эви: вместо входа в Эви - карточка теста, как на вебе", async () => {
    eviFetch = eviAnswer({ available: false });
    const { transport } = fakeTransport(withConsent(GRANTED, baseHandlers(false)));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByTestId("professions-test-open")).toBeTruthy();
    expect(screen.queryByTestId("professions-evi-open")).toBeNull();
    expect(screen.getByText("Не знаешь, кем стать?")).toBeTruthy();
    expect(screen.queryByText("Подбор с Эви")).toBeNull();
  });

  it("согласие на ИИ-помощников отозвано: карточка теста, Эви не предлагается (как на вебе), даже если ключ есть", async () => {
    const { transport } = fakeTransport(withConsent(DECLINED, baseHandlers(false)));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByTestId("professions-test-open")).toBeTruthy();
    expect(screen.queryByTestId("professions-evi-open")).toBeNull();
  });

  it("не удалось узнать про ключ (старый сервер без GET, сбой сети, чужой ответ): Эви предлагается, как раньше", async () => {
    const outcomes: [string, () => Promise<Response>][] = [
      ["405 (маршрут только для POST)", eviAnswer({ error: "method_not_allowed" }, 405)],
      ["404", eviAnswer({}, 404)],
      ["500", eviAnswer({}, 500)],
      ["не та форма", eviAnswer({ available: "yes" })],
      ["не JSON", async () => new Response("<html>", { status: 200 })],
      ["обрыв сети", async () => { throw new TypeError("network"); }],
    ];
    for (const [, answer] of outcomes) {
      eviFetch = answer;
      fetchMock.mockClear();
      const { transport } = fakeTransport(withConsent(GRANTED, baseHandlers(false)));
      const view = await renderPortal(<ProfessionsScreen />, testApi(transport));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      await screen.findByTestId("professions-evi-open");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.getByTestId("professions-evi-open")).toBeTruthy();
      expect(screen.queryByTestId("professions-test-open")).toBeNull();
      await view.unmount();
    }
  });

  it("чтение согласия не удалось: Эви не прячется (сервер проверит согласие сам)", async () => {
    const { transport } = fakeTransport(withConsent(failure("XX000", 500), baseHandlers(false)));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByTestId("professions-evi-open")).toBeTruthy();
  });

  it("вход в Эви: экран кладётся поверх каталога; если Эви уже в стеке (под другими экранами) - возврат к ней, второй не кладётся", async () => {
    const { transport } = fakeTransport(withConsent(GRANTED, baseHandlers(false)));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("professions-evi-open"));
    expect(router.navigate).toHaveBeenCalledWith("/professions/evi");
    expect(router.dismissTo).not.toHaveBeenCalled();
    jest.mocked(router.navigate).mockClear();
    mockStackRoutes = [{ name: "index" }, { name: "evi" }, { name: "index" }];
    await fireEvent.press(screen.getByTestId("professions-evi-open"));
    expect(router.dismissTo).toHaveBeenCalledWith("/professions/evi");
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("kyrgyz: подписи входа в Эви из общего словаря", async () => {
    const { transport } = fakeTransport(withConsent(GRANTED, baseHandlers(false)));
    await renderPortal(<ProfessionsScreen />, testApi(transport), "ky");
    const ky = getPortalStrings("professions", "ky");
    expect(await screen.findByText(ky["evi.heroAction"])).toBeTruthy();
    expect(screen.getByText(ky["tab.evi"])).toBeTruthy();
    expect(screen.getByText(ky.testTitle)).toBeTruthy();
    expect(screen.getByText(ky["evi.heroMeta"])).toBeTruthy();
  });
});

describe("карточка теста интересов (когда Эви не предлагается)", () => {
  const UNAVAILABLE = { available: false };
  const DRAFT = uuidN(9, "eeeeeeee");
  const summary9 = (answered: number) => ({ attemptId: DRAFT, instrumentKey: "orvis92", version: "1", status: "draft", revision: 2, answeredCount: answered, questionCount: 92, createdAt: "2026-11-02T09:00:00+00:00", updatedAt: "2026-11-02T09:30:00+00:00", completedAt: null });
  const catalog = (over: { draft?: number | null; completed?: boolean }) => ({
    instruments: [{ ...catalogWithTest.instruments[0], draftAttemptId: over.draft == null ? null : DRAFT, latestCompletedAttemptId: over.completed ? ATTEMPT : null }],
    attempts: over.draft == null ? [] : [summary9(over.draft)],
  });
  const open = async (assessments: unknown) => {
    eviFetch = eviAnswer(UNAVAILABLE);
    const { transport } = fakeTransport(withConsent(GRANTED, { ...baseHandlers(false), student_assessments_v1: assessments }));
    return renderPortal(<ProfessionsScreen />, testApi(transport));
  };

  it("не начат: «Тест интересов», «92 утверждения · около 10 минут», без полосы, одна кнопка «Пройти тест»", async () => {
    await open(catalog({}));
    const button = await screen.findByTestId("professions-test-open");
    expect(screen.getByText("Тест интересов")).toBeTruthy();
    expect(screen.getByText("92 утверждения · около 10 минут")).toBeTruthy();
    expect(screen.getByText("Пройти тест")).toBeTruthy();
    expect(screen.queryByTestId("test-hero-progress")).toBeNull();
    await fireEvent.press(button);
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/tests/[key]", params: { key: "orvis92" } });
  });

  it("начат: «Отвечено», «12 из 92», полоса по доле и «Продолжить»", async () => {
    await open(catalog({ draft: 12 }));
    await screen.findByTestId("professions-test-open");
    expect(screen.getByText("Отвечено")).toBeTruthy();
    expect(screen.getByTestId("test-hero-count").props.children).toBe("12 из 92");
    expect(screen.getByTestId("test-hero-bar", { includeHiddenElements: true }).props.style.width).toBe("13%");
    expect(screen.getByText("Продолжить")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("professions-test-open"));
    expect(router.navigate).toHaveBeenCalledWith({ pathname: "/tests/[key]", params: { key: "orvis92" } });
  });

  it("пройден: «Тест пройден», «92 из 92», полная полоса и «Пройти заново»; начатая заново попытка главнее - «Продолжить»", async () => {
    await open(catalog({ completed: true }));
    await screen.findByTestId("professions-test-open");
    expect(screen.getByText("Тест пройден")).toBeTruthy();
    expect(screen.getByTestId("test-hero-count").props.children).toBe("92 из 92");
    expect(screen.getByTestId("test-hero-bar", { includeHiddenElements: true }).props.style.width).toBe("100%");
    expect(screen.getByText("Пройти заново")).toBeTruthy();
    expect(screen.queryByText("Продолжить")).toBeNull();
  });

  it("пройден и начат заново: «Отвечено 30 из 92» и «Продолжить»", async () => {
    await open(catalog({ draft: 30, completed: true }));
    await screen.findByTestId("professions-test-open");
    expect(screen.getByText("Отвечено")).toBeTruthy();
    expect(screen.getByTestId("test-hero-count").props.children).toBe("30 из 92");
    expect(screen.getByText("Продолжить")).toBeTruthy();
  });

  it("каталог тестов не прочитался: карточка ведёт в раздел без полосы, а не пропадает", async () => {
    eviFetch = eviAnswer(UNAVAILABLE);
    const { transport } = fakeTransport(withConsent(GRANTED, { profession_cards_v1: CARDS, student_assessments_v1: failure("XX000", 500) }));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByText("Пройти тест")).toBeTruthy();
    expect(screen.queryByTestId("test-hero-progress")).toBeNull();
  });

  it("kyrgyz: подписи из общего словаря", async () => {
    eviFetch = eviAnswer(UNAVAILABLE);
    const { transport } = fakeTransport(withConsent(GRANTED, { ...baseHandlers(false), student_assessments_v1: catalog({ draft: 12 }) }));
    await renderPortal(<ProfessionsScreen />, testApi(transport), "ky");
    expect(await screen.findByText("Улантуу")).toBeTruthy();
  });
});

describe("фото профессий", () => {
  const PHOTO_CARDS = {
    cards: [
      summary(CARD_A, "nurse", "Медсестра", ["altruism"], "Заботится о пациентах."),
      summary(CARD_B, "architect", "Архитектор", ["creativity"]),
      summary(CARD_C, "analyst", "Аналитик данных", ["analysis"]),
    ],
  };
  const handlers = (extra: Record<string, unknown> = {}) => withConsent(GRANTED, { ...baseHandlers(true), profession_cards_v1: PHOTO_CARDS, ...extra });
  const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

  it("у плитки каталога фото сверху на всю ширину (16:9), по ключу карточки; у профессии без файла фото нет, плитка прежняя", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByTestId("profession-nurse")).toBeTruthy();
    const photo = screen.getByTestId("tile-photo-nurse", { includeHiddenElements: true });
    expect(flat(photo.props.style)).toMatchObject({ width: "100%" });
    expect(flat(photo.props.style).aspectRatio).toBeCloseTo(16 / 9, 5);
    expect(screen.getByTestId("tile-photo-architect", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("tile-photo-analyst", { includeHiddenElements: true })).toBeNull();
    // Фото украшение: читалка читает название, как раньше.
    expect(photo.props.accessible).toBe(false);
    expect(screen.getByTestId("profession-nurse").props.accessibilityLabel).toBe("Медсестра");
  });

  it("«Подходят вам»: то же фото у карточки совпадения, процент и причина на месте", async () => {
    const { transport } = fakeTransport(
      handlers({
        student_assessment_attempt_v1: (() => {
          const attempt = orvisAttempt();
          const mean = { altruism: 4.9, creativity: 4.5, analysis: 1, erudition: 1, production: 1, leadership: 1, organization: 1, adventure: 1 };
          return { ...attempt, result: { ...attempt.result, orvis: { scales: Object.entries(mean).map(([scale, m]) => ({ scale, rawSum: Math.round(m * 10), itemCount: 10, mean: m })), topScales: ["altruism", "creativity"] } } };
        })(),
      }),
    );
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByTestId("profession-matches")).toBeTruthy();
    expect(screen.getByTestId("match-photo-nurse", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("match-photo-architect", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId("match-photo-analyst", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId("match-percent-nurse").props.children.join("")).toMatch(/%$/u);
  });

  it("шапка страницы профессии: фото над текстом, без ожидания (eager), со скруглением карточки", async () => {
    const body = { ...CARD_BODY, cardKey: "nurse" };
    const { transport } = fakeTransport({ profession_card_v1: body, student_university_index_v1: indexBody(), student_university_detail_v1: detail(), student_university_favorites_v1: [] });
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(transport));
    const photo = await screen.findByTestId("profession-photo", { includeHiddenElements: true });
    expect(flat(photo.props.style).aspectRatio).toBeCloseTo(16 / 9, 5);
    expect(flat(photo.props.style).borderRadius).toBe(12);
    expect(photo.props.priority).toBe("high");
    expect(photo.props.accessible).toBe(false);
  });

  it("страница профессии без файла фото: ничего не рисуется, остальное на месте", async () => {
    const { transport } = fakeTransport({ profession_card_v1: CARD_BODY, student_university_index_v1: indexBody(), student_university_detail_v1: detail(), student_university_favorites_v1: [] });
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(transport));
    expect(await screen.findByTestId("profession-summary")).toBeTruthy();
    expect(screen.queryByTestId("profession-photo", { includeHiddenElements: true })).toBeNull();
  });
});

describe("без отметки «созвучно вашим интересам» (веб убрал её в #1446)", () => {
  it("ни значка, ни приписки к названию для читалки, ни пояснения под списком - даже у студента с пройденным тестом", async () => {
    const { transport } = fakeTransport(withConsent(GRANTED, baseHandlers(true)));
    await renderPortal(<ProfessionsScreen />, testApi(transport));
    expect(await screen.findByTestId("profession-analyst")).toBeTruthy();
    // Шкалы теста совпали бы с профессией «Аналитик»: раньше здесь был значок.
    expect(screen.queryByText("Созвучно вашим интересам")).toBeNull();
    expect(screen.queryByTestId("resonance")).toBeNull();
    expect(screen.queryByText(/Отметка по вашему результату теста интересов/u)).toBeNull();
    expect(screen.getByTestId("profession-analyst").props.accessibilityLabel).toBe("Аналитик данных");
    expect(screen.getByTestId("profession-designer").props.accessibilityLabel).toBe("Дизайнер");
  });
});

describe("избранное в «Где учиться в EVO»: слова, состояние для читалки, сбой строкой", () => {
  const handlers = (extra: Record<string, unknown> = {}) => ({
    profession_card_v1: CARD_BODY,
    student_university_index_v1: indexBody(),
    student_university_detail_v1: detail(),
    student_university_favorites_v1: [],
    set_university_favorite_v1: { institutionId: uuidN(1), favored: true, favoritesCount: 1 },
    ...extra,
  });
  const heartOf = async () => (await screen.findAllByTestId(`program-fav-${uuidN(1)}`))[0]!;
  const errorOf = () => screen.queryAllByTestId(`program-fav-error-${uuidN(1)}`);

  it("кнопка со словами: «В избранное», после нажатия «В избранном»; читалка слышит действие и название вуза и состояние", async () => {
    const t = fakeTransport(handlers());
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(t.transport));
    const heart = await heartOf();
    expect(screen.getAllByText("В избранное").length).toBeGreaterThan(0);
    expect(heart.props.accessibilityRole).toBe("button");
    expect(heart.props.accessibilityState).toMatchObject({ selected: false });
    expect(heart.props.accessibilityLabel).toBe("В избранное — Университет Зета");
    await fireEvent.press(heart);
    await waitFor(() => expect(screen.getAllByText("В избранном").length).toBeGreaterThan(0));
    const pressed = (await screen.findAllByTestId(`program-fav-${uuidN(1)}`))[0]!;
    expect(pressed.props.accessibilityState).toMatchObject({ selected: true });
    expect(pressed.props.accessibilityLabel).toBe("Убрать из избранного — Университет Зета");
    expect(errorOf()).toHaveLength(0);
  });

  it("сбой записи: окна нет, под кнопкой строка «Не удалось сохранить. Нажмите ещё раз.», сердечко вернулось, строку объявляет читалка", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const alert = jest.spyOn(Alert, "alert");
    const announce = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;
    announce.mockClear();
    const t = fakeTransport(handlers({ set_university_favorite_v1: failure("XX000", 500) }));
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(t.transport));
    await fireEvent.press(await heartOf());
    await waitFor(() => expect(errorOf().length).toBeGreaterThan(0));
    const line = errorOf()[0]!;
    expect(line.props.children).toBe("Не удалось сохранить. Нажмите ещё раз.");
    expect(line.props.accessibilityRole).toBe("alert");
    expect(alert).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("Не удалось сохранить. Нажмите ещё раз.");
    expect((await heartOf()).props.accessibilityState).toMatchObject({ selected: false });
    // Следующее нажатие убирает строку (идёт новая попытка).
    t.calls.length = 0;
    await fireEvent.press(await heartOf());
    expect(t.calls.some((call) => call.name === "set_university_favorite_v1")).toBe(true);
  });

  it("список избранного не прочитался: кнопка всё равно есть (состояние - из карточки вуза); нажатие сперва перечитывает список и, пока он недоступен, ничего не пишет", async () => {
    const t = fakeTransport(handlers({ student_university_favorites_v1: failure("XX000", 500) }));
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(t.transport));
    const heart = await heartOf();
    expect(heart).toBeTruthy();
    expect(screen.getAllByText("В избранное").length).toBeGreaterThan(0);
    const reads = () => t.calls.filter((call) => call.name === "student_university_favorites_v1").length;
    const before = reads();
    await fireEvent.press(heart);
    await waitFor(() => expect(errorOf().length).toBeGreaterThan(0));
    expect(reads()).toBeGreaterThan(before);
    expect(t.calls.some((call) => call.name === "set_university_favorite_v1")).toBe(false);
    expect(errorOf()[0]!.props.children).toBe("Не удалось сохранить. Нажмите ещё раз.");
  });

  it("список не прочитался сначала, а при нажатии прочитался: запись идёт, остальные сердечки не затираются неполным списком", async () => {
    let reads = 0;
    // Другое избранное студента (вуз 7): после чтения оно не должно пропасть из списка.
    const other = [{ institutionId: uuidN(7), createdAt: "2026-11-01T10:00:00+00:00" }];
    const t = fakeTransport(handlers({ student_university_favorites_v1: () => (++reads === 1 ? failure("XX000", 500) : other) }));
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(t.transport));
    await fireEvent.press(await heartOf());
    await waitFor(() => expect(t.calls.some((call) => call.name === "set_university_favorite_v1")).toBe(true));
    expect(errorOf()).toHaveLength(0);
    expect(t.calls.find((call) => call.name === "set_university_favorite_v1")?.args).toEqual({ p_institution_id: uuidN(1), p_favored: true });
  });

  it("названия вуза и программы - на языке каталога для читалки (веб: lang=\"en\")", async () => {
    const t = fakeTransport(handlers());
    await renderPortal(<ProfessionCardScreen cardId={CARD_A} />, testApi(t.transport));
    await heartOf();
    expect(screen.getAllByTestId(`program-uni-${uuidN(1)}`)[0]!.props.accessibilityLanguage).toBe("en");
  });
});
