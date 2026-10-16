import "server-only";

import { unstable_cache } from "next/cache";
import { cache } from "react";

import { universityUuid } from "../platform-university-catalog.ts";
import type { ActiveStudentPortalActor } from "../student-portal-auth";
import { createSupabaseServerClient } from "../supabase/server";
import {
  parseStudentUniversityDetail,
  parseStudentUniversityIndexResponse,
  type StudentUniversityDetail,
  type StudentUniversityIndex,
  type StudentUniversityIndexResponse,
} from "./university-index.ts";
import { STUDENT_UNIVERSITY_INDEX_TAG } from "./university-index-tag.ts";

/** Каталог не прочитан: экран честно говорит «не удалось загрузить». */
export class UniversityIndexUnavailableError extends Error {
  constructor() {
    super("University index unavailable");
    this.name = "UniversityIndexUnavailableError";
  }
}

/** Вуз чужой, неизвестный, неопубликованный или страны вне списка (42501). */
export class UniversityNotFoundError extends Error {
  constructor() {
    super("University not found");
    this.name = "UniversityNotFoundError";
  }
}

class IndexCacheMiss extends Error {}

async function callIndex(knownVersion: string | null): Promise<StudentUniversityIndexResponse> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("student_university_index_v1", { p_known_version: knownVersion });
  const parsed = error ? null : parseStudentUniversityIndexResponse(data);
  if (!parsed) throw new UniversityIndexUnavailableError();
  return parsed;
}

/*
 * Серверный кэш Next по (организация, версия), контракт 2.4. Индекс одинаков
 * для всех студентов организации и не содержит личных данных; версия меняется
 * при любой публикации. Кэш наполняется только значением, которое этот же
 * процесс только что получил от RPC с сессией студента (`pending`): функция
 * кэша сама в базу не ходит, промах кэша: исключение, а исключения Next не
 * кэширует. Публикация каталога сотрудником сбрасывает тег (старые версии
 * уходят из кэша).
 */
const pending = new Map<string, StudentUniversityIndex>();
const knownVersions = new Map<string, string>();

const cachedIndex = unstable_cache(
  async (organizationId: string, version: string): Promise<StudentUniversityIndex> => {
    const value = pending.get(`${organizationId}\u0000${version}`);
    if (!value) throw new IndexCacheMiss();
    return value;
  },
  ["portal-student-university-index-v1"],
  { tags: [STUDENT_UNIVERSITY_INDEX_TAG] },
);

async function remember(organizationId: string, index: StudentUniversityIndex): Promise<StudentUniversityIndex> {
  const key = `${organizationId}\u0000${index.version}`;
  pending.set(key, index);
  try {
    await cachedIndex(organizationId, index.version);
  } catch {
    // Кэш недоступен: страница всё равно получает свежий индекс.
  } finally {
    pending.delete(key);
  }
  knownVersions.set(organizationId, index.version);
  return index;
}

/**
 * Индекс каталога шести стран (одна выдача для стран, городов, карты и
 * поиска). Каждый показ вызывает RPC с известной версией: это и проверка
 * доступа студента в базе, и проверка свежести; при `notModified` индекс
 * отдаётся из кэша, иначе приходит целиком и кладётся в кэш. Без успешного
 * RPC этого показа кэш не отдаётся никогда.
 */
export const readStudentUniversityIndex = cache(async (actor: ActiveStudentPortalActor): Promise<StudentUniversityIndex> => {
  const organizationId = actor.organizationId;
  const known = knownVersions.get(organizationId) ?? null;
  const first = await callIndex(known);
  if (!first.notModified) return remember(organizationId, first.index);
  try {
    return await cachedIndex(organizationId, first.version);
  } catch {
    // Версия совпала, а копии нет (перезапуск, сброс тега): читаем целиком.
  }
  const full = await callIndex(null);
  if (full.notModified) throw new UniversityIndexUnavailableError();
  return remember(organizationId, full.index);
});

/**
 * Страница вуза одним вызовом (вместо четырёх): карточка, страна, город,
 * избранное, открытая консультация, подготовки и опубликованная стоимость.
 * Личные данные: между студентами не кэшируется.
 */
export async function readStudentUniversityDetail(institutionId: string): Promise<StudentUniversityDetail> {
  if (!universityUuid(institutionId)) throw new UniversityNotFoundError();
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("student_university_detail_v1", { p_institution_id: institutionId });
  if (error) {
    if (error.code === "42501") throw new UniversityNotFoundError();
    throw new UniversityIndexUnavailableError();
  }
  const detail = parseStudentUniversityDetail(data, institutionId);
  if (!detail) throw new UniversityIndexUnavailableError();
  return detail;
}
