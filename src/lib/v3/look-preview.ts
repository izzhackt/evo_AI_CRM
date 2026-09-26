import "server-only";

import { cookies } from "next/headers";

import type { ActivePlatformActor } from "../platform-auth";
import { LOOK_PREVIEW_COOKIE, lookPreviewEnabled, lookPreviewVisible } from "./look-preview-contract";

/**
 * Облик для `data-look` оболочки V3: «next» только у Admin с включённым
 * предпросмотром (Э1.1), в том числе при просмотре роли (Э1.2).
 */
export async function readLookPreview(actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">): Promise<boolean> {
  // Не-Admin cookie не читают вовсе.
  if (!lookPreviewVisible(actor)) return false;
  return lookPreviewEnabled(actor, (await cookies()).get(LOOK_PREVIEW_COOKIE)?.value);
}
