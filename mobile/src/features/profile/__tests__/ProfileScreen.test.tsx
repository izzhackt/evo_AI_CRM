import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { Linking } from "react-native";

import { ProfileScreen } from "@/features/profile/ProfileScreen";
import { saved } from "@/test-fixtures/home";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { validDraft } from "@/test-fixtures/registration";
import { OVERVIEW_ROW, PAYMENT_ROW } from "@/test-fixtures/rpc-rows";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const mockSession = {
  state: { kind: "active", session: { authority: { displayName: "Тест Студентов" } } },
  portalAuth: { changeOwnPassword: jest.fn() },
  signOut: jest.fn(async () => undefined),
};
jest.mock("@/session/SessionProvider", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "2.0.0" } } }));
jest.mock("@/shell/TabBar", () => ({ TAB_BAR_CLEARANCE: 0 }));

const PROFILE = { displayName: "Тест Студентов", email: "student@example.test", portalLanguage: "ru", caseState: "active", deletionRequestedAt: null };
const CONSENT = { status: null, policyVersion: null, decidedAt: null, currentPolicyVersion: "2026-10-25" };

/** Своя анкета студента: ответы только для чтения в «Профиле» (веб: «Ваша анкета»). */
const APPLICATION = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "approved",
  revision: 2,
  email: "student@example.test",
  questionnaire: validDraft(),
  submitted_at: "2026-11-08T10:00:00Z",
  decided_at: "2026-11-09T10:00:00Z",
  decision_reason: null,
};

function handlers(extra: Record<string, unknown> = {}) {
  return {
    own_student_application_v1: null,
    student_country_choice_v1: { country: null, source: "none", savedAt: null },
    own_portal_consultation_requests_v1: [],
    get_own_portal_profile_v1: PROFILE,
    own_student_login_v1: "test.student",
    portal_ai_consent_get_v1: CONSENT,
    own_account_deletion_request_v1: null,
    set_own_portal_language_v1: (args: Record<string, unknown> | undefined) => ({ portalLanguage: args?.p_language }),
    ...extra,
  };
}

type JsonNode = { props?: { testID?: string }; children?: (JsonNode | string)[] | null };
/** Узел дерева с таким `testID` (разметка без обёрток тестового рендерера). */
function findNode(node: JsonNode | string | null, testID: string): JsonNode | null {
  if (node === null || typeof node === "string") return null;
  if (node.props?.testID === testID) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, testID);
    if (found) return found;
  }
  return null;
}
const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;

let openURL: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear();
  mockSession.signOut.mockClear();
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => openURL.mockRestore());

describe("ProfileScreen", () => {
  it("«Мои данные»: имя, почта и логин для входа только для чтения; версия приложения", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    expect(await screen.findByLabelText("Почта: student@example.test")).toBeTruthy();
    expect(screen.getByLabelText("Логин для входа: test.student")).toBeTruthy();
    expect(screen.getByLabelText("Имя: Тест Студентов")).toBeTruthy();
    expect(screen.getByText("Версия 2.0.0")).toBeTruthy();
    // на вебе телефона в профиле нет: поля ввода телефона тоже нет
    expect(screen.queryByLabelText(/телефон/i)).toBeNull();
  });

  it("«Мои данные» (#1360): телефон и имя меняет куратор, ссылка ведёт в чат; у approved ссылка на поддержку", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    expect(await screen.findByText("Телефон и имя меняет куратор: напишите ему, и он исправит.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("profile-write-evo"));
    expect(router.navigate).toHaveBeenLastCalledWith("/messages/chat");
    const approved = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(approved.transport, { tier: "approved" }));
    // как на вебе: самостоятельному студенту говорят о записи на консультацию ниже, ссылки на чат или поддержку в «Моих данных» нет
    expect(await screen.findByText("Телефон и имя меняет менеджер: запишитесь на консультацию ниже, и он исправит.")).toBeTruthy();
    expect(screen.queryByTestId("profile-write-evo")).toBeNull();
    expect(screen.queryByTestId("profile-data-support")).toBeNull();
  });

  it("язык: сохраняется в БД (set_own_portal_language_v1), интерфейс меняется после ответа", async () => {
    const { transport, calls } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("profile-lang-ky");
    await fireEvent.press(screen.getByTestId("profile-lang-ky"));
    expect(await screen.findByText("Порталдын тили")).toBeTruthy();
    expect(calls.find((c) => c.name === "set_own_portal_language_v1")?.args).toEqual({ p_language: "ky" });
  });

  it("язык: сбой записи оставляет прежний язык и показывает строку веба", async () => {
    const { transport } = fakeTransport(handlers({ set_own_portal_language_v1: failure("XX000", 500) }));
    await renderPortal(<ProfileScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("profile-lang-ky"));
    expect(await screen.findByText("Не удалось сохранить язык. Повторите.")).toBeTruthy();
    expect(screen.getByTestId("deletion-start")).toBeTruthy();
  });

  it("политика и поддержка открываются в браузере, лицензии — экраном со списком", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("profile-privacy"));
    expect(openURL).toHaveBeenCalledWith("https://evoadmissions.com/ru/privacy/");
    await fireEvent.press(screen.getByTestId("profile-support"));
    expect(openURL).toHaveBeenCalledWith("https://evoadmissions.com/ru/support/");
    await fireEvent.press(screen.getByTestId("profile-licenses"));
    expect(await screen.findByTestId("licenses-screen")).toBeTruthy();
    expect(screen.getByText(/Записей: \d+/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("licenses-search"), "openstreetmap");
    await fireEvent.press(await screen.findByTestId("license-row-OpenStreetMap (данные карты)"));
    expect(screen.getByTestId("license-text").props.children).toContain("Open Database License");
  });

  it("ссылка не открылась — сообщение, а не тишина", async () => {
    openURL.mockRejectedValueOnce(new Error("no handler"));
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("profile-privacy"));
    expect(await screen.findByText("Не удалось открыть ссылку.")).toBeTruthy();
  });

  it("«Конфиденциальность» (решение владельца 14.11.2026): политика, поддержка, согласие на ИИ и удаление в одной секции, без объяснений", async () => {
    const { transport } = fakeTransport(handlers({ portal_ai_consent_get_v1: { ...CONSENT, status: "granted", policyVersion: "2026-10-25", decidedAt: "2026-11-02T10:00:00+00:00" } }));
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("ai-consent-revoke");
    expect(screen.getByText("Конфиденциальность")).toBeTruthy();
    expect(screen.getByText("Политика конфиденциальности")).toBeTruthy();
    expect(screen.getByText("Поддержка EVO")).toBeTruthy();
    expect(screen.getByText("Отозвать согласие на ИИ")).toBeTruthy();
    expect(screen.getByText("Удалить аккаунт")).toBeTruthy();
    // Объяснений о данных на рабочем экране нет: ни про чтение ИИ, ни про срок удаления и хранение записей.
    for (const phrase of [/читают вашу переписку/, /Anthropic/, /Не разрешать/, /в течение 30 дней/, /хранятся обезличенно/, /Условия обновились/, /стёрты/]) {
      expect(screen.queryByText(phrase)).toBeNull();
    }
  });

  it("выход: signOut вызывается; блок согласия на ИИ и удаления на экране", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("ai-consent-row");
    await screen.findByTestId("deletion-start");
    await fireEvent.press(screen.getByTestId("sign-out"));
    await waitFor(() => expect(mockSession.signOut).toHaveBeenCalledTimes(1));
  });

  it("«Выйти» одна и стоит наверху, в карточке студента, как на вебе (внизу экрана второй нет)", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("profile-hero");
    expect(screen.getAllByTestId("sign-out")).toHaveLength(1);
    expect(screen.getAllByText("Выйти")).toHaveLength(1);
    // кнопка внутри карточки студента
    const hero = screen.getByTestId("profile-hero");
    expect(within(hero).getByTestId("sign-out")).toBeTruthy();
  });
});

describe("карточка студента наверху «Профиля» (G16)", () => {
  it("инициалы, имя, метки страны и этапа у студента на сопровождении", async () => {
    const { transport } = fakeTransport(
      handlers({ student_country_choice_v1: saved("MY"), student_portal_overview_v2: [OVERVIEW_ROW], student_portal_finance_v2: [PAYMENT_ROW] }),
    );
    await renderPortal(<ProfileScreen />, testApi(transport));
    expect(await screen.findByText("Малайзия")).toBeTruthy();
    expect(screen.getByText("Этап: сбор документов")).toBeTruthy();
    expect(screen.getByTestId("profile-hero-name")).toHaveTextContent("Тест Студентов");
    // круг с инициалами скрыт от читалки (имя рядом читается целиком): в запросах он виден только с includeHiddenElements
    const avatar = screen.getByTestId("profile-avatar", { includeHiddenElements: true });
    expect(within(avatar).getByText("ТС", { includeHiddenElements: true })).toBeTruthy();
  });

  it("у самостоятельного студента метки этапа нет, страна есть, обзор дела не читается", async () => {
    const { transport, calls } = fakeTransport(handlers({ student_country_choice_v1: saved("CN") }));
    await renderPortal(<ProfileScreen />, testApi(transport, { tier: "approved" }));
    expect(await screen.findByText("Китай")).toBeTruthy();
    expect(screen.queryByText(/^Этап:/)).toBeNull();
    expect(calls.some((c) => c.name === "student_portal_overview_v2")).toBe(false);
  });

  it("страна не выбрана или чтение упало: без метки, экран цел", async () => {
    const { transport } = fakeTransport(handlers({ student_country_choice_v1: failure("XX000", 500) }));
    await renderPortal(<ProfileScreen />, testApi(transport, { tier: "approved" }));
    await screen.findByTestId("profile-hero");
    expect(screen.queryByTestId("profile-chips")).toBeNull();
  });

  it("KY: название страны и слово «Этап» на кыргызском", async () => {
    const { transport } = fakeTransport(
      handlers({ student_country_choice_v1: saved("MY"), student_portal_overview_v2: [OVERVIEW_ROW], student_portal_finance_v2: [PAYMENT_ROW] }),
    );
    await renderPortal(<ProfileScreen />, testApi(transport), "ky");
    expect(await screen.findByText("Малайзия")).toBeTruthy();
    expect(screen.getByText("Этап: документтерди чогултуу")).toBeTruthy();
  });

  it("«Личные результаты тестов» ведёт на экран тестов", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("profile-tests-link"));
    expect(router.navigate).toHaveBeenLastCalledWith("/tests");
  });
});

describe("«Ваша анкета» в «Профиле» (G15)", () => {
  it("у студента с анкетой: заголовок и 12 ответов только для чтения", async () => {
    const { transport, calls } = fakeTransport(handlers({ own_student_application_v1: APPLICATION }));
    await renderPortal(<ProfileScreen />, testApi(transport, { tier: "approved" }));
    const answers = await screen.findByTestId("profile-application");
    expect(screen.getByText("Ваша анкета")).toBeTruthy();
    expect(within(answers).getByLabelText("Имя и фамилия: Тест Студентов")).toBeTruthy();
    expect(within(answers).getByLabelText("Телефон: +996 555 000 111")).toBeTruthy();
    expect(within(answers).getAllByLabelText(/: /)).toHaveLength(12);
    expect(calls.some((c) => c.name === "own_student_application_v1")).toBe(true);
    // только чтение: ни полей ввода, ни кнопки исправления
    expect(screen.queryByTestId("application-fix")).toBeNull();
  });

  it("у студента на сопровождении блок тоже есть, на кыргызском подписи кыргызские", async () => {
    const { transport } = fakeTransport(handlers({ own_student_application_v1: APPLICATION }));
    await renderPortal(<ProfileScreen />, testApi(transport), "ky");
    const answers = await screen.findByTestId("profile-application");
    expect(screen.getByText("Сиздин анкетаңыз")).toBeTruthy();
    expect(within(answers).getAllByLabelText(/: /)).toHaveLength(12);
  });

  it("анкеты нет (студента завели вручную): блока нет", async () => {
    const { transport } = fakeTransport(handlers({ own_student_application_v1: null }));
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("profile-hero");
    await waitFor(() => expect(screen.queryByTestId("profile-application-loading")).toBeNull());
    expect(screen.queryByTestId("profile-application")).toBeNull();
    expect(screen.queryByText("Ваша анкета")).toBeNull();
  });

  it("сбой чтения: честная строка веба и повтор, а не пустое место", async () => {
    let attempt = 0;
    const { transport } = fakeTransport(
      handlers({
        own_student_application_v1: () => {
          attempt += 1;
          return attempt === 1 ? failure("XX000", 500) : APPLICATION;
        },
      }),
    );
    await renderPortal(<ProfileScreen />, testApi(transport));
    expect(await screen.findByText("Не удалось загрузить анкету. Обновите страницу.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByTestId("profile-application")).toBeTruthy();
  });
});

describe("язык (G17)", () => {
  it("ложной фразы о том, что язык сохраняется на всех устройствах, нет ни на RU, ни на KY", async () => {
    const { transport } = fakeTransport(handlers());
    const ru = await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("profile-lang-ky");
    expect(screen.queryByText("Язык сохраняется в вашем аккаунте и на всех устройствах.")).toBeNull();
    await ru.unmount();
    await renderPortal(<ProfileScreen />, testApi(transport), "ky");
    await screen.findByTestId("profile-lang-ky");
    expect(screen.queryByText("Тил аккаунтуңузда жана бардык түзмөктөрдө сакталат.")).toBeNull();
  });
});

describe("запись на консультацию в «Профиле» (G14)", () => {
  it("у самостоятельного студента и у студента на сопровождении: карточка «Консультация» после «Моих данных», запрос уходит в RPC", async () => {
    for (const tier of ["approved", "assisted"] as const) {
      const { transport, calls } = fakeTransport(
        handlers({
          create_portal_consultation_request_v1: {
            requestId: "11111111-1111-4111-8111-111111111111",
            status: "requested",
            institutionId: null,
            institutionName: null,
            note: null,
            requestedAt: "2026-11-09T08:00:00+00:00",
            handledAt: null,
          },
          own_portal_consultation_requests_v1: () => (calls.some((c) => c.name === "create_portal_consultation_request_v1") ? [{ requestId: "11111111-1111-4111-8111-111111111111", status: "requested", institutionId: null, institutionName: null, note: null, requestedAt: "2026-11-09T08:00:00+00:00", handledAt: null }] : []),
        }),
      );
      const view = await renderPortal(<ProfileScreen />, testApi(transport, { tier }));
      await fireEvent.press(await screen.findByTestId("consult-cta"));
      await fireEvent.press(screen.getByTestId("consult-submit"));
      expect(await screen.findByTestId("consult-sent")).toBeTruthy();
      expect(calls.some((c) => c.name === "create_portal_consultation_request_v1")).toBe(true);
      await view.unmount();
    }
  });

  it("карточка «Консультация» стоит между «Моими данными» и «Языком»", async () => {
    const { transport } = fakeTransport(handlers());
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("consult-cta");
    // тексты экрана по порядку сверху вниз (в самом дереве есть циклические ссылки контекстов, поэтому обходим только детей)
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === "string") texts.push(node);
      else if (node && typeof node === "object") {
        const children = (node as { children?: unknown }).children;
        if (Array.isArray(children)) children.forEach(walk);
      }
    };
    const root = screen.toJSON();
    (Array.isArray(root) ? root : [root]).forEach(walk);
    const text = texts.join("\n");
    const at = (needle: string) => text.indexOf(needle);
    expect(at("Мои данные")).toBeGreaterThan(-1);
    expect(at("Мои данные")).toBeLessThan(at("Задайте вопрос о поступлении"));
    expect(at("Задайте вопрос о поступлении")).toBeLessThan(at("Язык портала"));
  });
});

// QA#2, D6: «Сопровождаемый» ломалось посреди слова («Сопровождаемы / й») рядом с «Выйти». Раскладку в Jest не померить, поэтому
// проверяется правило, которое её держит: у имени своя колонка, кнопка не в её строке, на крупном шрифте имя ужимается.
describe("карточка студента: имя не ломается рядом с «Выйти» (QA#2, D6)", () => {
  const LONG_NAME = "Сопровождаемый";
  const withName = (displayName: string) => handlers({ get_own_portal_profile_v1: { ...PROFILE, displayName } });

  it("«Выйти» отдельной строкой под именем, как на вебе на телефоне, а не справа от него", async () => {
    const { transport } = fakeTransport(withName(LONG_NAME));
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByTestId("profile-hero");
    const tree = screen.toJSON() as unknown as JsonNode;
    const hero = findNode(tree, "profile-hero")!;
    const rows = (hero.children ?? []).filter((child): child is JsonNode => typeof child !== "string");
    // две строки: круг с именем и метками, затем действия; кнопка только во второй
    expect(rows.map((row) => row.props?.testID)).toEqual(["profile-hero-main", "profile-hero-actions"]);
    expect(findNode(rows[0], "sign-out")).toBeNull();
    expect(findNode(rows[0], "profile-hero-name")).not.toBeNull();
    expect(findNode(rows[1], "sign-out")).not.toBeNull();
    // и это та же одна кнопка «Выйти» в карточке студента
    expect(screen.getAllByTestId("sign-out")).toHaveLength(1);
  });

  it("у имени своя колонка: растёт на остаток строки и сжимается, ничто рядом её не сужает", async () => {
    const { transport } = fakeTransport(withName(LONG_NAME));
    await renderPortal(<ProfileScreen />, testApi(transport));
    const identity = await screen.findByTestId("profile-hero-identity");
    expect(flat(identity)).toMatchObject({ flex: 1, minWidth: 0 });
    // в строке с именем только круг и эта колонка: справа от неё ничего нет
    const main = findNode(screen.toJSON() as unknown as JsonNode, "profile-hero-main")!;
    const ids = (main.children ?? []).map((child) => (typeof child === "string" ? child : child.props?.testID));
    expect(ids).toEqual(["profile-avatar", "profile-hero-identity"]);
  });

  it("имя занимает не больше двух рядов, дальше шрифт ужимается, но не мельче 60%, и растёт не больше чем в 1,4 раза: слово не рвётся посреди", async () => {
    const { transport } = fakeTransport(withName(LONG_NAME));
    await renderPortal(<ProfileScreen />, testApi(transport));
    const name = await screen.findByTestId("profile-hero-name");
    expect(name).toHaveTextContent(LONG_NAME);
    expect(name.props.accessibilityRole).toBe("header");
    expect(name.props.numberOfLines).toBe(2);
    expect(name.props.adjustsFontSizeToFit).toBe(true);
    expect(name.props.minimumFontScale).toBe(0.6);
    expect(name.props.maxFontSizeMultiplier).toBe(1.4);
  });

  it("метки страны и этапа стоят в той же колонке под именем и переносятся строкой", async () => {
    const { transport } = fakeTransport({ ...withName(LONG_NAME), student_country_choice_v1: saved("MY"), student_portal_overview_v2: [OVERVIEW_ROW], student_portal_finance_v2: [PAYMENT_ROW] });
    await renderPortal(<ProfileScreen />, testApi(transport));
    await screen.findByText("Малайзия");
    const identity = findNode(screen.toJSON() as unknown as JsonNode, "profile-hero-identity")!;
    const ids = (identity.children ?? []).map((child) => (typeof child === "string" ? child : child.props?.testID));
    expect(ids).toEqual(["profile-hero-name", "profile-chips"]);
    expect(flat(screen.getByTestId("profile-chips"))).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
  });

  it("строка действий переносится и не растягивает кнопку: она такой ширины, какой нужна подписи", async () => {
    const { transport } = fakeTransport(withName(LONG_NAME));
    await renderPortal(<ProfileScreen />, testApi(transport));
    const actions = await screen.findByTestId("profile-hero-actions");
    expect(flat(actions)).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
    expect(flat(actions).flex).toBeUndefined();
  });
});
