// `liveUserId` - единственное место, где отправка чека читает «кто вошёл на устройстве» (ревью #1560, L-A). Экранные тесты подменяют его,
// поэтому здесь проверяется само чтение сессии Supabase: любое сомнение - `null`, то есть отказ.
import { getSupabase } from "@/lib/supabase";
import { liveUserId } from "@/features/payments/native";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: { cache: "cache" }, UploadType: { MULTIPART: 1 } }));
jest.mock("@/features/documents/download-cache", () => ({ UPLOAD_STAGE_DIR: "upload-stage" }));
jest.mock("@/lib/supabase", () => ({ getSupabase: jest.fn() }));

const session = (value: unknown) => ({ auth: { getSession: jest.fn(async () => value) } });
const use = (client: unknown) => (getSupabase as jest.Mock).mockReturnValue(client);

describe("liveUserId", () => {
  it("вошёл студент: его auth user id", async () => {
    use(session({ data: { session: { user: { id: "user-A" } } } }));
    expect(await liveUserId()).toBe("user-A");
  });

  it("никто не вошёл: null", async () => {
    use(session({ data: { session: null } }));
    expect(await liveUserId()).toBeNull();
  });

  it("ответ без данных: null", async () => {
    use(session({ data: {} }));
    expect(await liveUserId()).toBeNull();
  });

  it("чтение сессии упало: null, а не исключение (отправка без уверенности в владельце не продолжается)", async () => {
    use({ auth: { getSession: jest.fn(async () => Promise.reject(new Error("хранилище недоступно"))) } });
    expect(await liveUserId()).toBeNull();
  });

  it("клиент Supabase не собрался: null", async () => {
    (getSupabase as jest.Mock).mockImplementation(() => {
      throw new Error("нет настроек");
    });
    expect(await liveUserId()).toBeNull();
  });
});
