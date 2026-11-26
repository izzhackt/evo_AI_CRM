// QA 25.11.2026 (D5), от кнопки до задачи загрузки: при остановленном портале «Загружаем…» стояло минутами. Здесь экран работает с
// настоящей `createProgramUploader`, а нативный модуль файлов (`expo-file-system`) подставлен задачей, которая отвечает «отказ в
// соединении» сразу, молчит до отмены или идёт, пока ей двигают счётчик байтов. Время поддельное: срок тишины не ждётся по-настоящему.
// Настоящая сеть и настоящая сессия iOS без устройства не проверялись.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";

import { PreparationScreen } from "@/features/preparations/PreparationScreen";
import { UPLOAD_INACTIVITY_MS, createProgramUploader, fingerprintFile } from "@/features/preparations/native";
import { APPLICATION_ID, documentState, itemId, readiness, requirementItem, requirements } from "@/test-fixtures/preparations";
import { FILE_BYTES, makeIo } from "@/test-fixtures/preparations-io";
import { renderPortal, testApi } from "@/test-fixtures/render";
import { waitForEnabled } from "@/test-fixtures/settle";
import { fakeTransport, preparationRow } from "@/test-fixtures/universities";

jest.mock("expo-router", () => ({ router: { navigate: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

type MockTask = { cancels: number; reject: (error: Error) => void; onProgress: (event: { bytesSent: number; totalBytes: number }) => void };
const mockDevice = {
  /** `refuse`: задача сразу падает, как при отказе в соединении; `hang`: молчит, пока её не отменят. */
  mode: "hang" as "refuse" | "hang",
  tasks: [] as MockTask[],
};

jest.mock("expo-crypto", () => ({
  randomUUID: () => jest.requireActual<typeof import("node:crypto")>("node:crypto").randomUUID(),
  getRandomBytes: (size: number) => new Uint8Array(size),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: async (_algorithm: string, data: ArrayBuffer) => {
    const out = jest.requireActual<typeof import("node:crypto")>("node:crypto").createHash("sha256").update(Buffer.from(data)).digest();
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  },
}));
jest.mock("expo-file-system", () => {
  const uriOf = (parts: unknown[]) => parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
  class Directory {
    uri: string;
    exists = false;
    constructor(...parts: unknown[]) {
      this.uri = uriOf(parts);
    }
    create() {
      this.exists = true;
    }
    delete() {
      this.exists = false;
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uriOf(parts);
    }
    get size() {
      return mockFileBytes().byteLength;
    }
    copy() {}
    async arrayBuffer() {
      const bytes = mockFileBytes();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    createUploadTask(_url: string, options: { signal?: AbortSignal; onProgress: MockTask["onProgress"] }) {
      const task: MockTask = { cancels: 0, reject: () => undefined, onProgress: options.onProgress };
      mockDevice.tasks.push(task);
      const cancel = () => {
        task.cancels += 1;
        task.reject(Object.assign(new Error("The upload was cancelled."), { name: "UploadCancelledException" }));
      };
      return {
        cancel,
        uploadAsync: async () => {
          if (options.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
          options.signal?.addEventListener("abort", cancel, { once: true });
          if (mockDevice.mode === "refuse") throw new Error("Could not connect to the server.");
          return new Promise((_resolve, reject) => (task.reject = reject));
        },
      };
    }
  }
  return { Directory, File, Paths: { cache: "cache" }, UploadType: { MULTIPART: "MULTIPART" } };
});
const mockFileBytes = () => FILE_BYTES;

const ITEM = itemId(0);

async function open() {
  const { transport, calls } = fakeTransport({
    student_catalog_preparations_v1: [preparationRow(1)],
    application_package_readiness_v1: readiness(requirements([requirementItem(0)]), [documentState(0)]),
  });
  const io = makeIo({ over: { createUploader: createProgramUploader, fingerprint: fingerprintFile } });
  await renderPortal(<PreparationScreen applicationId={APPLICATION_ID} io={io.io} />, testApi(transport));
  await waitForEnabled(`prep-upload-button-${ITEM}`);
  return { calls, io };
}
const button = () => screen.getByTestId(`prep-upload-button-${ITEM}`);
const storedKeys = async () => (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith("evo.application-documents.v1:"));
const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
async function chooseFile() {
  await fireEvent.press(screen.getByTestId(`prep-upload-button-${ITEM}`));
  await fireEvent.press(await screen.findByTestId("pick-file"));
}

let restore: () => void = () => undefined;
beforeEach(async () => {
  const spy = jest.replaceProperty(Platform, "OS", "android");
  restore = () => spy.restore();
  await AsyncStorage.clear();
  mockDevice.mode = "hang";
  mockDevice.tasks.length = 0;
});
afterEach(async () => {
  // Задача, которую тест оставил висеть, отпускается: иначе замок цели остался бы занят и следующий тест увидел бы «идёт другая загрузка».
  await act(async () => {
    for (const task of mockDevice.tasks) task.reject(new Error("test finished"));
  });
  jest.useRealTimers();
  restore();
});

describe("портал не отвечает: загрузка не висит вечно", () => {
  it("отказ в соединении: сразу «Не удалось получить результат», запрос остался, кнопка «Проверить результат» снова рабочая", async () => {
    mockDevice.mode = "refuse";
    await open();
    await chooseFile();
    expect(await screen.findByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Не удалось получить результат", { exact: false });
    await waitForEnabled(`prep-upload-button-${ITEM}`);
    expect(button()).toHaveTextContent("Проверить результат", { exact: false });
    expect(await storedKeys()).toHaveLength(1);
    expect(screen.queryByTestId(`prep-upload-cancel-${ITEM}`)).toBeNull();
  });

  it("связь есть, а ответа нет: «Загружаем…» и «Отменить загрузку» до срока тишины; по сроку задача отменена, кнопка снова рабочая", async () => {
    await open();
    jest.useFakeTimers();
    await chooseFile();
    await waitFor(() => expect(button()).toHaveTextContent("Загружаем…", { exact: false }));
    expect(button().props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId(`prep-upload-cancel-${ITEM}`)).toBeTruthy();
    await advance(UPLOAD_INACTIVITY_MS - 1);
    expect(mockDevice.tasks).toHaveLength(1);
    expect(mockDevice.tasks[0]!.cancels).toBe(0);
    expect(button()).toHaveTextContent("Загружаем…", { exact: false });
    await advance(1);
    await waitFor(() => expect(button()).toHaveTextContent("Проверить результат", { exact: false }));
    expect(mockDevice.tasks[0]!.cancels).toBe(1);
    expect(button().props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Не удалось получить результат", { exact: false });
    expect(screen.queryByTestId(`prep-upload-cancel-${ITEM}`)).toBeNull();
    expect(await storedKeys()).toHaveLength(1);
  });

  it("пока байты уходят, загрузка идёт дольше срока тишины и не обрывается", async () => {
    await open();
    jest.useFakeTimers();
    await chooseFile();
    await waitFor(() => expect(mockDevice.tasks).toHaveLength(1));
    // шесть сроков тишины подряд, но каждые 45 секунд что-то уходит
    for (let step = 1; step <= 12; step++) {
      await advance(45_000);
      await act(async () => mockDevice.tasks[0]!.onProgress({ bytesSent: step * 1000, totalBytes: 100_000 }));
    }
    expect(mockDevice.tasks[0]!.cancels).toBe(0);
    expect(button()).toHaveTextContent("Загружаем…", { exact: false });
  });

  it("студент нажимает «Отменить загрузку»: «Загрузка отменена.», запрос остался, кнопка снова рабочая", async () => {
    await open();
    await chooseFile();
    await fireEvent.press(await screen.findByTestId(`prep-upload-cancel-${ITEM}`));
    expect(await screen.findByTestId(`prep-upload-message-${ITEM}`)).toHaveTextContent("Загрузка отменена.");
    expect(mockDevice.tasks[0]!.cancels).toBe(1);
    await waitForEnabled(`prep-upload-button-${ITEM}`);
    expect(button()).toHaveTextContent("Проверить результат", { exact: false });
    expect(await storedKeys()).toHaveLength(1);
  });
});
