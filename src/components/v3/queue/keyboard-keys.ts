/**
 * Клавиши CRM (Э7): одно описание для окна «?» очереди и окна оболочки.
 * Подсказки — в окне, а не текстом на странице (правило «Тихий интерфейс»).
 */
export type KeyHint = readonly [readonly string[], string];

/** Клавиши списка-очереди («Задачи», «Студенты», EVO Docs). */
export const QUEUE_KEYS: readonly KeyHint[] = [
  [["/"], "поиск"],
  [["↑", "↓"], "выбрать строку"],
  [["j", "k"], "то же"],
  [["Enter"], "открыть"],
  [["Esc"], "закрыть"],
];

/** Там, где у строк есть колонка выбора и массовые действия. */
export const SELECT_KEY: KeyHint = [["x"], "отметить строку"];

/** Поиск и переход — на любой странице. */
export const PALETTE_KEY: KeyHint = [["Ctrl", "K"], "поиск и переход"];
/** То же на Mac. */
export const PALETTE_MAC_KEY: KeyHint = [["⌘", "K"], "то же на Mac"];

/** Окно оболочки: на страницах без своей очереди. */
export const SHELL_KEYS: readonly KeyHint[] = [
  PALETTE_KEY,
  PALETTE_MAC_KEY,
  [["?"], "клавиши"],
  [["Esc"], "закрыть окно"],
];

/** Окно оболочки перечисляет и клавиши списков — они работают на «Задачах» и «Студентах». */
export const LIST_KEYS: readonly KeyHint[] = [...QUEUE_KEYS.slice(0, 4), SELECT_KEY];
