// Число найденных для читалки на iOS. Живая область (`accessibilityLiveRegion`) работает только на Android, поэтому на iPhone
// число озвучивается после паузы, пока студент печатает (веб: `role="status"` у поиска и у подбора программ). На Android область
// стоит у самого текста, и вызывать `announce` значило бы читать дважды.
import { useEffect } from "react";
import { Platform } from "react-native";

import { announce } from "@/ui/a11y";

export function useAnnounceResults(message: string | null): void {
  useEffect(() => {
    if (message === null || Platform.OS !== "ios") return undefined;
    const id = setTimeout(() => announce(message), 700);
    return () => clearTimeout(id);
  }, [message]);
}
