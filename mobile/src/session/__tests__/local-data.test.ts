import { clearAllLocalData } from "@/session/local-data";

const mockCalls: string[] = [];
let mockFailOpenSteps = false;
const mockRecord = (name: string) => async () => void mockCalls.push(name);

jest.mock("@/features/admission/useOpenSteps", () => ({
  clearPerUserUiState: async () => {
    mockCalls.push("openSteps");
    if (mockFailOpenSteps) throw new Error("boom");
  },
}));
jest.mock("@/features/documents/download-cache", () => ({ clearDownloadCache: () => mockRecord("downloads")() }));
jest.mock("@/features/universities/cache", () => ({ clearUniversityCaches: () => mockRecord("universities")() }));
jest.mock("@/features/learning/csca/ui-state", () => ({ clearCscaUiState: () => mockRecord("csca")() }));
jest.mock("@/features/registration/draft-store", () => ({ clearRegistrationLocalData: () => mockRecord("registration")() }));

beforeEach(() => {
  mockCalls.length = 0;
  mockFailOpenSteps = false;
});

describe("очистка данных на устройстве", () => {
  it("выход вызывает очистку каждого среза", async () => {
    await clearAllLocalData();
    expect([...mockCalls].sort()).toEqual(["csca", "downloads", "openSteps", "registration", "universities"]);
  });

  it("сбой одной очистки не мешает остальным", async () => {
    mockFailOpenSteps = true;
    await expect(clearAllLocalData()).resolves.toBeUndefined();
    expect(mockCalls).toEqual(expect.arrayContaining(["registration", "universities", "csca", "downloads"]));
  });
});
