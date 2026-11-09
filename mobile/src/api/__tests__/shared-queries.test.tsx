import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PortalApiProvider } from "@/api/PortalApi";
import { useFavorites, useRefetchOnFocus } from "@/api/queries";
import type { RpcTransport } from "@/lib/rpc";
import { testApi } from "@/test-fixtures/render";

function setup() {
  const calls: string[] = [];
  const transport: RpcTransport = async (name) => {
    calls.push(name);
    return { data: name === "student_university_favorites_v1" ? [] : null, error: null };
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PortalApiProvider api={testApi(transport)} client={client}>
      {children}
    </PortalApiProvider>
  );
  return { calls, client, wrapper };
}

describe("общие чтения", () => {
  it("Главная и Поступление читают избранное одним запросом", async () => {
    const { calls, client, wrapper } = setup();
    const a = await renderHook(() => useFavorites(), { wrapper });
    const b = await renderHook(() => useFavorites(), { wrapper });
    await waitFor(() => expect(a.result.current.data).toEqual({ total: 0, items: [] }));
    expect(b.result.current.data).toEqual({ total: 0, items: [] });
    expect(calls.filter((name) => name === "student_university_favorites_v1")).toHaveLength(1);
    client.clear();
  });

  it("возврат на вкладку не дёргает свежие чтения", async () => {
    const { calls, client, wrapper } = setup();
    await renderHook(
      () => {
        useFavorites();
        useRefetchOnFocus();
      },
      { wrapper },
    );
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.filter((name) => name === "student_university_favorites_v1")).toHaveLength(1);
    client.clear();
  });
});
