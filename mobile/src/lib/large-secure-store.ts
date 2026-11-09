// Хранилище сессии Supabase по схеме LargeSecureStore из документации Supabase
// (https://supabase.com/docs/guides/getting-started/tutorials/with-expo-react-native):
// SecureStore держит 256-битный ключ (лимит значения ~2 КБ), а AES-CTR шифротекст
// сессии лежит в AsyncStorage.
import * as aesjs from "aes-js";

export type KeyValueStore = Readonly<{
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}>;

export type SecretStore = Readonly<{
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}>;

export type LargeSecureStoreDeps = Readonly<{
  secrets: SecretStore;
  bulk: KeyValueStore;
  randomBytes: (length: number) => Uint8Array;
}>;

/**
 * Метка перед открытым текстом: AES-CTR не проверяет целостность, и чужой ключ даёт «мусор»,
 * который иногда ещё и валидный UTF-8. Без метки в начале расшифровка отвергается.
 */
export const PLAINTEXT_MAGIC = "EVO1:";

export class LargeSecureStore {
  private readonly deps: LargeSecureStoreDeps;

  constructor(deps: LargeSecureStoreDeps) {
    this.deps = deps;
  }

  private encrypt(value: string): { keyHex: string; cipherHex: string } {
    const encryptionKey = this.deps.randomBytes(256 / 8);
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(PLAINTEXT_MAGIC + value));
    return { keyHex: aesjs.utils.hex.fromBytes(encryptionKey), cipherHex: aesjs.utils.hex.fromBytes(encryptedBytes) };
  }

  /** Повреждённые данные или несовпадение ключа -> null (сессия просто считается пустой). */
  private decrypt(keyHex: string, value: string): string | null {
    try {
      const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
      const plain = aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
      return plain.startsWith(PLAINTEXT_MAGIC) ? plain.slice(PLAINTEXT_MAGIC.length) : null;
    } catch {
      return null;
    }
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await this.deps.bulk.getItem(key);
    if (!encrypted) return null;
    const keyHex = await this.deps.secrets.getItemAsync(key);
    const plain = keyHex ? this.decrypt(keyHex, encrypted) : null;
    if (plain === null) {
      // Шифротекст без ключа или повреждённый: убираем, чтобы не застрять на нём.
      await this.removeItem(key).catch(() => undefined);
      return null;
    }
    return plain;
  }

  /**
   * Порядок записи: сначала шифротекст в AsyncStorage, потом ключ в SecureStore.
   * Если оборвётся между шагами, в хранилище лежит шифротекст под старым ключом:
   * getItem увидит несовпадение, очистит запись, а сессия запросится заново.
   * Старый ключ не теряется до успеха обеих записей.
   */
  async setItem(key: string, value: string): Promise<void> {
    const { keyHex, cipherHex } = this.encrypt(value);
    await this.deps.bulk.setItem(key, cipherHex);
    await this.deps.secrets.setItemAsync(key, keyHex);
  }

  async removeItem(key: string): Promise<void> {
    await this.deps.bulk.removeItem(key);
    await this.deps.secrets.deleteItemAsync(key);
  }
}
