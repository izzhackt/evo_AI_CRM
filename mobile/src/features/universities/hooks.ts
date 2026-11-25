// Запросы и записи «Университетов». Индекс: диск -> вызов с известной версией при открытии, возврате и не чаще раза в минуту (G46)
// (тянуть вниз проверяет всегда); избранное: оптимистичное сердечко с откатом,
// правда - квитанция сервера, нажатия по тому же вузу в полёте игнорируются.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { CatalogPreparationIntent, CatalogPreparationReceipt } from "@web/lib/portal/catalog-preparations";
import type { StudentUniversityDetail, StudentUniversityIndex } from "@web/lib/portal/university-index";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePortalApi } from "@/api/PortalApi";
import type { FrozenWrite } from "@/lib/rpc";

import { decodeIndexBody, loadUniversityIndex, readFavoriteIds, readUniversityDetail, selectProgram, selectProgramWrite, setFavorite, type IndexLoad } from "./api";
import { fileDisk, type IndexDisk } from "./cache";

const key = (userKey: string, name: string, ...rest: unknown[]) => ["portal", userKey, name, ...rest] as const;

/**
 * Через сколько (мс) после последней ПОПЫТКИ - удачной или нет - версия каталога проверяется снова: вызов идёт с известной версией
 * и при отсутствии перемен отвечает «не изменился» без тела. Веб проверяет версию при каждом открытии вида
 * (`university-index-source.ts`), приложение не чаще раза в минуту: срок подачи, опубликованный, пока приложение открыто, больше
 * не ждёт перезапуска (G46).
 *
 * Возврат сети сюда не входит: `onlineManager` TanStack Query в React Native событий сети не получает без `@react-native-community/netinfo`
 * или `expo-network`, а это нативный модуль (нативная сборка заморожена), поэтому `refetchOnReconnect` у запроса не включается.
 */
export const INDEX_RECHECK_MS = 60_000;

type Attempts = Readonly<{ dataUpdatedAt: number; errorUpdatedAt: number }>;
/** Когда закончилась последняя попытка загрузить индекс (удачная или нет); 0 - попыток не было. */
const lastAttemptAt = (state: Attempts) => Math.max(state.dataUpdatedAt, state.errorUpdatedAt);
/** Пора ли проверять снова: прошла минута после последней попытки (без попыток - пора). Сбой считается попыткой: повтор не при каждом возврате. */
const recheckDue = (state: Attempts) => Date.now() - lastAttemptAt(state) >= INDEX_RECHECK_MS;

/** Индекс каталога. Данные из кэша важнее свежей ошибки; `index === null` пока нечего показать. */
export function useUniversityIndex(disk: IndexDisk = fileDisk) {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const queryKey = useMemo(() => key(userKey, "university-index"), [userKey]);
  const query = useQuery<IndexLoad>({
    queryKey,
    queryFn: () => loadUniversityIndex(transport, disk, userKey, client.getQueryData<IndexLoad>(queryKey)?.index ?? null),
    // Версия перепроверяется при открытии каталога и при возврате в приложение (`focusManager` кабинета), не чаще раза в минуту
    // после последней попытки: и после сбоя тоже, иначе каждый возврат и каждый новый экран каталога повторял бы запрос
    // (с двумя повторами при обрыве связи и полосой загрузки без копии).
    staleTime: INDEX_RECHECK_MS,
    gcTime: Infinity,
    refetchOnWindowFocus: (current) => recheckDue(current.state),
    refetchOnMount: (current) => recheckDue(current.state),
    retryOnMount: (current) => recheckDue(current.state),
  });
  /**
   * Перепроверка при возвращении на экран каталога (экран остаётся в стеке, поэтому `refetchOnMount` его не видит): не чаще раза в
   * `INDEX_RECHECK_MS` после последней попытки, не поверх идущего запроса и не раньше первой попытки.
   */
  const recheck = useCallback(() => {
    const state = client.getQueryState(queryKey);
    if (!state || state.fetchStatus === "fetching" || lastAttemptAt(state) === 0 || !recheckDue(state)) return;
    void client.refetchQueries({ queryKey, exact: true }, { cancelRefetch: false });
  }, [client, queryKey]);
  // Копия с диска показывается сразу, не дожидаясь сети.
  const [diskCopy, setDiskCopy] = useState<{ userKey: string; index: StudentUniversityIndex } | null>(null);
  useEffect(() => {
    let live = true;
    void disk.read(userKey).then((body) => {
      if (!live || body === null) return;
      const copy = decodeIndexBody(body);
      if (live && copy) setDiskCopy({ userKey, index: copy });
    });
    return () => {
      live = false;
    };
  }, [disk, userKey]);
  // Копия прежнего пользователя не показывается новому.
  const index = query.data?.index ?? (diskCopy?.userKey === userKey ? diskCopy.index : null);
  // Полоса «потянули вниз» горит только пока идёт запрос, который начал сам студент: автоматическая перепроверка идёт молча
  // (иначе полоса появлялась бы сама при каждом возврате на каталог, а на iPhone ещё и сдвигала бы содержимое вниз).
  const [pulling, setPulling] = useState(false);
  const { refetch } = query;
  const refresh = useCallback(async () => {
    setPulling(true);
    try {
      return await refetch();
    } finally {
      setPulling(false);
    }
  }, [refetch]);
  return {
    index,
    refreshFailed: query.data?.refreshFailed === true || (query.isError && index !== null),
    isLoading: index === null && !query.isError,
    isError: index === null && query.isError,
    error: query.error,
    refreshing: pulling && index !== null,
    refresh,
    recheck,
  };
}

export function useUniversityDetail(id: string) {
  const { transport, userKey } = usePortalApi();
  return useQuery<StudentUniversityDetail>({ queryKey: key(userKey, "university-detail", id), queryFn: () => readUniversityDetail(transport, id) });
}

const idsKey = (userKey: string) => key(userKey, "favorite-ids");

export function useFavoriteIds() {
  const { transport, userKey } = usePortalApi();
  return useQuery({ queryKey: idsKey(userKey), queryFn: () => readFavoriteIds(transport) });
}

/** После записи «Мои вузы» на Главной и в Поступлении перечитываются (те же ключи). */
function refreshFavoriteViews(client: QueryClient, userKey: string, id: string) {
  void client.invalidateQueries({ queryKey: key(userKey, "favorites") });
  void client.invalidateQueries({ queryKey: key(userKey, "university-detail", id) });
}

/** Переключатель избранного. `toggle` возвращает false, если нажатие по этому вузу уже в полёте. */
export function useToggleFavorite() {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const inFlight = useRef(new Set<string>());
  const [failed, setFailed] = useState<string | null>(null);
  const toggle = useCallback(
    async (id: string, favored: boolean): Promise<boolean> => {
      if (inFlight.current.has(id)) return false;
      inFlight.current.add(id);
      setFailed(null);
      const queryKey = idsKey(userKey);
      const previous = client.getQueryData<readonly string[]>(queryKey);
      const apply = (ids: readonly string[] | undefined, value: boolean) => {
        const base = (ids ?? []).filter((x) => x !== id);
        return value ? [id, ...base] : base;
      };
      client.setQueryData(queryKey, apply(previous, favored));
      try {
        const truth = await setFavorite(transport, id, favored);
        client.setQueryData(queryKey, apply(client.getQueryData<readonly string[]>(queryKey), truth));
        refreshFavoriteViews(client, userKey, id);
        return true;
      } catch {
        client.setQueryData(queryKey, previous);
        setFailed(id);
        return true;
      } finally {
        inFlight.current.delete(id);
      }
    },
    [client, transport, userKey],
  );
  return { toggle, failedId: failed, clearFailed: () => setFailed(null) };
}

/** Выбор программы («Добавить в мои программы»): запись замораживается на набор, повтор шлёт тот же запрос. */
export function useSelectProgram() {
  const { transport, userKey } = usePortalApi();
  const client = useQueryClient();
  const frozen = useRef<{ target: string; write: FrozenWrite } | null>(null);
  return useMutation<CatalogPreparationReceipt, Error, Omit<CatalogPreparationIntent, "requestId">>({
    mutationFn: (intent) => {
      const target = `${intent.studentCaseId}:${intent.institutionId}:${intent.programId}:${intent.intakeId}:${intent.publicationVersion}`;
      if (frozen.current?.target !== target) frozen.current = { target, write: selectProgramWrite(intent) };
      return selectProgram(transport, frozen.current.write, intent);
    },
    onSuccess: () => {
      frozen.current = null;
      void client.invalidateQueries({ queryKey: key(userKey, "preparations") });
    },
  });
}
