import { Linking } from "react-native";
import { AI_CONSENT_PRIVACY_URL, PORTAL_SUPPORT_URL } from "@web/lib/portal/ai-consent";

// Адреса страниц сайта общие с вебом (одна правда, `src/lib/portal/ai-consent.ts`).
export const PRIVACY_URL = AI_CONSENT_PRIVACY_URL;
export const SUPPORT_URL = PORTAL_SUPPORT_URL;

/** Открыть ссылку в браузере системы; `false`, если система не смогла. */
export async function openExternal(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
