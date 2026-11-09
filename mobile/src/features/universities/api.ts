// Чтения и записи «Университетов» через RPC схемы `platform`. Транспорт приходит
// аргументом (тесты без сети). Контракты: docs/catalog/geography-costs-contract.md,
// web-portal-spec §2.3. Тексты ошибок сервера дальше слоя не уходят.
import { parseCatalogPreparationReceipt, type CatalogPreparationIntent, type CatalogPreparationReceipt } from "@web/lib/portal/catalog-preparations";
import { parseFavoriteReceipt, parseUniversityFavorites } from "@web/lib/portal/university-favorites";
import {
  parseStudentUniversityDetail,
  parseStudentUniversityIndexResponse,
  type StudentUniversityDetail,
  type StudentUniversityIndex,
} from "@web/lib/portal/university-index";

import { PortalDecodeError } from "@/domain/portal-source";
import { createWrite, RpcError, rpcRead, rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";

import type { IndexDisk } from "./cache";

export type IndexLoad = Readonly<{
  index: StudentUniversityIndex;
  /** true: сеть недоступна или проверка версии не удалась, показана копия. */
  refreshFailed: boolean;
}>;

/** Копия из диска/памяти: только полная, верно разобранная выдача. */
export function decodeIndexBody(body: unknown): StudentUniversityIndex | null {
  const parsed = parseStudentUniversityIndexResponse(body);
  return parsed && !parsed.notModified ? parsed.index : null;
}

/**
 * Индекс каталога: копия с диска (если не в памяти), один вызов с `p_known_version`.
 * `notModified` обязан назвать ту же версию, что у копии, иначе это сбой. Сбой при
 * наличии копии оставляет копию (`refreshFailed`), без копии - ошибка. 42501 удаляет копию.
 */
export async function loadUniversityIndex(
  transport: RpcTransport,
  disk: IndexDisk,
  userKey: string,
  memory: StudentUniversityIndex | null,
): Promise<IndexLoad> {
  let copy = memory;
  if (copy === null) {
    const body = await disk.read(userKey);
    copy = body === null ? null : decodeIndexBody(body);
    if (body !== null && copy === null) await disk.remove(userKey);
  }
  try {
    const data = await rpcRead(transport, "student_university_index_v1", { p_known_version: copy?.version ?? null });
    const parsed = parseStudentUniversityIndexResponse(data);
    if (!parsed) throw new PortalDecodeError();
    if (parsed.notModified) {
      if (copy === null || copy.version !== parsed.version) throw new PortalDecodeError();
      return { index: copy, refreshFailed: false };
    }
    await disk.write(userKey, data);
    return { index: parsed.index, refreshFailed: false };
  } catch (error) {
    if (error instanceof RpcError && error.kind === "forbidden") {
      await disk.remove(userKey);
      throw error;
    }
    if (copy !== null) return { index: copy, refreshFailed: true };
    throw error;
  }
}

/** Вуз чужой, неизвестный или вне шести стран (42501). */
export class UniversityNotFoundError extends Error {
  constructor() {
    super("University not found");
    this.name = "UniversityNotFoundError";
  }
}

export async function readUniversityDetail(transport: RpcTransport, institutionId: string): Promise<StudentUniversityDetail> {
  let data: unknown;
  try {
    data = await rpcRead(transport, "student_university_detail_v1", { p_institution_id: institutionId });
  } catch (error) {
    if (error instanceof RpcError && error.kind === "forbidden") throw new UniversityNotFoundError();
    throw error;
  }
  const detail = parseStudentUniversityDetail(data, institutionId);
  if (!detail) throw new PortalDecodeError();
  return detail;
}

export async function readFavoriteIds(transport: RpcTransport): Promise<readonly string[]> {
  const saved = parseUniversityFavorites(await rpcRead(transport, "student_university_favorites_v1"));
  if (!saved) throw new PortalDecodeError();
  return saved.map((favorite) => favorite.institutionId);
}

/**
 * Сердечко. `set_university_favorite_v1(p_institution_id, p_favored)` идемпотентна по
 * построению (состояние, а не переключение) и НЕ принимает `p_request_id`, поэтому замороженная
 * запись общего слоя здесь не подходит (она добавила бы лишний аргумент). Повтор после обрыва
 * шлёт те же аргументы; правда - квитанция сервера.
 */
export async function setFavorite(transport: RpcTransport, institutionId: string, favored: boolean, retries = 2): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const receipt = parseFavoriteReceipt(await rpcRead(transport, "set_university_favorite_v1", { p_institution_id: institutionId, p_favored: favored }));
      if (!receipt.ok) throw new PortalDecodeError();
      return receipt.favored;
    } catch (error) {
      if (!(error instanceof RpcError) || error.kind !== "transport" || attempt >= retries) throw error;
    }
  }
}

/**
 * Запись выбора программы: замораживается один раз на набор, повтор шлёт тот же запрос
 * (`p_request_id`). Подготовка документов открывается отдельно (экран программы), здесь
 * только выбор.
 */
export function selectProgramWrite(intent: Omit<CatalogPreparationIntent, "requestId">): FrozenWrite {
  return createWrite("student_select_catalog_intake_v1", {
    p_student_case_id: intent.studentCaseId,
    p_catalog_institution_id: intent.institutionId,
    p_program_id: intent.programId,
    p_intake_id: intent.intakeId,
    p_publication_version: intent.publicationVersion,
  });
}

export async function selectProgram(
  transport: RpcTransport,
  write: FrozenWrite,
  intent: Omit<CatalogPreparationIntent, "requestId">,
): Promise<CatalogPreparationReceipt> {
  const data = await rpcWrite(transport, write);
  const receipt = parseCatalogPreparationReceipt(data, { ...intent, requestId: write.requestId });
  if (!receipt) throw new PortalDecodeError();
  return receipt;
}
