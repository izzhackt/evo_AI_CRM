// Чтения «Главной» и «Поступления» через RPC схемы `platform`. Транспорт приходит
// аргументом, поэтому слой не знает про Supabase и проверяется тестами без сети.
// Какие RPC зовёт веб: docs/mobile/reference/web-portal-spec.md §2.3 (п. 1, 2).
// Ошибки: `RpcError` (транспорт) или `PortalDecodeError` (форма ответа); текст
// сервера дальше слоя не уходит.
import { parseStudentCountryChoice, type StudentCountryChoice } from "@web/lib/portal/country-choice";
import { parseCatalogPreparations, type CatalogPreparation } from "@web/lib/portal/catalog-preparations";
import { parsePaymentCenter, type PaymentCenter } from "@web/lib/portal/payment-center";
import { CSCA_TRACK, parseCscaHome, type CscaHome } from "@web/lib/portal/csca";
import { chunkInstitutionIds, parseUniversityFavorites } from "@web/lib/portal/university-favorites";
import { parseUniversityPage, type PublishedUniversity } from "@web/lib/platform-university-catalog";

import {
  buildPortalOverview,
  decodeBoardStage,
  decodeCaseFiles,
  decodeDocuments,
  decodeNotifications,
  decodePayments,
  PortalDecodeError,
  type StudentPortalCaseFile,
  type StudentPortalDocument,
  type StudentPortalNotification,
  type StudentPortalPayment,
  type StudentPortalOverview,
} from "@/domain/portal-source";
import { createWrite, RpcError, rpcRead, rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";

/**
 * Обзор дела и начисления в одной волне; только клиент с делом на сопровождении. Колонка доски (357) — отдельным
 * чтением в той же волне: её сбой не роняет обзор, путь тогда берёт первый шаг этапа.
 */
export async function readOverview(transport: RpcTransport): Promise<StudentPortalOverview | null> {
  const [overview, payments, board] = await Promise.all([
    rpcRead(transport, "student_portal_overview_v2", {}, { get: true }),
    rpcRead(transport, "student_portal_finance_v2", {}, { get: true }),
    rpcRead(transport, "student_portal_board_stage_v1", {}, { get: true }).catch((): null => null),
  ]);
  const built = buildPortalOverview(overview, payments);
  return built ? Object.freeze({ ...built, boardStage: decodeBoardStage(board) }) : null;
}

export async function readNotifications(transport: RpcTransport): Promise<readonly StudentPortalNotification[]> {
  return decodeNotifications(await rpcRead(transport, "student_portal_notifications_v2", {}, { get: true }));
}

export async function readCountryChoice(transport: RpcTransport): Promise<StudentCountryChoice> {
  const choice = parseStudentCountryChoice(await rpcRead(transport, "student_country_choice_v1"));
  if (!choice) throw new PortalDecodeError();
  return choice;
}

/**
 * Запись выбора страны. Запись замораживается один раз на выбор: повтор после сбоя
 * шлёт тот же запрос с тем же `p_request_id` (веб: CountryTimeline.retry).
 */
export function countryChoiceWrite(country: string): FrozenWrite {
  return createWrite("set_student_country_choice_v1", { p_country: country });
}

export async function saveCountryChoice(transport: RpcTransport, write: FrozenWrite): Promise<StudentCountryChoice> {
  const echo = parseStudentCountryChoice(await rpcWrite(transport, write));
  // Ответ обязан подтвердить именно этот выбор: иначе это не квитанция записи.
  if (!echo || echo.source !== "saved" || echo.country !== write.args.p_country) throw new PortalDecodeError();
  return echo;
}

export type FavoritesRead = Readonly<{
  /** Все избранные, по порядку ответа. */
  total: number;
  /** Карточки первых `limit` вузов в порядке избранного. */
  items: readonly PublishedUniversity[];
}>;

/**
 * Избранное: список id, затем карточки по `student_university_catalog_by_ids_v1`
 * (потолок 30 id за вызов, больший набор кусками). Неполный ответ: ошибка, а не
 * тихо укороченный список (как в вебе).
 */
export async function readFavorites(transport: RpcTransport, limit: number): Promise<FavoritesRead> {
  const saved = parseUniversityFavorites(await rpcRead(transport, "student_university_favorites_v1"));
  if (!saved) throw new PortalDecodeError();
  const ids = saved.slice(0, limit).map((favorite) => favorite.institutionId);
  const byId = new Map<string, PublishedUniversity>();
  for (const chunk of chunkInstitutionIds(ids)) {
    const page = parseUniversityPage(await rpcRead(transport, "student_university_catalog_by_ids_v1", { p_institution_ids: [...chunk] }));
    if (!page) throw new PortalDecodeError();
    for (const item of page.items) byId.set(item.id, item);
  }
  const items = ids.map((id) => byId.get(id)).filter((item): item is PublishedUniversity => item !== undefined);
  if (items.length !== ids.length) throw new PortalDecodeError();
  return { total: saved.length, items };
}

export async function readCscaHome(transport: RpcTransport): Promise<CscaHome> {
  try {
    return parseCscaHome(await rpcRead(transport, "learning_track_home_v1", { p_track: CSCA_TRACK }));
  } catch (error) {
    // parseCscaHome бросает свои ошибки формы; наружу отдаём одну.
    if (error instanceof RpcError) throw error;
    throw new PortalDecodeError();
  }
}

export async function readPreparations(transport: RpcTransport, studentCaseId: string): Promise<readonly CatalogPreparation[]> {
  const items = parseCatalogPreparations(await rpcRead(transport, "student_catalog_preparations_v1", { p_student_case_id: studentCaseId }), studentCaseId);
  if (!items) throw new PortalDecodeError();
  return items;
}

/** Чек-лист документов (`student_portal_documents`, STABLE: GET). */
export async function readDocuments(transport: RpcTransport): Promise<readonly StudentPortalDocument[]> {
  return decodeDocuments(await rpcRead(transport, "student_portal_documents", {}, { get: true }));
}

/** Договор и чеки (`student_portal_case_files_v1`): дополнение, сбой не роняет чек-лист. */
export async function readCaseFiles(transport: RpcTransport): Promise<readonly StudentPortalCaseFile[]> {
  return decodeCaseFiles(await rpcRead(transport, "student_portal_case_files_v1", {}, { get: true }));
}

/** Начисления (`student_portal_finance_v2`). */
export async function readPayments(transport: RpcTransport): Promise<readonly StudentPortalPayment[]> {
  return decodePayments(await rpcRead(transport, "student_portal_finance_v2", {}, { get: true }));
}

/** «Оплата» одним чтением (`student_portal_payment_center_v1`, STABLE: GET): реквизиты, платежи с историей, чеки без платежа. */
export async function readPaymentCenter(transport: RpcTransport): Promise<PaymentCenter> {
  const center = parsePaymentCenter(await rpcRead(transport, "student_portal_payment_center_v1", {}, { get: true }));
  if (!center) throw new PortalDecodeError();
  return center;
}
