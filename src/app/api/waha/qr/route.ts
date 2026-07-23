import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getSetting } from "@/lib/db";

function normalizeBaseUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function GET() {
  const user = await currentUser();
  if (!user || user.role !== "admin") return new NextResponse("Forbidden", { status: 403 });

  const baseUrl = normalizeBaseUrl(getSetting("waha_base_url"));
  const apiKey = getSetting("waha_api_key")?.trim();
  const session = getSetting("waha_session_name")?.trim();
  if (!baseUrl || !apiKey || !session) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const res = await fetch(`${baseUrl}/api/${encodeURIComponent(session)}/auth/qr`, {
    headers: {
      "X-Api-Key": apiKey,
      Accept: "image/png",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ error: "waha_qr_unavailable" }, { status: res.status });
  }

  const image = await res.arrayBuffer();
  return new NextResponse(image, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/png",
      "Cache-Control": "no-store",
    },
  });
}
