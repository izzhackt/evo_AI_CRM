import { useCscaHome } from "@/features/learning/queries";
import { SessionsPanel } from "@/features/learning/csca/SessionsPanel";
import { StackPage, SubHeader, useBack } from "@/features/learning/ui";
import { loadErrorKey } from "@/api/queries";
import { useLang } from "@/i18n/LangProvider";
import { CardSkeleton, InlineAlert } from "@/ui/CardParts";

export function CscaSessionsScreen() {
  const { m, t } = useLang();
  const back = useBack("/csca");
  const c = t("csca");
  const home = useCscaHome(true);
  return (
    <StackPage header={<SubHeader title={c.sessionsHeading} onBack={back} backLabel={c.backToHome} testID="sessions-title" />} testID="sessions-screen">
      {home.data ? <SessionsPanel home={home.data} /> : home.status === "error" ? <InlineAlert message={m(loadErrorKey(home.error))} retryLabel={m("gate.retry")} onRetry={() => void home.refetch()} /> : <CardSkeleton label={m("state.loading")} lines={4} />}
    </StackPage>
  );
}
