import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { db, Role } from "./db";

const SECRET = process.env.AUTH_SECRET || "edu-admin-dev-secret-change-in-production";
const COOKIE = "edu_session";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
};

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function makeToken(userId: number): string {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function parseToken(token: string): number | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const id = parseInt(payload.split(".")[0], 10);
  return Number.isFinite(id) ? id : null;
}

export async function setSession(userId: number) {
  const store = await cookies();
  store.set(COOKIE, makeToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const id = parseToken(token);
  if (id == null) return null;
  const row = db()
    .prepare("SELECT id, email, name, role FROM users WHERE id = ?")
    .get(id) as SessionUser | undefined;
  return row ?? null;
}

export function isStaff(role: Role): boolean {
  return role !== "client";
}
