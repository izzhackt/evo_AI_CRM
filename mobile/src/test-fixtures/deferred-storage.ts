import AsyncStorage from "@react-native-async-storage/async-storage";

type Waiting = { key: string; resolve: (value: string | null) => void; reject: (reason: unknown) => void };

/**
 * Откладывает чтение выбора студента (тема, язык) с устройства: пока тест не вызвал `release`, провайдеры «не прочитали» выбор,
 * и видны кадры до чтения. Вызывается внутри `describe`: на каждый тест ставит отложенное чтение, после теста возвращает
 * настоящее (на памяти) хранилище. Запись (`setItem`) не затрагивается.
 */
export function deferredStorage() {
  const waiting: Waiting[] = [];
  const getItem = AsyncStorage.getItem as unknown as jest.Mock;
  let original: ((...args: never[]) => unknown) | undefined;

  beforeEach(() => {
    waiting.length = 0;
    original = getItem.getMockImplementation();
    getItem.mockImplementation(
      (key: string) =>
        new Promise<string | null>((resolve, reject) => {
          waiting.push({ key, resolve, reject });
        }),
    );
  });
  afterEach(() => {
    waiting.length = 0;
    getItem.mockImplementation(original);
  });

  return {
    /** Сколько чтений ждёт ответа. */
    pending: () => waiting.length,
    /** Все ждущие чтения получают значение по ключу (`null`, если на устройстве ничего нет). */
    release(values: Readonly<Record<string, string | null>> = {}) {
      for (const read of waiting.splice(0)) read.resolve(values[read.key] ?? null);
    },
    /** Отвечает только на чтение одного ключа. */
    answer(key: string, value: string | null) {
      for (const read of waiting.filter((r) => r.key === key)) {
        waiting.splice(waiting.indexOf(read), 1);
        read.resolve(value);
      }
    },
    /** Все ждущие чтения заканчиваются ошибкой. */
    fail() {
      for (const read of waiting.splice(0)) read.reject(new Error("хранилище недоступно"));
    },
  };
}
