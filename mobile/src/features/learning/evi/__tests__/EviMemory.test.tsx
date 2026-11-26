import { render } from "@testing-library/react-native";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useEffect, type ReactNode } from "react";

import { EviMemoryProvider, useEviMemory } from "@/features/learning/evi/EviMemory";
import type { EviMemory, EviSnapshot } from "@web/lib/portal/evi-memory";

const talk: EviSnapshot = {
  messages: [
    { role: "assistant", text: "Привет! Я Эви", mood: "happy" },
    { role: "user", text: "Рисую" },
  ],
  options: { options: [], multi: false },
  failure: null,
};

/** Отдаёт память наружу, как её берёт экран: один раз за показ, дальше тест держит её в руке. */
function Probe({ owner, onMemory }: { owner: string | null; onMemory: (memory: EviMemory | null) => void }) {
  const memory = useEviMemory(owner);
  useEffect(() => onMemory(memory), [memory, onMemory]);
  return null;
}

function holder() {
  const seen: (EviMemory | null)[] = [];
  return { seen, onMemory: (memory: EviMemory | null) => void seen.push(memory), last: () => seen[seen.length - 1] ?? null };
}

function Cabinet({ children }: { children: ReactNode }) {
  return <EviMemoryProvider>{children}</EviMemoryProvider>;
}

describe("память разговора с Эви (веб #1530)", () => {
  it("вне оболочки кабинета и без метки студента памяти нет: разговор живёт, пока открыт экран", async () => {
    const outside = holder();
    await render(<Probe owner="student-a" onMemory={outside.onMemory} />);
    expect(outside.last()).toBeNull();
    const noOwner = holder();
    await render(
      <Cabinet>
        <Probe owner={null} onMemory={noOwner.onMemory} />
      </Cabinet>,
    );
    expect(noOwner.last()).toBeNull();
  });

  it("студент получает свой разговор обратно, другой - ничего, а приветствие другого стирает прежний разговор", async () => {
    const a = holder();
    const b = holder();
    await render(
      <Cabinet>
        <Probe owner="student-a" onMemory={a.onMemory} />
        <Probe owner="student-b" onMemory={b.onMemory} />
      </Cabinet>,
    );
    a.last()!.save(talk);
    expect(a.last()!.load()).toBe(talk);
    expect(b.last()!.load()).toBeNull();
    // Приветствие второго студента (снимок null) освобождает хранилище: первый разговор больше не вернуть никому.
    b.last()!.save(null);
    expect(a.last()!.load()).toBeNull();
    expect(b.last()!.load()).toBeNull();
  });

  it("хранилище принадлежит оболочке: новая оболочка (выход, новый запуск приложения) пуста", async () => {
    const first = holder();
    const view = await render(
      <Cabinet>
        <Probe owner="student-a" onMemory={first.onMemory} />
      </Cabinet>,
    );
    first.last()!.save(talk);
    expect(first.last()!.load()).toBe(talk);
    await view.unmount();

    const second = holder();
    await render(
      <Cabinet>
        <Probe owner="student-a" onMemory={second.onMemory} />
      </Cabinet>,
    );
    expect(second.last()!.load()).toBeNull();
  });

  it("память одного студента - один и тот же объект между показами: эффект разговора не пишет заново без нужды", async () => {
    const memory = holder();
    const view = await render(
      <Cabinet>
        <Probe owner="student-a" onMemory={memory.onMemory} />
      </Cabinet>,
    );
    await view.rerender(
      <Cabinet>
        <Probe owner="student-a" onMemory={memory.onMemory} />
      </Cabinet>,
    );
    expect(new Set(memory.seen).size).toBe(1);
  });

  it("на устройство ничего не пишется: ни хранилища, ни файлов, ни защищённых записей (правило владельца 17.11)", () => {
    for (const file of ["EviMemory.tsx", "EviScreen.tsx"]) {
      const code = readFileSync(join(__dirname, "..", file), "utf8").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/async-storage|AsyncStorage|expo-secure-store|SecureStore|expo-file-system|large-secure-store|localStorage|sessionStorage|indexedDB/iu);
    }
  });
});
