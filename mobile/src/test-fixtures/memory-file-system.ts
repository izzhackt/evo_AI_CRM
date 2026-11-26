// Файловая система в памяти для тестов экранов, которые читают индекс каталога (UniversityIndexWarmup, шапка «Главной»):
// копия индекса на диске не должна переходить из теста в тест. Подключение:
//   jest.mock("expo-file-system", () => jest.requireActual("@/test-fixtures/memory-file-system").memoryFileSystem());
//   beforeEach(() => jest.requireMock("expo-file-system").__files.clear());
export function memoryFileSystem() {
  const files = new Map<string, string>();
  class Directory {
    exists = true;
    create() {}
    delete() {
      files.clear();
    }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : "dir")).join("/");
    }
    get exists() {
      return files.has(this.uri);
    }
    create() {
      files.set(this.uri, "");
    }
    write(text: string) {
      files.set(this.uri, text);
    }
    async text() {
      return files.get(this.uri) ?? "";
    }
    delete() {
      files.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: "cache" }, __files: files };
}
