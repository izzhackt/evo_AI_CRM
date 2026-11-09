// Чтения «Главной» и «Поступления» как запросы: у каждого источника своё состояние,
// сбой одного не роняет остальные (как в вебе, где каждый источник падает в свой
// fallback). Кэш держит последний удачный ответ, поэтому при потере связи экран
// показывает прежние данные, а не пустоту.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { StudentCountryChoice } from "@web/lib/portal/country-choice";

import { usePortalApi } from "@/api/PortalApi";
import {
  countryChoiceWrite,
  readCountryChoice,
  readCscaHome,
  readFavorites,
  readNotifications,
  readOverview,
  readPreparations,
  saveCountryChoice,
} from "@/api/portal-reads";
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

export function useCountryChoice() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "country-choice"), queryFn: () => readCountryChoice(transport) });
}

/** Избранное: `limit` карточек для показа и общее число. */
export function useFavorites(limit: number) {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: key(userKey, "favorites", limit), queryFn: () => readFavorites(transport, limit) });
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
