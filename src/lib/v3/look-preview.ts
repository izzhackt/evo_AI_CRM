import "server-only";

import { cookies } from "next/headers";

import type { ActivePlatformActor } from "../platform-auth";
import { LOOK_PREVIEW_COOKIE, lookPreviewAllowed, lookPreviewEnabled } from "./look-preview-contract";

/** Облик для `data-look` оболочки V3: «next» только у Admin с включённым предпросмотром (Э1.1). */
export async function readLookPreview(actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">): Promise<boolean> {
  // Не-Admin и просмотр роли cookie не читают вовсе.
  if (!lookPreviewAllowed(actor)) return false;
  return lookPreviewEnabled(actor, (await cookies()).get(LOOK_PREVIEW_COOKIE)?.value);
}
