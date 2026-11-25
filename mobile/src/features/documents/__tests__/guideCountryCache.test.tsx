// Кэш страны дела для справки «Пример» (миграция 373): ключ у каждого студента свой, значение живёт, пока открыт кабинет,
// перечитывается опросом и вытягиванием экрана. Кабинет с настоящими настройками кэша (`createPortalQueryClient`):
// обычный тестовый кэш не стареет и не выгружается ничего и скрыл бы, как это устроено на самом деле.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { DocumentsScreen } from "@/features/documents/DocumentsScreen";
import { CASE_ID, MEDICAL, S_MEDICAL, choice, directions, makeIo, openGuide } from "@/test-fixtures/document-guide";
import { PortalShell, testApi, testClient } from "@/test-fixtures/render";
import { failure, fakeTransport, type Call } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock("@/features/documents/native", () => ({
  pickFromFiles: jest.fn(),
  pickFromPhotos: jest.fn(),
  pickFromCamera: jest.fn(),
  createUploadSend: jest.fn(),
  createDownloadDeps: jest.fn(),
  openLocalFile: jest.fn(),
}));

const DIRECTIONS = "student_portal_case_directions_v1";
const count = (calls: readonly Call[], name: string) => calls.filter((call) => call.name === name).length;
const handlers = (extra: Record<string, unknown> = {}) => ({
  student_portal_documents: [MEDICAL],
  student_portal_case_files_v1: [],
  student_country_choice_v1: choice("MY"),
  ...extra,
});
const blank = (slotId = S_MEDICAL) => `guide-${slotId}-blank`;
const closeSheet = async () => {
  await fireEvent.press(await screen.findByTestId(`guide-${S_MEDICAL}-close`));
  await waitFor(() => expect(screen.queryByTestId(`guide-${S_MEDICAL}-sheet`)).toBeNull());
};

describe("страна дела в кэше кабинета", () => {
  it("ключ у каждого студента свой: на общем кэше студент B читает страну заново и значение студента A ему не достаётся", async () => {
    const client = testClient("production");
    const a = fakeTransport(handlers({ [DIRECTIONS]: directions([CASE_ID, "CN"]) }));
    const b = fakeTransport(handlers({ [DIRECTIONS]: [] }));
    const io = makeIo().io;
    const shell = (userKey: string, transport: typeof a.transport): ReactElement => (
      <PortalShell api={testApi(transport, { userKey })} client={client}>
        <DocumentsScreen io={io} />
      </PortalShell>
    );

    const view = await render(shell("user-A", a.transport));
    await openGuide(S_MEDICAL);
    expect(await screen.findByTestId(blank())).toBeTruthy();
    await closeSheet();
    expect(count(a.calls, DIRECTIONS)).toBe(1);

    await view.rerender(shell("user-B", b.transport));
    await waitFor(() => expect(count(b.calls, DIRECTIONS)).toBe(1));
    await openGuide(S_MEDICAL);
    await screen.findByTestId(`guide-${S_MEDICAL}-sheet`);
    // у B страны дела нет, выбор - Малайзия: бланка Китая нет (значение A дало бы его)
    expect(screen.queryByTestId(blank())).toBeNull();
    expect(client.getQueryData(["portal", "user-B", "case-directions"])).toEqual(new Map());
    expect(client.getQueryData(["portal", "user-A", "case-directions"])).toEqual(new Map([[CASE_ID, "CN"]]));
    // и обратно: A возвращается к своему значению без нового чтения (оно ещё в кэше)
    await closeSheet();
    await view.rerender(shell("user-A", a.transport));
    await openGuide(S_MEDICAL);
    expect(await screen.findByTestId(blank())).toBeTruthy();
    expect(count(a.calls, DIRECTIONS)).toBe(1);
  });

  it("со своими настройками кэш держит страну дела весь открытый кабинет: она не стареет и не выгружается, а другие чтения - стареют и выгружаются", async () => {
    jest.useFakeTimers();
    try {
      const client = testClient("production");
      const t = fakeTransport(handlers({ [DIRECTIONS]: directions([CASE_ID, "CN"]) }));
      const io = makeIo().io;
      const api = testApi(t.transport);
      const shell = (visible: boolean): ReactElement => (
        <PortalShell api={api} client={client}>
          {visible ? <DocumentsScreen io={io} /> : null}
        </PortalShell>
      );

      const view = await render(shell(true));
      await waitFor(() => expect(count(t.calls, DIRECTIONS)).toBe(1));
      await waitFor(() => expect(count(t.calls, "student_portal_documents")).toBe(1));
      expect(client.getQueryCache().findAll({ queryKey: ["portal", "user-test", "case-directions"] })).toHaveLength(1);

      // минута на другом экране: обычное чтение «постарело» (30 с) и читается заново, страна дела - нет
      await view.rerender(shell(false));
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      await view.rerender(shell(true));
      await waitFor(() => expect(count(t.calls, "student_portal_documents")).toBeGreaterThanOrEqual(2));
      expect(count(t.calls, DIRECTIONS)).toBe(1);

      // одиннадцать минут: обычные чтения выгружены из кэша (10 мин), страна дела осталась
      const before = count(t.calls, "student_portal_documents");
      await view.rerender(shell(false));
      await act(async () => {
        jest.advanceTimersByTime(11 * 60_000);
      });
      expect(client.getQueryData(["portal", "user-test", "documents"])).toBeUndefined();
      expect(client.getQueryData(["portal", "user-test", "case-directions"])).toEqual(new Map([[CASE_ID, "CN"]]));
      await view.rerender(shell(true));
      await waitFor(() => expect(count(t.calls, "student_portal_documents")).toBeGreaterThan(before));
      expect(count(t.calls, DIRECTIONS)).toBe(1);
      // лист открывается уже со страной дела: бланк Китая виден сразу, без ожидания
      await openGuide(S_MEDICAL);
      expect(await screen.findByTestId(blank())).toBeTruthy();
      expect(count(t.calls, DIRECTIONS)).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("опрос оболочки (invalidateQueries по кабинету) перечитывает страну дела, и новая страна применяется", async () => {
    const client = testClient("production");
    let call = 0;
    const t = fakeTransport(handlers({ [DIRECTIONS]: () => (++call === 1 ? directions([CASE_ID, "CN"]) : directions([CASE_ID, "MY"])) }));
    await render(
      <PortalShell api={testApi(t.transport)} client={client}>
        <DocumentsScreen io={makeIo().io} />
      </PortalShell>,
    );
    await openGuide(S_MEDICAL);
    expect(await screen.findByTestId(blank())).toBeTruthy();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["portal", "user-test"], refetchType: "active" });
    });
    await waitFor(() => expect(count(t.calls, DIRECTIONS)).toBe(2));
    // дело стало малайзийским: лист показывает схему, бланка Китая больше нет
    await waitFor(() => expect(screen.queryByTestId(blank())).toBeNull());
    expect(screen.getByTestId(`guide-${S_MEDICAL}-sheet`)).toBeTruthy();
  });

  it("сбой перечитывания оставляет прежнюю страну дела, а не обнуляет справку", async () => {
    const client = testClient("production");
    let call = 0;
    const t = fakeTransport(handlers({ [DIRECTIONS]: () => (++call === 1 ? directions([CASE_ID, "CN"]) : failure("42501", 403)) }));
    await render(
      <PortalShell api={testApi(t.transport)} client={client}>
        <DocumentsScreen io={makeIo().io} />
      </PortalShell>,
    );
    await openGuide(S_MEDICAL);
    expect(await screen.findByTestId(blank())).toBeTruthy();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["portal", "user-test"], refetchType: "active" });
    });
    await waitFor(() => expect(count(t.calls, DIRECTIONS)).toBe(2));
    expect(client.getQueryState(["portal", "user-test", "case-directions"])?.status).toBe("error");
    expect(screen.getByTestId(blank())).toBeTruthy();
  });
});
