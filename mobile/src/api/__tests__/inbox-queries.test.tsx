// Ключи чтений экранов решения во «Входящих» (разбор ревью #1557, F6): у каждого ключа вторым элементом студент, иначе кэш одного
// студента отдавался бы другому на том же устройстве. Тест держит и форму ключей, и поведение: у двух студентов на одном кэше
// одно и то же уведомление читается дважды, а не берётся из чужой записи.
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { PortalApiProvider } from "@/api/PortalApi";
import { useCaseHelp, useDocumentNotification, useHelpReply, usePackageDetail, usePackageNotification } from "@/api/inbox-queries";
import {
  APPLICATION_ID,
  DOCUMENT_NOTIFICATION_ID,
  HELP_NOTIFICATION_ID,
  PACKAGE_ID,
  PACKAGE_NOTIFICATION_ID,
  documentNotificationRow,
  helpPageRow,
  helpReplyRow,
  packageDetailRow,
  packageNotificationRow,
} from "@/test-fixtures/program-decisions";
import { testApi } from "@/test-fixtures/render";
import { fakeTransport } from "@/test-fixtures/universities";

const HANDLERS = {
  student_portal_help_reply_v1: helpReplyRow(),
  case_help_workspace_v1: helpPageRow([]),
  student_application_document_notification_v1: documentNotificationRow(),
  application_package_notification_v1: packageNotificationRow(),
  application_package_detail_v1: packageDetailRow(),
};

type Case = Readonly<{ name: string; rpc: keyof typeof HANDLERS; Probe: () => null; key: (userKey: string) => readonly unknown[] }>;

const CASES: readonly Case[] = [
  { name: "ответ куратора", rpc: "student_portal_help_reply_v1", Probe: () => (useHelpReply(HELP_NOTIFICATION_ID), null), key: (u) => ["portal", u, "help-reply", HELP_NOTIFICATION_ID] },
  { name: "прежние обращения", rpc: "case_help_workspace_v1", Probe: () => (useCaseHelp(), null), key: (u) => ["portal", u, "case-help"] },
  { name: "решение по документу", rpc: "student_application_document_notification_v1", Probe: () => (useDocumentNotification(DOCUMENT_NOTIFICATION_ID), null), key: (u) => ["portal", u, "document-notification", DOCUMENT_NOTIFICATION_ID] },
  { name: "решение по комплекту", rpc: "application_package_notification_v1", Probe: () => (usePackageNotification(PACKAGE_NOTIFICATION_ID), null), key: (u) => ["portal", u, "package-notification", PACKAGE_NOTIFICATION_ID] },
  { name: "состав комплекта", rpc: "application_package_detail_v1", Probe: () => (usePackageDetail({ applicationId: APPLICATION_ID, packageId: PACKAGE_ID }), null), key: (u) => ["portal", u, "package-detail", APPLICATION_ID, PACKAGE_ID] },
];

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

describe("ключи чтений «Входящих»: студент в каждом ключе", () => {
  const clients: QueryClient[] = [];
  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
  });

  async function renderAs(client: QueryClient, userKey: string, probe: ReactElement) {
    const { transport, calls } = fakeTransport(HANDLERS);
    const view = await render(
      <PortalApiProvider api={testApi(transport, { userKey })} client={client}>
        {probe}
      </PortalApiProvider>,
    );
    // чтения идут в эффекте после монтирования: ждём, пока кэш получит ответ
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { view, calls };
  }

  it.each(CASES)("$name: ключ начинается с «portal» и студента", async ({ Probe, key }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
    clients.push(client);
    await renderAs(client, USER_A, <Probe />);
    expect(client.getQueryCache().findAll().map((query) => query.queryKey)).toEqual([key(USER_A)]);
  });

  it.each(CASES)("$name: у двух студентов на одном кэше два чтения и две записи, чужая запись не подставляется", async ({ Probe, rpc, key }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
    clients.push(client);
    const first = await renderAs(client, USER_A, <Probe />);
    expect(first.calls.filter((call) => call.name === rpc)).toHaveLength(1);
    await first.view.unmount();
    const second = await renderAs(client, USER_B, <Probe />);
    expect(second.calls.filter((call) => call.name === rpc)).toHaveLength(1); // не взято из кэша студента A
    const keys = client.getQueryCache().findAll().map((query) => JSON.stringify(query.queryKey)).sort();
    expect(keys).toEqual([JSON.stringify(key(USER_A)), JSON.stringify(key(USER_B))].sort());
  });
});
