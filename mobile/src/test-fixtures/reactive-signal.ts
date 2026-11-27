// Сигнал для подмен хуков: подменённый хук подписывается на него через `useSyncExternalStore` и перерисовывает САМ компонент, когда
// тест вызвал `emit()` (внутри `act`). Настоящие `useSession` (контекст), `useUpdates` (useState и слушатель родного модуля) и
// `useFonts` (useState) работают именно так. Подмена, которая читает переменную теста и «меняется» только тем, что тест перерисовал
// родителя, так не работает, и это видно только с компилятором React. Приложение собрано с ним (`experiments.reactCompiler`), а
// `npm test` его не включает; `jest.compiler.config.js` включает. Родитель без свойств, скомпилированный, отдаёт один и тот же
// кэшированный элемент, React не заходит в потомка, и подмена не перечитывается. Тест на подмене с сигналом проходит и так, и так.
//
//   const mockSignal = createSignal();
//   jest.mock("expo-font", () => ({ useFonts: () => { MockReact.useSyncExternalStore(mockSignal.subscribe, mockSignal.version); return [mockFonts.loaded]; } }));
//   ...
//   await act(async () => { mockFonts.loaded = true; mockSignal.emit(); });

export type Signal = Readonly<{
  subscribe: (listener: () => void) => () => void;
  /** Номер состояния: растёт на каждый `emit()`, поэтому `useSyncExternalStore(subscribe, version)` видит перемену. */
  version: () => number;
  /** «Источник изменился»: все подписанные компоненты перерисовываются. Вызывать внутри `act`. */
  emit: () => void;
}>;

export function createSignal(): Signal {
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
    emit: () => {
      version += 1;
      for (const listener of [...listeners]) listener();
    },
  };
}
