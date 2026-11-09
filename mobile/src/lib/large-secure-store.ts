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

export class LargeSecureStore {
  private readonly deps: LargeSecureStoreDeps;

  constructor(deps: LargeSecureStoreDeps) {
    this.deps = deps;
  }

  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = this.deps.randomBytes(256 / 8);
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await this.deps.secrets.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await this.deps.secrets.getItemAsync(key);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await this.deps.bulk.getItem(key);
    if (!encrypted) return null;
    return this.decrypt(key, encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await this.deps.bulk.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await this.deps.bulk.removeItem(key);
    await this.deps.secrets.deleteItemAsync(key);
  }
}
