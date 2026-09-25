import "server-only";

import { cookies } from "next/headers";

import type { ActivePlatformActor } from "../platform-auth";
import { LOOK_PREVIEW_COOKIE, LOOK_PREVIEW_VALUE, lookPreviewAllowed } from "./look-preview-contract";

/** Облик для `data-look` оболочки V3: «next» только у Admin с включённым предпросмотром (Э1.1). */
export async function readLookPreview(actor: Pick<ActivePlatformActor, "systemRole" | "presentationRole">): Promise<boolean> {
  if (!lookPreviewAllowed(actor)) return false;
  return (await cookies()).get(LOOK_PREVIEW_COOKIE)?.value === LOOK_PREVIEW_VALUE;
}
