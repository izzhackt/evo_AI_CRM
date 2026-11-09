// Синтетические карточки вузов и подготовки программ в форме строгих разборщиков веба.
// Названия и адреса придуманы.
import { RpcError, type RpcTransport, type RpcTransportResult } from "@/lib/rpc";

export const STUDENT_CASE_ID = "33333333-3333-4333-8333-333333333333";

export function uuidN(n: number, prefix = "aaaaaaaa"): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function universityContent(name: string, opts: { country?: string; city?: string | null; deadline?: string | null } = {}) {
  return {
    name,
    country: opts.country ?? "MY",
    city: opts.city === undefined ? "Куала-Лумпур" : opts.city,
    overview: "Описание университета для теста.",
    websiteUrl: "https://example.org/uni",
    sourceUrl: "https://example.org/source",
    verifiedOn: "2026-10-01",
    notes: "",
    photoKey: null,
    programs: [
      {
        id: "cs",
        title: "Информатика",
        level: "bachelor",
        duration: null,
        language: null,
        summary: "",
        sourceUrl: "https://example.org/cs",
        intakes: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            label: "Осень 2027",
            startDate: null,
            startMonth: "2027-09",
            applicationDeadline: opts.deadline === undefined ? "2027-05-01" : opts.deadline,
            deadlineTime: null,
            timezone: null,
            status: "open",
            note: "",
            sourceUrl: "https://example.org/intake",
            verifiedOn: "2026-10-01",
          },
        ],
      },
    ],
  };
}

export function universityRow(n: number, name = `Университет ${n}`, opts: Parameters<typeof universityContent>[1] = {}) {
  return { id: uuidN(n), version: 1, publishedAt: "2026-10-01T00:00:00+00:00", content: universityContent(name, opts) };
}

export function preparationRow(n: number, status = "preparation") {
  return {
    applicationId: uuidN(n, "bbbbbbbb"),
    studentCaseId: STUDENT_CASE_ID,
    institutionId: uuidN(n),
    programId: "cs",
    intakeId: "11111111-1111-4111-8111-111111111111",
    publicationId: uuidN(n, "cccccccc"),
    publicationVersion: 1,
    catalogLevel: "bachelor",
    applicationDegree: "bachelor",
    selectedAt: "2026-10-05T08:00:00+00:00",
    deadlineStateAtSelection: "needs_confirmation",
    applicationStatus: status,
    applicationVersion: "1",
    content: universityContent(`Университет ${n}`),
  };
}

export type Call = { name: string; args: Record<string, unknown> | undefined; get: boolean };

/**
 * Поддельный транспорт: ответы по имени RPC (значение, функция или RpcError-подобный
 * отказ). Записывает вызовы; сети нет.
 */
export type Handler = (args: Record<string, unknown> | undefined, call: number) => unknown;

export function fakeTransport(handlers: Record<string, unknown>) {
  const calls: Call[] = [];
  const transport: RpcTransport = async (name, args, options) => {
    calls.push({ name, args: args as Record<string, unknown> | undefined, get: options.get });
    const handler = handlers[name];
    if (handler === undefined) return { data: null, error: { code: "42883" }, status: 404 } satisfies RpcTransportResult;
    const count = calls.filter((c) => c.name === name).length;
    const value = typeof handler === "function" ? (handler as Handler)(args as Record<string, unknown> | undefined, count) : handler;
    if (value instanceof RpcError) throw value;
    if (value instanceof Error) throw value;
    if (value && typeof value === "object" && "__rpcFailure" in value) {
      const failure = value as unknown as { code: string | null; status: number };
      return { data: null, error: { code: failure.code }, status: failure.status };
    }
    return { data: value, error: null, status: 200 };
  };
  return { transport, calls };
}

export const failure = (code: string | null, status: number) => ({ __rpcFailure: true as const, code, status });
