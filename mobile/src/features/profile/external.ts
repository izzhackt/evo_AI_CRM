import { Linking } from "react-native";

export const PRIVACY_URL = "https://evoadmissions.com/ru/privacy/";
export const SUPPORT_URL = "https://evoadmissions.com/ru/support/";

/** Открыть ссылку в браузере системы; `false`, если система не смогла. */
export async function openExternal(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
