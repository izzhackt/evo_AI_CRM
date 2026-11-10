import { Redirect } from "expo-router";

import { useSession } from "@/session/SessionProvider";

/** Корень "/" не экран: отправляет на первый доступный по состоянию сессии маршрут. */
export default function Index() {
  const { state, mustSetPassword } = useSession();
  if (state.kind === "signedOut" || state.kind === "authenticating") return <Redirect href="/sign-in" />;
  if (mustSetPassword) return <Redirect href="/set-password" />;
  if (state.kind === "needsConsent") return <Redirect href="/consent" />;
  if (state.kind === "active") return <Redirect href="/home" />;
  return <Redirect href="/gate" />;
}
