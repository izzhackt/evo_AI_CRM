import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { clearPerUserUiState, parseOpenSteps, useFolded, useOpenSteps } from "@/features/admission/useOpenSteps";

const view = { file: "my", contentVersion: 4, steps: [{ id: "a" }, { id: "b" }] };

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("parseOpenSteps", () => {
  const known = new Set(["a", "b"]);
  it("берёт только известные шаги", () => {
    expect([...parseOpenSteps('["a","zzz","b",3]', known)]).toEqual(["a", "b"]);
  });
  it.each([[null], [""], ["{"], ['{"a":1}'], ['"a"']])("битое значение %j: пусто", (raw) => {
    expect(parseOpenSteps(raw, known).size).toBe(0);
  });
});

describe("раскрытые шаги", () => {
  it("помнятся под ключом файла и версии контента", async () => {
    const first = await renderHook(() => useOpenSteps(view, "u1"));
    await act(async () => first.result.current.toggle("b"));
    expect([...first.result.current.open]).toEqual(["b"]);
    await waitFor(async () => expect(await AsyncStorage.getItem("evo.portal.timeline.open.v1:u1:my:4")).toBe('["b"]'));
    await first.unmount();

    const second = await renderHook(() => useOpenSteps(view, "u1"));
    await waitFor(() => expect([...second.result.current.open]).toEqual(["b"]));
    // другая версия контента: память не переносится
    const other = await renderHook(() => useOpenSteps({ ...view, contentVersion: 5 }, "u1"));
    expect(other.result.current.open.size).toBe(0);
  });
  it("повторное нажатие закрывает шаг", async () => {
    const hook = await renderHook(() => useOpenSteps(view, "u1"));
    await act(async () => hook.result.current.toggle("a"));
    await act(async () => hook.result.current.toggle("a"));
    expect(hook.result.current.open.size).toBe(0);
  });
  it("без пути ничего не читается и не пишется", async () => {
    const hook = await renderHook(() => useOpenSteps(null, "u1"));
    await act(async () => hook.result.current.toggle("a"));
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });
});

describe("свёрнутость пути", () => {
  it("по умолчанию как задано, выбор студента запоминается", async () => {
    const first = await renderHook(() => useFolded(true, "u1"));
    expect(first.result.current.folded).toBe(true);
    await act(async () => first.result.current.setFolded(false));
    expect(first.result.current.folded).toBe(false);
    await first.unmount();
    const second = await renderHook(() => useFolded(true, "u1"));
    await waitFor(() => expect(second.result.current.folded).toBe(false));
  });
  it("выбор до ответа хранилища не затирается", async () => {
    await AsyncStorage.setItem("evo.portal.timeline.open.v1:u1:folded", "1");
    const hook = await renderHook(() => useFolded(false, "u1"));
    await act(async () => hook.result.current.setFolded(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hook.result.current.folded).toBe(false);
  });
});

describe("состояние привязано к студенту", () => {
  it("студент B не наследует раскрытые шаги и свёрнутость студента A", async () => {
    const a = await renderHook(() => useOpenSteps(view, "u-a"));
    await act(async () => a.result.current.toggle("a"));
    const folded = await renderHook(() => useFolded(false, "u-a"));
    await act(async () => folded.result.current.setFolded(true));
    await a.unmount();
    await folded.unmount();

    const b = await renderHook(() => useOpenSteps(view, "u-b"));
    const bFolded = await renderHook(() => useFolded(false, "u-b"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(b.result.current.open.size).toBe(0);
    expect(bFolded.result.current.folded).toBe(false);
  });
  it("при выходе удаляются все ключи пути, чужие ключи остаются", async () => {
    await AsyncStorage.multiSet([
      ["evo.portal.timeline.open.v1:u-a:my:4", '["a"]'],
      ["evo.portal.timeline.open.v1:u-a:folded", "1"],
      ["other.key", "x"],
    ]);
    await clearPerUserUiState();
    expect(await AsyncStorage.getAllKeys()).toEqual(["other.key"]);
  });
});
