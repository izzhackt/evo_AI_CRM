// Сбои записи «прочитано» живут в общем хранилище по кабинету, студенту и уведомлению (разбор ревью #1557, F4 и второй круг): экран
// ответа куратора и лента «Что нового» видят одно и то же, удачная запись с любого экрана снимает плашку, а выход из кабинета и вход
// заново начинают с чистого листа.
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { applyReadOutcome, useReadFailures } from "@/features/inbox/read-failures";
import { ReplyScreen } from "@/features/inbox/ReplyScreen";
import { UpdatesScreen } from "@/features/inbox/UpdatesScreen";
import { HELP_NOTIFICATION_ID, helpReplyRow } from "@/test-fixtures/program-decisions";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { NOTIFICATION_ROW } from "@/test-fixtures/rpc-rows";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }), usePathname: () => "/messages" }));
jest.mock("@/features/inbox/visibility", () => ({ useScreenVisible: jest.fn(() => true) }));

const AUTH = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const A = "66666666-6666-4666-8666-6666666666aa";
const B = "66666666-6666-4666-8666-6666666666bb";
const WRITE = "mark_own_student_portal_notification_read_v2";

// Каждому тесту свой кабинет (свой кэш чтений): хранилище привязано к нему, сбрасывать нечего.
const cabinet = () => new QueryClient();

function Probe({ session, userKey }: { session: QueryClient; userKey: string }) {
  const { failed, allFailed } = useReadFailures(session, userKey);
  return <Text testID="probe">{`${[...failed].sort().join(",")}|${[...allFailed].sort().join(",") || "-"}`}</Text>;
}
const probe = () => screen.getByTestId("probe").props.children as string;

describe("хранилище сбоев записи «прочитано»", () => {
  it("сбой одного уведомления привязан к его номеру; удачная запись этого номера снимает его, чужого - нет", async () => {
    const session = cabinet();
    await render(<Probe session={session} userKey={AUTH} />);
    expect(probe()).toBe("|-");
    await act(async () => applyReadOutcome(session, AUTH, { scope: "one", ok: false, succeeded: [], failed: [A] }));
    await act(async () => applyReadOutcome(session, AUTH, { scope: "one", ok: false, succeeded: [], failed: [B] }));
    expect(probe()).toBe(`${A},${B}|-`);
    await act(async () => applyReadOutcome(session, AUTH, { scope: "one", ok: true, succeeded: [A], failed: [] }));
    expect(probe()).toBe(`${B}|-`);
  });

  it("«Отметить все» не удалась: запоминаются номера, оставшиеся неотмеченными; номера строк не трогает; записанные снимаются", async () => {
    const session = cabinet();
    await render(<Probe session={session} userKey={AUTH} />);
    await act(async () => applyReadOutcome(session, AUTH, { scope: "one", ok: false, succeeded: [], failed: [A] }));
    await act(async () => applyReadOutcome(session, AUTH, { scope: "all", ok: false, succeeded: [A], failed: [B] }));
    expect(probe()).toBe(`|${B}`); // A записана (сбой снят), не записана только B
  });

  it("номера «Отметить все» уходят по одному, когда уведомление отмечено любой записью; удачная «Отметить все» снимает всё", async () => {
    const session = cabinet();
    await render(<Probe session={session} userKey={AUTH} />);
    await act(async () => applyReadOutcome(session, AUTH, { scope: "all", ok: false, succeeded: [], failed: [A, B] }));
    expect(probe()).toBe(`|${A},${B}`);
    await act(async () => applyReadOutcome(session, AUTH, { scope: "one", ok: true, succeeded: [A], failed: [] }));
    expect(probe()).toBe(`|${B}`);
    await act(async () => applyReadOutcome(session, AUTH, { scope: "all", ok: false, succeeded: [], failed: [B] })); // повтор не удался: остаётся B
    expect(probe()).toBe(`|${B}`);
    await act(async () => applyReadOutcome(session, AUTH, { scope: "all", ok: true, succeeded: [B], failed: [] }));
    expect(probe()).toBe("|-");
  });

  it("удачная «Отметить все» снимает и номера, которых уже нет среди непрочитанных", async () => {
    const session = cabinet();
    await render(<Probe session={session} userKey={AUTH} />);
    await act(async () => applyReadOutcome(session, AUTH, { scope: "all", ok: false, succeeded: [], failed: [A, B] }));
    await act(async () => applyReadOutcome(session, AUTH, { scope: "all", ok: true, succeeded: [], failed: [] })); // уже всё прочитано
    expect(probe()).toBe("|-");
  });

  it("запись другого студента начинается с чистого листа: чужие номера к нему не переходят", async () => {
    const session = cabinet();
    await act(async () => applyReadOutcome(session, AUTH, { scope: "all", ok: false, succeeded: [], failed: [A] }));
    await act(async () => applyReadOutcome(session, AUTH, { scope: "one", ok: false, succeeded: [], failed: [B] }));
    await act(async () => applyReadOutcome(session, OTHER, { scope: "one", ok: true, succeeded: [], failed: [] }));
    await render(<Probe session={session} userKey={OTHER} />);
    expect(probe()).toBe("|-");
  });

  it("другой студент в том же кабинете чужих сбоев не видит", async () => {
    const session = cabinet();
    await act(async () => applyReadOutcome(session, AUTH, { scope: "one", ok: false, succeeded: [], failed: [A] }));
    await render(<Probe session={session} userKey={OTHER} />);
    expect(probe()).toBe("|-");
  });

  it("вход заново (новый кабинет, новый кэш) того же студента: прежние сбои не видны", async () => {
    const before = cabinet();
    await act(async () => applyReadOutcome(before, AUTH, { scope: "all", ok: false, succeeded: [], failed: [A, B] }));
    await act(async () => applyReadOutcome(before, AUTH, { scope: "one", ok: false, succeeded: [], failed: [A] }));
    const old = await render(<Probe session={before} userKey={AUTH} />);
    expect(probe()).toBe(`${A}|${A},${B}`);
    await old.unmount();
    await render(<Probe session={cabinet()} userKey={AUTH} />);
    expect(probe()).toBe("|-");
  });
});

describe("лента и экран ответа куратора видят один сбой (F4)", () => {
  it("сбой записи на ленте виден, пока уведомление не отмечено; удачная запись на экране ответа снимает плашку ленты", async () => {
    const row = { ...NOTIFICATION_ROW, notification_id: HELP_NOTIFICATION_ID, category: "case", event_code: "case_help_answer", subject_label: "Ответ куратора", detail: "Принесите справку" };
    let writes = 0;
    const { transport } = fakeTransport({
      student_portal_notifications_v2: [row],
      student_portal_help_reply_v1: helpReplyRow(),
      [WRITE]: () => (++writes === 1 ? failure("42501", 403) : {}),
    });
    await renderPortal(
      <>
        <UpdatesScreen />
        <ReplyScreen notificationId={HELP_NOTIFICATION_ID} />
      </>,
      testApi(transport, { userKey: AUTH }),
    );
    await fireEvent.press(await screen.findByTestId(`update-read-${HELP_NOTIFICATION_ID}`)); // на ленте не вышло
    expect(await screen.findByTestId(`update-read-error-${HELP_NOTIFICATION_ID}`)).toBeTruthy();
    expect(await screen.findByTestId("reply-read-error")).toBeTruthy(); // экран ответа видит тот же сбой
    await fireEvent.press(await screen.findByTestId("reply-mark-read")); // на экране ответа вышло
    await waitFor(() => expect(screen.queryByTestId(`update-read-error-${HELP_NOTIFICATION_ID}`)).toBeNull());
    expect(screen.queryByTestId("reply-read-error")).toBeNull();
  });
});
