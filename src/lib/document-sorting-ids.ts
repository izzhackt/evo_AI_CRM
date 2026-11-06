import { createHash } from "node:crypto";

/** Идентификатор команды разбора файла из amoCRM: из SHA-256 версии, вида и шага. Тот же вход - тот же идентификатор, поэтому повтор после обрыва ничего не двоит. */
export function sortingRequestId(versionId: string, kind: string, step: "metadata" | "review" | "resolve"): string {
  const hex = createHash("sha256").update(`amo-sort:${versionId}:${kind}:${step}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Не больше за одно обращение: интерфейс режет «Принять все уверенные» на порции и показывает ход, сервер не берёт больше. */
export const MAX_BULK_ACCEPT = 25;
