// «Запись на консультацию» в приложении (G14 аудита паритета 25.11.2026, решение владельца D1). Настоящий сервер не вызывается:
// RPC `own_portal_consultation_requests_v1` и `create_portal_consultation_request_v1` отвечают поддельным транспортом.
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text as RNText } from "react-native";

import { ConsultationCard } from "@/features/consultation/ConsultationCard";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const INSTITUTION = "33333333-3333-4333-8333-333333333333";
const OTHER_INSTITUTION = "44444444-4444-4444-8444-444444444444";

const receipt = (over: Record<string, unknown> = {}) => ({
  requestId: R1,
  status: "requested",
  institutionId: null,
  institutionName: null,
  note: null,
  requestedAt: "2026-11-09T08:00:00+00:00",
  handledAt: null,
  ...over,
});
const handled = (over: Record<string, unknown> = {}) => receipt({ status: "handled", handledAt: "2026-11-12T10:30:00+00:00", ...over });

/** База ведёт себя как настоящая: после записи запрос появляется в истории (иначе повторное чтение вернуло бы пустую историю). */
function server(answer: (n: number) => unknown) {
  let created = false;
  const history = (note: unknown) => (created ? [receipt({ note })] : []);
  return {
    own_portal_consultation_requests_v1: () => history(null),
    create_portal_consultation_request_v1: (_args: unknown, n: number) => {
      const value = answer(n);
      if (value && typeof value === "object" && !("__rpcFailure" in value) && (value as { status?: string }).status !== "handled") created = true;
      return value;
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const writes = (calls: { name: string; args?: Record<string, unknown> }[]) => calls.filter((c) => c.name === "create_portal_consultation_request_v1");
const reads = (calls: { name: string }[]) => calls.filter((c) => c.name === "own_portal_consultation_requests_v1");

describe("карточка «Консультация» в «Профиле»", () => {
  it("запроса нет: заголовок, подсказка и «Записаться на консультацию»; истории нет", async () => {
    const { transport } = fakeTransport({ own_portal_consultation_requests_v1: [] });
    await renderPortal(<ConsultationCard />, testApi(transport));
    expect(await screen.findByTestId("consult-cta")).toBeTruthy();
    expect(screen.getByText("Консультация")).toBeTruthy();
    expect(screen.getByText("Задайте вопрос о поступлении — менеджер EVO свяжется с вами.")).toBeTruthy();
    expect(screen.getByText("Записаться на консультацию")).toBeTruthy();
    expect(screen.queryByTestId("consult-history")).toBeNull();
    expect(screen.queryByTestId("consult-form")).toBeNull();
  });

  it("форма: заметка до 500 знаков, «Отправить запрос» и «Отмена»; отмена сворачивает без записи", async () => {
    const { transport, calls } = fakeTransport({ own_portal_consultation_requests_v1: [] });
    await renderPortal(<ConsultationCard />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    const note = screen.getByTestId("consult-note");
    expect(note.props.maxLength).toBe(500);
    expect(note.props.placeholder).toBe("Вопрос или удобное время для звонка");
    expect(screen.getByText("Комментарий (необязательно)")).toBeTruthy();
    expect(screen.getByText("Отправить запрос")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("consult-cancel"));
    expect(screen.getByTestId("consult-cta")).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it("отправка: p_request_id, p_institution_id null и заметка без пробелов по краям; после ответа базы честное «Запрос отправлен»", async () => {
    const { transport, calls } = fakeTransport(server(() => receipt({ note: "Позвоните после 18:00" })));
    await renderPortal(<ConsultationCard />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.changeText(screen.getByTestId("consult-note"), "  Позвоните после 18:00  ");
    await fireEvent.press(screen.getByTestId("consult-submit"));
    expect(await screen.findByTestId("consult-sent")).toHaveTextContent("Запрос отправлен — менеджер свяжется.");
    expect(screen.queryByTestId("consult-cta")).toBeNull();
    expect(screen.queryByTestId("consult-form")).toBeNull();
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]?.args).toEqual({ p_request_id: expect.stringMatching(UUID), p_institution_id: null, p_note: "Позвоните после 18:00" });
  });

  it("пустая заметка уходит как null", async () => {
    const { transport, calls } = fakeTransport(server(() => receipt()));
    await renderPortal(<ConsultationCard />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.changeText(screen.getByTestId("consult-note"), "   ");
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await screen.findByTestId("consult-sent");
    expect(writes(calls)[0]?.args?.p_note).toBeNull();
  });

  it("сбой: честная ошибка, форма и заметка остаются; повтор шлёт тот же p_request_id и проходит", async () => {
    const { transport, calls } = fakeTransport(server((n) => (n === 1 ? failure("XX000", 500) : receipt())));
    await renderPortal(<ConsultationCard />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.changeText(screen.getByTestId("consult-note"), "Вопрос");
    await fireEvent.press(screen.getByTestId("consult-submit"));
    expect(await screen.findByText("Не удалось отправить запрос. Повторите.")).toBeTruthy();
    expect(screen.getByTestId("consult-note").props.value).toBe("Вопрос");
    expect(screen.queryByTestId("consult-sent")).toBeNull();
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await screen.findByTestId("consult-sent");
    const sent = writes(calls);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.args?.p_request_id).toBe(sent[0]?.args?.p_request_id);
  });

  it("чужой ответ вместо квитанции не считается принятым запросом", async () => {
    const { transport } = fakeTransport({
      own_portal_consultation_requests_v1: [],
      create_portal_consultation_request_v1: receipt({ status: "handled", handledAt: null }),
    });
    await renderPortal(<ConsultationCard />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    expect(await screen.findByTestId("consult-error")).toBeTruthy();
    expect(screen.queryByTestId("consult-sent")).toBeNull();
  });

  it("открытый запрос уже есть (другое устройство): сразу «Запрос отправлен», кнопки нет", async () => {
    const { transport } = fakeTransport({ own_portal_consultation_requests_v1: [receipt()] });
    await renderPortal(<ConsultationCard />, testApi(transport));
    expect(await screen.findByTestId("consult-sent")).toBeTruthy();
    expect(screen.queryByTestId("consult-cta")).toBeNull();
  });

  it("когда менеджер обработал запрос, снова можно записаться, и новый запрос идёт под новым p_request_id", async () => {
    let read = 0;
    const { transport, calls } = fakeTransport({
      // 1: пусто, 2: после отправки открытый запрос, 3: обработан
      own_portal_consultation_requests_v1: () => {
        read += 1;
        return read === 1 ? [] : read === 2 ? [receipt()] : [handled()];
      },
      create_portal_consultation_request_v1: (_a: unknown, n: number) => (n === 1 ? receipt() : receipt({ requestId: R2 })),
    });
    const view = await renderPortal(<ConsultationCard />, testApi(transport));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await screen.findByTestId("consult-sent");
    // менеджер обработал: история читается заново (вытягивание вниз «Профиля» делает то же)
    await view.client.invalidateQueries({ queryKey: ["portal", "user-test", "consultations"] });
    await waitFor(() => expect(screen.queryByTestId("consult-sent")).toBeNull());
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]?.args?.p_request_id).not.toBe(writes(calls)[0]?.args?.p_request_id);
  });

  it("история: статус, вуз, заметка и даты каждого запроса (до 20)", async () => {
    const { transport } = fakeTransport({
      own_portal_consultation_requests_v1: [
        handled({ requestId: R2, institutionId: INSTITUTION, institutionName: "Университет Тест", note: "Нужна стипендия" }),
        receipt({ requestedAt: "2026-11-20T08:00:00+00:00" }),
      ],
    });
    await renderPortal(<ConsultationCard />, testApi(transport));
    const list = await screen.findByTestId("consult-history");
    expect(within(list).getByText("Ваши запросы")).toBeTruthy();
    const items = within(list).getAllByTestId("consult-history-item");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Обработан")).toBeTruthy();
    expect(within(items[0]).getByText("Университет: Университет Тест")).toBeTruthy();
    expect(within(items[0]).getByText("Нужна стипендия")).toBeTruthy();
    expect(within(items[0]).getByText(/Отправлен 9 ноября 2026/)).toBeTruthy();
    expect(within(items[0]).getByText(/Обработан 12 ноября 2026/)).toBeTruthy();
    expect(within(items[1]).getByText("Запрос отправлен — менеджер свяжется")).toBeTruthy();
  });

  it("история не прочиталась: строка веба и повтор, кнопки записи нет (запрос мог быть открыт)", async () => {
    let attempt = 0;
    const { transport } = fakeTransport({
      own_portal_consultation_requests_v1: () => {
        attempt += 1;
        return attempt === 1 ? failure("XX000", 500) : [];
      },
    });
    await renderPortal(<ConsultationCard />, testApi(transport));
    // слово приложения, а не веба «Обновите страницу»: рядом кнопка «Повторить»
    expect(await screen.findByText("Не удалось загрузить запросы. Повторите.")).toBeTruthy();
    expect(screen.queryByText(/Обновите страницу/)).toBeNull();
    expect(screen.queryByTestId("consult-cta")).toBeNull();
    await fireEvent.press(screen.getByText("Повторить"));
    expect(await screen.findByTestId("consult-cta")).toBeTruthy();
  });

  it("KY: тексты кыргызские (словарь веба)", async () => {
    const { transport } = fakeTransport({ own_portal_consultation_requests_v1: [receipt()] });
    await renderPortal(<ConsultationCard />, testApi(transport), "ky");
    expect(await screen.findByTestId("consult-sent")).toHaveTextContent("Сурам жөнөтүлдү — менеджер байланышат.");
    expect(screen.getByText("Сиздин сурамдарыңыз")).toBeTruthy();
    expect(screen.getByText(/Жөнөтүлдү /)).toBeTruthy();
  });
});

describe("запрос на странице вуза (variant=university)", () => {
  it("известно, что открытого запроса нет: только «Записаться», без заголовка и истории, история не читается", async () => {
    const { transport, calls } = fakeTransport({});
    await renderPortal(<ConsultationCard variant="university" institutionId={INSTITUTION} initialOpenRequest={null} />, testApi(transport, { tier: "approved" }));
    expect(await screen.findByTestId("consult-cta")).toBeTruthy();
    expect(screen.queryByText("Консультация")).toBeNull();
    expect(screen.queryByTestId("consult-history")).toBeNull();
    expect(reads(calls)).toHaveLength(0);
  });

  it("запрос идёт с вузом страницы и после ответа показывает «Запрос отправлен»", async () => {
    const { transport, calls } = fakeTransport({ create_portal_consultation_request_v1: receipt({ institutionId: INSTITUTION, institutionName: "Университет Тест" }) });
    await renderPortal(<ConsultationCard variant="university" institutionId={INSTITUTION} initialOpenRequest={null} />, testApi(transport, { tier: "approved" }));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    expect(await screen.findByTestId("consult-sent")).toBeTruthy();
    expect(writes(calls)[0]?.args).toEqual({ p_request_id: expect.stringMatching(UUID), p_institution_id: INSTITUTION, p_note: null });
  });

  it("страница уже знает открытый запрос: сразу «Запрос отправлен», история не читается", async () => {
    const { transport, calls } = fakeTransport({});
    await renderPortal(<ConsultationCard variant="university" institutionId={INSTITUTION} initialOpenRequest={receipt() as never} />, testApi(transport, { tier: "approved" }));
    expect(await screen.findByTestId("consult-sent")).toBeTruthy();
    expect(reads(calls)).toHaveLength(0);
  });

  it("страница ничего не сообщила: карточка находит открытый запрос сама", async () => {
    const { transport, calls } = fakeTransport({ own_portal_consultation_requests_v1: [receipt()] });
    await renderPortal(<ConsultationCard variant="university" institutionId={INSTITUTION} />, testApi(transport, { tier: "approved" }));
    expect(await screen.findByTestId("consult-sent")).toBeTruthy();
    expect(reads(calls)).toHaveLength(1);
  });

  it("страница вуза: сбой чтения истории не прячет запись (база всё равно держит один открытый запрос)", async () => {
    const { transport } = fakeTransport({ own_portal_consultation_requests_v1: failure("XX000", 500) });
    await renderPortal(<ConsultationCard variant="university" institutionId={INSTITUTION} />, testApi(transport, { tier: "approved" }));
    expect(await screen.findByTestId("consult-cta")).toBeTruthy();
    expect(screen.queryByTestId("consult-history-error")).toBeNull();
  });
});

// Рецензия #1568: идентификатор запроса привязан к вузу. База отвечает на уже виденный `p_request_id` прежней строкой и остальные
// аргументы не читает (миграция 197): повтор с тем же id и другим вузом был бы молча записан на прежний вуз.
describe("идентификатор запроса и вуз", () => {
  /** Один и тот же экземпляр карточки получает другой вуз (без `key`): так бывает, пока страница не поставила `key={institutionId}`. */
  function Switch() {
    const [institution, setInstitution] = useState(INSTITUTION);
    return (
      <>
        <Pressable testID="switch-institution" onPress={() => setInstitution(institution === INSTITUTION ? OTHER_INSTITUTION : INSTITUTION)}>
          <RNText>{institution}</RNText>
        </Pressable>
        <ConsultationCard variant="university" institutionId={institution} initialOpenRequest={null} />
      </>
    );
  }

  it("после сбоя другой вуз: новый p_request_id и новый вуз в запросе, старый вуз не получает чужую заметку", async () => {
    const { transport, calls } = fakeTransport({ create_portal_consultation_request_v1: failure("XX000", 500) });
    await renderPortal(<Switch />, testApi(transport, { tier: "approved" }));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await screen.findByTestId("consult-error");
    await fireEvent.press(screen.getByTestId("switch-institution"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    const [first, second] = writes(calls);
    expect(first?.args?.p_institution_id).toBe(INSTITUTION);
    expect(second?.args?.p_institution_id).toBe(OTHER_INSTITUTION);
    expect(second?.args?.p_request_id).not.toBe(first?.args?.p_request_id);
  });

  it("тот же вуз после сбоя: повтор шлёт тот же p_request_id", async () => {
    const { transport, calls } = fakeTransport({ create_portal_consultation_request_v1: failure("XX000", 500) });
    await renderPortal(<Switch />, testApi(transport, { tier: "approved" }));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await screen.findByTestId("consult-error");
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]?.args?.p_request_id).toBe(writes(calls)[0]?.args?.p_request_id);
    expect(writes(calls)[1]?.args?.p_institution_id).toBe(INSTITUTION);
  });

  it("вернулись к первому вузу после второго: идентификатор снова новый, а не чужой старый", async () => {
    const { transport, calls } = fakeTransport({ create_portal_consultation_request_v1: failure("XX000", 500) });
    await renderPortal(<Switch />, testApi(transport, { tier: "approved" }));
    await fireEvent.press(await screen.findByTestId("consult-cta"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await screen.findByTestId("consult-error");
    await fireEvent.press(screen.getByTestId("switch-institution"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    await fireEvent.press(screen.getByTestId("switch-institution"));
    await fireEvent.press(screen.getByTestId("consult-submit"));
    await waitFor(() => expect(writes(calls)).toHaveLength(3));
    const ids = writes(calls).map((call) => call.args?.p_request_id);
    expect(new Set(ids).size).toBe(3);
  });
});
