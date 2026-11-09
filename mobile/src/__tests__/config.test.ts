import { ConfigError, parseConfig } from "@/config";

const good = {
  EXPO_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_PLACEHOLDER",
  EXPO_PUBLIC_PORTAL_BASE_URL: "https://app.example.test/",
};

describe("parseConfig", () => {
  it("читает три значения и нормализует адреса до origin", () => {
    expect(parseConfig(good)).toEqual({
      supabaseUrl: "https://supabase.example.test",
      supabasePublishableKey: "sb_publishable_PLACEHOLDER",
      portalBaseUrl: "https://app.example.test",
    });
  });

  it.each(["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "EXPO_PUBLIC_PORTAL_BASE_URL"] as const)(
    "без %s кидает понятную ошибку с именем переменной",
    (name) => {
      const env = { ...good, [name]: undefined };
      expect(() => parseConfig(env)).toThrow(ConfigError);
      expect(() => parseConfig(env)).toThrow(name);
      expect(() => parseConfig({ ...good, [name]: "   " })).toThrow(name);
    },
  );

  it("не принимает http вне разработки, но принимает его в режиме разработки", () => {
    const http = { ...good, EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" };
    expect(() => parseConfig(http)).toThrow(/https/);
    expect(parseConfig(http, { allowHttp: true }).supabaseUrl).toBe("http://127.0.0.1:54321");
  });

  it("отвергает не-адрес", () => {
    expect(() => parseConfig({ ...good, EXPO_PUBLIC_PORTAL_BASE_URL: "app.example.test" })).toThrow(ConfigError);
  });

  it("отвергает секретные ключи", () => {
    expect(() => parseConfig({ ...good, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" })).toThrow(/секретный/);
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    expect(() => parseConfig({ ...good, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `aaa.${payload}.bbb` })).toThrow(/service_role/);
  });

  it("принимает JWT с ролью anon", () => {
    const payload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
    expect(parseConfig({ ...good, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `aaa.${payload}.bbb` }).supabasePublishableKey).toContain("aaa.");
  });
});
