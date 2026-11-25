// Сбои записи «прочитано» живут в общем хранилище по студенту и уведомлению (разбор ревью #1557, F4): экран ответа куратора и лента
// «Что нового» видят одно и то же, а удачная запись с любого экрана снимает плашку.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { applyReadOutcome, resetReadFailuresForTests, useReadFailures } from "@/features/inbox/read-failures";
import { ReplyScreen } from "@/features/inbox/ReplyScreen";
import { UpdatesScreen } from "@/features/inbox/UpdatesScreen";
import { HELP_NOTIFICATION_ID, helpReplyRow } from "@/test-fixtures/program-decisions";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { NOTIFICATION_ROW } from "@/test-fixtures/rpc-rows";
import { failure, fakeTransport } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useRouter: () => ({ back: jest.fn(), canGoBack: () => true, navigate: jest.fn() }), usePathname: () => "/messages" }));
jest.mock("@/features/inbox/visibility", () => ({ useScreenVisible: jest.fn(() => true) }));

const AUTH = "11111111-1111-4111-8111-111111111111";
const A = "66666666-6666-4666-8666-6666666666aa";
const B = "66666666-6666-4666-8666-6666666666bb";
const WRITE = "mark_own_student_portal_notification_read_v2";

afterEach(() => resetReadFailuresForTests());

function Probe({ userKey }: { userKey: string }) {
  const { failed, all } = useReadFailures(userKey);
  return <Text testID="probe">{`${[...failed].sort().join(",")}|${all ? "all" : "-"}`}</Text>;
}
const probe = () => screen.getByTestId("probe").props.children as string;

describe("хранилище сбоев записи «прочитано»", () => {
  it("сбой одного уведомления привязан к его номеру; удачная запись этого номера снимает его, чужого - нет", async () => {
    await render(<Probe userKey={AUTH} />);
    expect(probe()).toBe("|-");
    await act(async () => applyReadOutcome(AUTH, { scope: "one", ok: false, succeeded: [], failed: [A] }));
    await act(async () => applyReadOutcome(AUTH, { scope: "one", ok: false, succeeded: [], failed: [B] }));
    expect(probe()).toBe(`${A},${B}|-`);
    await act(async () => applyReadOutcome(AUTH, { scope: "one", ok: true, succeeded: [A], failed: [] }));
    expect(probe()).toBe(`${B}|-`);
  });

  it("«Отметить все» не удалась: общий признак, номера строк не трогает; частичный успех снимает записанные", async () => {
    await render(<Probe userKey={AUTH} />);
    await act(async () => applyReadOutcome(AUTH, { scope: "one", ok: false, succeeded: [], failed: [A] }));
    await act(async () => applyReadOutcome(AUTH, { scope: "all", ok: false, succeeded: [A], failed: [B] }));
    expect(probe()).toBe("|all"); // A записана (сбой снят), B не записана, общий признак стоит
  });

  it("удачная «Отметить все» снимает общий признак; удачная одна запись его не снимает", async () => {
    await render(<Probe userKey={AUTH} />);
    await act(async () => applyReadOutcome(AUTH, { scope: "all", ok: false, succeeded: [], failed: [A, B] }));
    await act(async () => applyReadOutcome(AUTH, { scope: "one", ok: true, succeeded: [A], failed: [] }));
    expect(probe()).toBe("|all");
    await act(async () => applyReadOutcome(AUTH, { scope: "all", ok: true, succeeded: [A, B], failed: [] }));
    expect(probe()).toBe("|-");
  });

  it("запись другого студента начинается с чистого листа: чужие номера и общий признак к нему не переходят", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    await act(async () => applyReadOutcome(AUTH, { scope: "all", ok: false, succeeded: [], failed: [A] }));
    await act(async () => applyReadOutcome(AUTH, { scope: "one", ok: false, succeeded: [], failed: [B] }));
    await act(async () => applyReadOutcome(OTHER, { scope: "one", ok: true, succeeded: [], failed: [] }));
    await render(<Probe userKey={OTHER} />);
    expect(probe()).toBe("|-");
  });

  it("другой студент на том же устройстве чужих сбоев не видит", async () => {
    await act(async () => applyReadOutcome(AUTH, { scope: "one", ok: false, succeeded: [], failed: [A] }));
    await render(<Probe userKey="22222222-2222-4222-8222-222222222222" />);
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
