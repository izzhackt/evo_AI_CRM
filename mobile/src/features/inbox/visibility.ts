// «Экран виден»: вкладка в фокусе и приложение на переднем плане. Чат читается и
// опрашивается только пока оба условия верны (iPhone MessagesThreadView, веб useMarkCaseChatRead).
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { useFocusEffect } from "@/lib/focus";
import { isForeground } from "@/lib/poll";

export function useScreenVisible(): boolean {
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(isForeground(AppState.currentState));
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => setForeground(isForeground(status)));
    return () => subscription.remove();
  }, []);
  return focused && foreground;
}
