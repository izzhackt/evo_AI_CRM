// Признак «в беседе есть неотправленное» (ревью #1590): сброс стека «Входящих» при уходе с вкладки не должен закрывать беседу с
// черновиком или неушедшим сообщением. Признак принадлежит КАБИНЕТУ (его `QueryClient`, новый при каждом входе) и снимается, когда
// беседа закрылась: другой студент на том же устройстве чужого черновика и чужого признака не видит.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";

import { hasUnsentChat, useReportUnsentChat } from "@/shell/unsent-chat";

function Reporter({ unsent }: { unsent: boolean }) {
  useReportUnsentChat(unsent);
  return null;
}
const inCabinet = (client: QueryClient, unsent: boolean) => (
  <QueryClientProvider client={client}>
    <Reporter unsent={unsent} />
  </QueryClientProvider>
);

describe("беседа с неотправленным и сброс стека «Входящих»", () => {
  it("пока в беседе ничего нет, признака нет; появился черновик или очередь - признак стоит; всё ушло - снят", async () => {
    const cabinet = new QueryClient();
    const view = await render(inCabinet(cabinet, false));
    expect(hasUnsentChat(cabinet)).toBe(false);
    await view.rerender(inCabinet(cabinet, true));
    expect(hasUnsentChat(cabinet)).toBe(true);
    await view.rerender(inCabinet(cabinet, false));
    expect(hasUnsentChat(cabinet)).toBe(false);
  });

  it("беседа закрылась (размонтирована) с неотправленным: признак не остаётся стоять", async () => {
    const cabinet = new QueryClient();
    const view = await render(inCabinet(cabinet, true));
    expect(hasUnsentChat(cabinet)).toBe(true);
    await view.unmount();
    expect(hasUnsentChat(cabinet)).toBe(false);
  });

  it("два студента (два кабинета): признак одного другому не виден, и закрытие одной беседы чужой признак не снимает", async () => {
    const first = new QueryClient();
    const second = new QueryClient();
    const firstView = await render(inCabinet(first, true));
    expect(hasUnsentChat(first)).toBe(true);
    expect(hasUnsentChat(second)).toBe(false);
    const secondView = await render(inCabinet(second, true));
    expect(hasUnsentChat(second)).toBe(true);
    await firstView.unmount();
    expect(hasUnsentChat(first)).toBe(false);
    expect(hasUnsentChat(second)).toBe(true);
    await secondView.unmount();
    expect(hasUnsentChat(second)).toBe(false);
  });
});
