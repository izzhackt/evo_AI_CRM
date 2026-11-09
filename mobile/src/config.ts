// Единственное место, где читаются EXPO_PUBLIC_* (Metro подставляет значения
// при сборке, поэтому обращения к process.env записаны буквально).
// Значения публичные; секретных ключей здесь быть не может.

export type AppConfig = Readonly<{
  supabaseUrl: string;
  supabasePublishableKey: string;
  portalBaseUrl: string;
}>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type RawEnv = Readonly<{
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  EXPO_PUBLIC_PORTAL_BASE_URL?: string;
}>;

function required(env: RawEnv, name: keyof RawEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigError(
      `Не задана переменная ${name}. Скопируйте mobile/.env.example в mobile/.env и заполните значения.`,
    );
  }
  return value;
}

function originOf(name: string, raw: string, allowHttp: boolean): string {
  // Без URL.origin: в React Native он не реализован.
  const match = /^(https?):\/\/([A-Za-z0-9.-]+(?::\d{1,5})?)(?:[/?#].*)?$/.exec(raw);
  if (!match) {
    throw new ConfigError(`${name}: это не адрес (нужен вид https://host).`);
  }
  const [, protocol, host] = match;
  if (protocol !== "https" && !allowHttp) {
    throw new ConfigError(`${name}: нужен https-адрес.`);
  }
  return `${protocol}://${host.toLowerCase()}`;
}

/** Ключ service_role / secret в клиенте недопустим (как в iOS write-release-config.sh). */
function assertPublishableKey(raw: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
    throw new ConfigError("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: недопустимые символы.");
  }
  if (raw.startsWith("sb_secret_")) {
    throw new ConfigError("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: секретный ключ в приложение класть нельзя.");
  }
  const payload = raw.split(".")[1];
  if (payload) {
    try {
      const json = JSON.parse(globalThis.atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: unknown };
      if (json.role === "service_role") {
        throw new ConfigError("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ключ service_role в приложение класть нельзя.");
      }
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      // не JWT (sb_publishable_*): проверять нечего
    }
  }
  return raw;
}

/** Разбор окружения. Кидает ConfigError с понятным текстом, если чего-то нет. */
export function parseConfig(env: RawEnv, options: { allowHttp?: boolean } = {}): AppConfig {
  const allowHttp = options.allowHttp ?? false;
  return {
    supabaseUrl: originOf("EXPO_PUBLIC_SUPABASE_URL", required(env, "EXPO_PUBLIC_SUPABASE_URL"), allowHttp),
    supabasePublishableKey: assertPublishableKey(required(env, "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY")),
    portalBaseUrl: originOf("EXPO_PUBLIC_PORTAL_BASE_URL", required(env, "EXPO_PUBLIC_PORTAL_BASE_URL"), allowHttp),
  };
}

let cached: AppConfig | undefined;

/** Конфигурация приложения (читается один раз). В режиме разработки допускается http для локального стенда. */
export function getConfig(): AppConfig {
  cached ??= parseConfig(
    {
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      EXPO_PUBLIC_PORTAL_BASE_URL: process.env.EXPO_PUBLIC_PORTAL_BASE_URL,
    },
    { allowHttp: __DEV__ },
  );
  return cached;
}
