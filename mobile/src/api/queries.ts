// Чтения «Главной» и «Поступления» как запросы: у каждого источника своё состояние,
// сбой одного не роняет остальные (как в вебе, где каждый источник падает в свой
// fallback). Кэш держит последний удачный ответ, поэтому при потере связи экран
// показывает прежние данные, а не пустоту.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCallback, useRef } from "react";
import type { StudentCountryChoice } from "@web/lib/portal/country-choice";

import { usePortalApi } from "@/api/PortalApi";
import {
  countryChoiceWrite,
  readCaseFiles,
  readCountryChoice,
  readDocuments,
  readPayments,
  readCscaHome,
  readFavorites,
  readNotifications,
  readOverview,
  readPreparations,
  saveCountryChoice,
} from "@/api/portal-reads";
import { FAVORITES_QUERY_LIMIT } from "@/domain/home-model";
import { useFocusEffect } from "@/lib/focus";
import { RpcError, type FrozenWrite } from "@/lib/rpc";

const key = (userKey: string, name: string, ...rest: unknown[]) => ["portal", userKey, name, ...rest] as const;

/** Обзор дела и начисления: только assisted. */
export function useOverview() {
  const { transport, tier, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "overview"), queryFn: () => readOverview(transport), enabled: tier === "assisted" });
}

export function useNotifications() {
  const { transport, tier, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "notifications"), queryFn: () => readNotifications(transport), enabled: tier === "assisted" });
}

export function useDocuments() {
  const { transport, tier, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "documents"), queryFn: () => readDocuments(transport), enabled: tier === "assisted" });
}

export function useCaseFiles() {
  const { transport, tier, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "case-files"), queryFn: () => readCaseFiles(transport), enabled: tier === "assisted" });
}

export function usePayments() {
  const { transport, tier, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "payments"), queryFn: () => readPayments(transport), enabled: tier === "assisted" });
}

/** После загрузки файла: чек-лист и «Что сделать сейчас» читаются заново. */
export function useInvalidateAfterUpload() {
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: key(userKey, "documents") });
    void client.invalidateQueries({ queryKey: key(userKey, "overview") });
    void client.invalidateQueries({ queryKey: key(userKey, "notifications") });
  }, [client, userKey]);
}

export function useCountryChoice() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "country-choice"), queryFn: () => readCountryChoice(transport) });
}

/** Избранное: один общий запрос (до 120 карточек и общее число) для Главной и Поступления. */
export function useFavorites() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "favorites"), queryFn: () => readFavorites(transport, FAVORITES_QUERY_LIMIT) });
}

/**
 * На возврат на вкладку устаревшие чтения кабинета обновляются (кэш показывается сразу).
 * Идущие запросы не перезапускаются; свежие (моложе staleTime) не трогаются.
 */
export function useRefetchOnFocus() {
  const { userKey } = usePortalApi();
  const client = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      void client.refetchQueries({ queryKey: ["portal", userKey], type: "active", stale: true }, { cancelRefetch: false });
    }, [client, userKey]),
  );
}

/** Карточка CSCA: читается только для Китая (`enabled` решает вызывающий). */
export function useCscaHome(enabled: boolean) {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "csca-home"), queryFn: () => readCscaHome(transport), enabled });
}

export function usePreparations() {
  const { transport, studentCaseId, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "preparations"), queryFn: () => readPreparations(transport, studentCaseId) });
}

/**
 * Сохранение страны пути. Запись замораживается на выбор: повтор после сбоя шлёт
 * тот же запрос (тот же `p_request_id`); после успеха или смены страны замораживается
 * новая. Ответ сервера кладётся прямо в кэш выбора.
 */
export function useSaveCountryChoice() {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const frozen = useRef<{ country: string; write: FrozenWrite } | null>(null);
  return useMutation<StudentCountryChoice, Error, string>({
    mutationFn: (country) => {
      if (frozen.current?.country !== country) frozen.current = { country, write: countryChoiceWrite(country) };
      return saveCountryChoice(transport, frozen.current.write);
    },
    onSuccess: (choice) => {
      frozen.current = null;
      client.setQueryData(key(userKey, "country-choice"), choice);
    },
  });
}

export type SourceState = "loading" | "error" | "ready";

/** Состояние источника для экрана: данные из кэша важнее свежей ошибки. */
export function sourceState(query: { data: unknown; isPending: boolean; isError: boolean; fetchStatus: string; status: string }): SourceState {
  if (query.data !== undefined) return "ready";
  if (query.status === "error") return "error";
  return "loading";
}

/** Ключ строки ошибки загрузки: связь, сервер или общая. */
export function loadErrorKey(error: unknown): "error.offline" | "error.server" | "error.load" {
  if (error instanceof RpcError) {
    if (error.kind === "transport") return "error.offline";
    if (error.kind === "server") return "error.server";
  }
  return "error.load";
}
