// Выход и удаление аккаунта стирают незавершённые загрузки и отправки документов программы (в них имена файлов и отпечатки).
import AsyncStorage from "@react-native-async-storage/async-storage";

import { documentsPending } from "@/features/preparations/documents-pending";
import { clearAllLocalData } from "@/session/local-data";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID, itemId, sha, slotId } from "@/test-fixtures/preparations";

jest.mock("@/features/documents/download-cache", () => ({ clearDownloadCache: async () => undefined }));

const scope = { organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", studentCaseId: STUDENT_CASE_ID, applicationId: APPLICATION_ID };
const upload = {
  protocolVersion: 1,
  studentCaseId: STUDENT_CASE_ID,
  applicationId: APPLICATION_ID,
  requirementsRevisionId: REVISION_ID,
  requirementItemId: itemId(0),
  documentSlotId: slotId(0),
  requestId: "99999999-0000-4000-8000-000000000001",
  file: { originalFilename: "паспорт.pdf", declaredMimeType: "application/pdf", byteSize: "1024", sha256Hex: sha(1) },
};

describe("очистка локальных данных", () => {
  it("clearAllLocalData стирает записанные запросы загрузки и отправки, настройки устройства остаются", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem("evo.lang", "ky");
    await documentsPending.persist(scope, "upload", itemId(0), upload as never);
    expect((await AsyncStorage.getAllKeys()).some((key) => key.startsWith("evo.application-documents.v1:"))).toBe(true);
    await clearAllLocalData();
    expect(await AsyncStorage.getAllKeys()).toEqual(["evo.lang"]);
    expect(await documentsPending.read(scope, "upload", itemId(0))).toEqual({ intent: null, blocked: false });
  });
});
