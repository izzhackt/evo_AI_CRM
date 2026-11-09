import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PortalApiProvider, type PortalApi } from "@/api/PortalApi";
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

/** Экран в окружении приложения: тема, язык, кэш чтений без повторов (тест быстрый и честный). */
export async function renderPortal(ui: ReactElement, api: PortalApi, lang: "ru" | "ky" = "ru") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const result = await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <LangProvider initial={lang}>
          <PortalApiProvider api={api} client={client}>
            {ui}
          </PortalApiProvider>
        </LangProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  return { ...result, client };
}
