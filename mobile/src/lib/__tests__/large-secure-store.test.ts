import { LargeSecureStore } from "@/lib/large-secure-store";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => void data.set(k, v),
    removeItem: async (k: string) => void data.delete(k),
    getItemAsync: async (k: string) => data.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void data.set(k, v),
    deleteItemAsync: async (k: string) => void data.delete(k),
  };
}

describe("LargeSecureStore", () => {
  const make = () => {
    const secrets = memory();
    const bulk = memory();
    let n = 0;
    const store = new LargeSecureStore({ secrets, bulk, randomBytes: (len) => Uint8Array.from({ length: len }, () => ++n % 256) });
    return { store, secrets, bulk };
  };

  it("шифрует значение: в основном хранилище шифротекст, ключ в SecureStore", async () => {
    const { store, secrets, bulk } = make();
    const session = JSON.stringify({ access_token: "synthetic-token", pad: "x".repeat(5000) });
    await store.setItem("evo-auth", session);
    expect(bulk.data.get("evo-auth")).not.toContain("synthetic-token");
    expect(secrets.data.get("evo-auth")).toHaveLength(64); // 256 бит в hex
    await expect(store.getItem("evo-auth")).resolves.toBe(session);
  });

  it("удаляет обе части", async () => {
    const { store, secrets, bulk } = make();
    await store.setItem("k", "v");
    await store.removeItem("k");
    expect(bulk.data.size + secrets.data.size).toBe(0);
    await expect(store.getItem("k")).resolves.toBeNull();
  });

  it("без ключа в SecureStore значение не читается", async () => {
    const { store, secrets } = make();
    await store.setItem("k", "v");
    secrets.data.clear();
    await expect(store.getItem("k")).resolves.toBeNull();
  });

  it("повреждённый шифротекст: null и запись очищена", async () => {
    const { store, secrets, bulk } = make();
    await store.setItem("k", "v");
    bulk.data.set("k", "zz-not-hex");
    await expect(store.getItem("k")).resolves.toBeNull();
    expect(bulk.data.size + secrets.data.size).toBe(0);
  });

  it("шифротекст пишется раньше ключа: сбой записи ключа не оставляет нового ключа без шифротекста", async () => {
    const { store, secrets, bulk } = make();
    await store.setItem("k", "old");
    const oldKey = secrets.data.get("k");
    const failing = new LargeSecureStore({
      secrets: { ...secrets, setItemAsync: async () => { throw new Error("boom"); } },
      bulk,
      randomBytes: (len) => new Uint8Array(len).fill(7),
    });
    await expect(failing.setItem("k", "new")).rejects.toThrow();
    expect(secrets.data.get("k")).toBe(oldKey);
  });
});
