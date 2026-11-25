// Выход и удаление аккаунта стирают незавершённые загрузки и отправки документов и комплекта программы (в них имена файлов,
// отпечатки и состав комплекта).
import AsyncStorage from "@react-native-async-storage/async-storage";

import { documentsPending } from "@/features/preparations/documents-pending";
import { packagesPending } from "@/features/preparations/packages-pending";
import { clearAllLocalData } from "@/session/local-data";
import { APPLICATION_ID, REVISION_ID, STUDENT_CASE_ID, itemId, sha, slotId } from "@/test-fixtures/preparations";
import { submitIntentOf } from "@/test-fixtures/preparations-packages";

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

  it("clearAllLocalData стирает и записанные отправки комплекта программы", async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem("evo.lang", "ky");
    await packagesPending.persist(scope, "submit", REVISION_ID, submitIntentOf([0], [1]) as never);
    expect((await AsyncStorage.getAllKeys()).some((key) => key.startsWith("evo.application-packages.v1:"))).toBe(true);
    await clearAllLocalData();
    expect(await AsyncStorage.getAllKeys()).toEqual(["evo.lang"]);
    expect(await packagesPending.read(scope, "submit", REVISION_ID)).toEqual({ intent: null, blocked: false });
  });
});
