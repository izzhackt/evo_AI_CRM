// Что решает, показывать ли Эви: ключ на сервере (GET), согласие, ожидание первого чтения. Всё, что не удалось узнать, - как прежде.
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";

import type { EviApi } from "@/features/learning/evi/api";
import { useEviAvailable, useEviEntry, useEviGate } from "@/features/learning/evi/hooks";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { failure, fakeTransport } from "@/test-fixtures/universities";

const GRANTED = { status: "granted", policyVersion: "2026-10-25", decidedAt: "2026-11-01T10:00:00Z", currentPolicyVersion: "2026-10-25" };
const DECLINED = { ...GRANTED, status: "declined" };
const evi = (available: EviApi["available"]): EviApi => ({ ask: jest.fn(), available });

function Probe({ api, label = "probe" }: { api: EviApi; label?: string }) {
  const available = useEviAvailable(api);
  const entry = useEviEntry(api);
  const gate = useEviGate(api);
  return <Text testID={label}>{JSON.stringify({ available, shown: entry.shown, gate })}</Text>;
}
/** Экран, который можно закрыть и открыть заново, не трогая кэш кабинета (как «Назад» и возврат). */
function Remountable({ api }: { api: EviApi }) {
  const [round, setRound] = useState(0);
  return (
    <>
      <Pressable testID="remount" onPress={() => setRound((current) => current + 1)} />
      <Probe key={round} api={api} />
    </>
  );
}
const read = (label = "probe") => JSON.parse(screen.getByTestId(label).props.children as string) as { available: boolean | null; shown: boolean; gate: { state: string; offline: boolean } };

describe("useEviAvailable: GET один раз за сеанс", () => {
  it("пока не ответил - null (ведём себя как прежде); ответ true и false доходит как есть", async () => {
    for (const answer of [true, false]) {
      let release: (value: boolean) => void = () => undefined;
      const api = evi(() => new Promise<boolean>((resolve) => (release = resolve)));
      const view = await renderPortal(<Probe api={api} />, testApi(fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport));
      expect(read().available).toBeNull();
      expect(read().shown).toBe(true);
      await act(async () => release(answer));
      await waitFor(() => expect(read().available).toBe(answer));
      expect(read().shown).toBe(answer);
      await view.unmount();
    }
  });

  it("ответ одного сеанса читается один раз: второй экран и возврат на тот же берут его из кэша кабинета", async () => {
    const available = jest.fn(async () => true);
    const view = await renderPortal(
      <>
        <Probe api={evi(available)} label="first" />
        <Probe api={evi(available)} label="second" />
      </>,
      testApi(fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport),
    );
    await waitFor(() => expect(read("first").available).toBe(true));
    expect(read("second").available).toBe(true);
    expect(available).toHaveBeenCalledTimes(1);
    await view.unmount();

    const again = await renderPortal(<Remountable api={evi(available)} />, testApi(fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport));
    await waitFor(() => expect(read().available).toBe(true));
    expect(available).toHaveBeenCalledTimes(2);
    await fireEvent.press(screen.getByTestId("remount"));
    expect(read().available).toBe(true);
    expect(available).toHaveBeenCalledTimes(2);
    await again.unmount();
  });

  it("не узнали (null, сбой, старый сервер): Эви показана, чат открывается; кэш не кладёт «нет» на весь сеанс", async () => {
    for (const available of [async () => null, async () => { throw new Error("offline"); }, undefined]) {
      const view = await renderPortal(<Probe api={evi(available)} />, testApi(fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport));
      await waitFor(() => expect(read().gate.state).toBe("open"));
      expect(read()).toMatchObject({ available: null, shown: true, gate: { state: "open", offline: false } });
      await view.unmount();
    }
  });

  describe("срок ответа", () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date("2026-11-25T10:00:00Z") }));
    afterEach(() => jest.useRealTimers());
    const mount = (available: jest.Mock) => renderPortal(<Remountable api={evi(available)} />, testApi(fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport));
    const later = async (ms: number) => {
      await act(async () => void jest.setSystemTime(Date.now() + ms));
      await fireEvent.press(screen.getByTestId("remount"));
      await act(async () => void jest.advanceTimersByTime(0));
    };

    it("известный ответ свеж пять минут: через четыре возврат его не перечитывает, через шесть - перечитывает", async () => {
      const known = jest.fn(async () => true);
      await mount(known);
      await act(async () => void jest.advanceTimersByTime(0));
      expect(known).toHaveBeenCalledTimes(1);
      await later(4 * 60_000);
      expect(known).toHaveBeenCalledTimes(1);
      await later(2 * 60_000);
      expect(known).toHaveBeenCalledTimes(2);
    });

    it("«не узнали» свежо только полминуты: короткий сбой не прячет настоящий ответ на весь сеанс", async () => {
      const unknown = jest.fn<Promise<boolean | null>, []>(async () => null);
      await mount(unknown);
      await act(async () => void jest.advanceTimersByTime(0));
      expect(unknown).toHaveBeenCalledTimes(1);
      await later(20_000);
      expect(unknown).toHaveBeenCalledTimes(1);
      unknown.mockResolvedValue(false);
      await later(20_000);
      expect(unknown).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(read().available).toBe(false));
    });
  });
});

describe("согласие и ключ вместе (страница «Профессии» веба: eviAvailable(consent) && eviOnline)", () => {
  const cases: [string, unknown, boolean | null, { shown: boolean; state: string; offline: boolean }][] = [
    ["согласие есть, ключ есть", GRANTED, true, { shown: true, state: "open", offline: false }],
    ["согласие есть, ключа нет", GRANTED, false, { shown: false, state: "open", offline: true }],
    ["согласие есть, ключ не узнали", GRANTED, null, { shown: true, state: "open", offline: false }],
    ["согласие отозвано, ключ есть", DECLINED, true, { shown: false, state: "redirect", offline: false }],
    ["согласие отозвано, ключа нет", DECLINED, false, { shown: false, state: "redirect", offline: false }],
    ["согласие отозвано, ключ не узнали", DECLINED, null, { shown: false, state: "redirect", offline: false }],
    ["согласие не прочиталось, ключ есть", failure("XX000", 500), true, { shown: true, state: "open", offline: false }],
    ["согласие не прочиталось, ключа нет", failure("XX000", 500), false, { shown: false, state: "open", offline: true }],
  ];
  it.each(cases)("%s", async (_name, consent, available, expected) => {
    const api = evi(async () => available);
    await renderPortal(<Probe api={api} />, testApi(fakeTransport({ portal_ai_consent_get_v1: consent }).transport));
    await waitFor(() => expect(read().gate.state).not.toBe("checking"));
    if (available !== null) await waitFor(() => expect(read().available).toBe(available));
    expect(read().shown).toBe(expected.shown);
    expect(read().gate).toEqual({ state: expected.state, offline: expected.offline });
  });

  it("пока согласие читается первый раз - «checking»; первая же неудача снимает ожидание (не ждём повторов)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = fakeTransport({ portal_ai_consent_get_v1: GRANTED }).transport;
    await renderPortal(<Probe api={evi(async () => true)} />, testApi(async (name, args, options) => {
      await gate;
      return base(name, args, options);
    }));
    expect(read().gate.state).toBe("checking");
    release();
    await waitFor(() => expect(read().gate.state).toBe("open"));
  });
});
