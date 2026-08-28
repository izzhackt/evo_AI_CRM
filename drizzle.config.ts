import { defineConfig } from "drizzle-kit";

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set for Drizzle commands`);
  }
  if (value !== value.trim()) {
    throw new Error(`${name} must not contain leading or trailing whitespace`);
  }
  return value;
}

function readPort(name: string): number {
  const value = readRequired(name);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer port`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer port`);
  }
  return port;
}

const user = readRequired("EVO_POSTGRES_USER");
const password = readRequired("EVO_POSTGRES_PASSWORD");
const host = readRequired("EVO_POSTGRES_HOST");
const port = readPort("EVO_POSTGRES_PORT");
const database = readRequired("EVO_POSTGRES_DB");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  dbCredentials: {
    url: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
  },
});
