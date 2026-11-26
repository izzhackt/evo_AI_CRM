import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { createPortalQueryClient, PortalApiProvider, type PortalApi } from "@/api/PortalApi";
import { LangProvider } from "@/i18n/LangProvider";
import type { RpcTransport } from "@/lib/rpc";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { STUDENT_CASE_ID } from "@/test-fixtures/universities";

const clients: QueryClient[] = [];
// Кэш чтений чистится после каждого теста: его таймеры не держат процесс Jest.
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

export function testApi(transport: RpcTransport, overrides: Partial<PortalApi> = {}): PortalApi {
  return {
    transport,
    studentCaseId: STUDENT_CASE_ID,
    displayName: "Тест Студентов",
    tier: "assisted",
    canSelectPrograms: true,
    userKey: "user-test",
    membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    portalBaseUrl: "https://portal.example.test",
    getAccessToken: async () => "synthetic-token",
    refreshAccessToken: async () => null,
    ...overrides,
  };
}

/**
 * Кэш чтений для теста. По умолчанию: без повторов, ничего не «стареет» и не выгружается (тест быстрый и честный), а значит
 * скрывает, как кабинет кэширует на самом деле. `"production"` - настоящие настройки кабинета (`createPortalQueryClient`:
 * чтения стареют через 30 с, выгружаются через 10 мин). Очищается после каждого теста.
 */
export function testClient(kind: "test" | "production" = "test"): QueryClient {
  const client =
    kind === "production"
      ? createPortalQueryClient()
      : new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return client;
}

/** Окружение приложения вокруг экрана: тема, язык, кэш чтений. Своя оболочка нужна тестам, что меняют `api` или кэш под рукой (`rerender`). */
export function PortalShell({ api, client, lang = "ru", children }: { api: PortalApi; client: QueryClient; lang?: "ru" | "ky"; children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>
          <PortalApiProvider api={api} client={client}>
            {children}
          </PortalApiProvider>
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Экран в окружении приложения: тема, язык, кэш чтений без повторов (тест быстрый и честный). */
export async function renderPortal(ui: ReactElement, api: PortalApi, lang: "ru" | "ky" = "ru") {
  const client = testClient();
  const result = await render(
    <PortalShell api={api} client={client} lang={lang}>
      {ui}
    </PortalShell>,
  );
  return { ...result, client };
}
