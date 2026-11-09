// Контекст чтений кабинета: транспорт RPC, дело и уровень доступа студента.
// Настоящий — из сессии (`(app)/_layout.tsx`); тесты подставляют свой транспорт.
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";

import { RpcError, type RpcTransport } from "@/lib/rpc";
import type { AccessTier } from "@/session/access";

export type PortalApi = Readonly<{
  transport: RpcTransport;
  /** Идентификатор дела: аргумент `student_catalog_preparations_v1`. */
  studentCaseId: string;
  /** Имя для приветствия (из полномочий). */
  displayName: string;
  tier: AccessTier;
  /** Можно ли выбирать новые программы: дело `active` и кабинет активирован (как в вебе). */
  canSelectPrograms: boolean;
  /** Кому принадлежат данные в кэше (auth user id). */
  userKey: string;
  /** Адрес портала: bearer-маршруты загрузки и скачивания документов (не RPC). */
  portalBaseUrl: string;
  /** Актуальный access token сессии (supabase-js обновляет его сам) или null без сессии. */
  getAccessToken: () => Promise<string | null>;
}>;

const PortalApiContext = createContext<PortalApi | null>(null);

export function usePortalApi(): PortalApi {
  const value = useContext(PortalApiContext);
  if (!value) throw new Error("usePortalApi вне PortalApiProvider");
  return value;
}

/** Повторять только обрыв связи, и недолго: остальное повтор не лечит. */
export function shouldRetry(count: number, error: unknown): boolean {
  return error instanceof RpcError && error.kind === "transport" && count < 2;
}

export function createPortalQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, gcTime: 10 * 60_000, refetchOnReconnect: true },
    },
  });
}

/**
 * Кэш чтений живёт, пока открыт кабинет: после выхода `(app)` размонтируется и
 * клиент создаётся заново, чужих данных в нём не остаётся. На возврат приложения на
 * передний план устаревшие чтения обновляются.
 */
export function PortalApiProvider({ api, children, client }: { api: PortalApi; children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createPortalQueryClient());
  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    const subscription = AppState.addEventListener("change", (status) => focusManager.setFocused(status === "active"));
    return () => subscription.remove();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <PortalApiContext.Provider value={api}>{children}</PortalApiContext.Provider>
    </QueryClientProvider>
  );
}
