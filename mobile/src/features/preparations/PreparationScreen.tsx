// «Требования программы» (веб: /portal/preparations/[applicationId]): шапка выбранной программы и список документов,
// которые нужны для неё, с состоянием файла и решением EVO. Экран читает `student_catalog_preparations_v1` (общий
// запрос «Мои программы») и `application_package_readiness_v1`; единственная запись здесь - «Открыть список документов»
// (`student_initialize_application_requirements_v1`), только для дела на сопровождении и программы «Собираем документы».
// Файлы, комплект и незавершённые отправки добавляют следующие PR этого среза (G36-G38).
import { universityUuid } from "@web/lib/platform-university-catalog";
import type { ApplicationRequirementsIntent } from "@web/lib/portal/application-requirements";
import { randomUUID } from "expo-crypto";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { useApplicationReadiness } from "@/api/preparations-queries";
import { initializeApplicationRequirements } from "@/api/preparations-writes";
import { loadErrorKey, usePreparations, useRefetchOnFocus } from "@/api/queries";
import { PreparationHeader } from "@/features/preparations/PreparationHeader";
import { RequirementsSection, type RequirementsBusy } from "@/features/preparations/RequirementsSection";
import { PROGRAMS_LIST_ROUTE, canInitializeRequirements } from "@/features/preparations/model";
import { memoryIntentHolder, runRequirementsUpdate, type RequirementsErrorKey } from "@/features/preparations/requirements-flow";
import { go, goStamped, WRITE_EVO_ROUTE } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { isAllowed } from "@/shell/sections";
import { announce } from "@/ui/a11y";
import { CardSkeleton, InlineAlert, LinkButton } from "@/ui/CardParts";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

function BackLink({ label }: { label: string }) {
  return <LinkButton label={label} onPress={() => goStamped(PROGRAMS_LIST_ROUTE)} testID="prep-back" />;
}

/** Чужая или пустая ссылка: идентификатор не годится или такой программы нет в списке студента (веб: страница «не найдена»). */
function NotFound() {
  const { m, t } = useLang();
  return (
    <Screen topInset={false} tabBar>
      <View style={{ gap: 12 }} testID="prep-not-found">
        <BackLink label={t("preparations").back} />
        <Text variant="body" accessibilityRole="alert">
          {m("prep.notFound")}
        </Text>
      </View>
    </Screen>
  );
}

export function PreparationScreen({ applicationId: raw }: { applicationId: string }) {
  // Как веб: `universityUuid(route.applicationId)?.toLowerCase() ?? notFound()`.
  const applicationId = universityUuid(String(raw ?? ""))?.toLowerCase() ?? null;
  return applicationId === null ? <NotFound /> : <PreparationBody applicationId={applicationId} />;
}

function PreparationBody({ applicationId }: { applicationId: string }) {
  const { lang, m, t } = useLang();
  const strings = t("preparations");
  const documentStrings = t("programDocuments");
  const universityStrings = t("universities");
  const { transport, studentCaseId, tier, canSelectPrograms } = usePortalApi();
  useRefetchOnFocus();
  const preparations = usePreparations();
  const saved = preparations.data?.find((item) => item.applicationId === applicationId) ?? null;
  const readiness = useApplicationReadiness(applicationId, saved !== null);
  const [busy, setBusy] = useState<RequirementsBusy>(null);
  const [error, setError] = useState<RequirementsErrorKey | null>(null);
  const lock = useRef(false);
  const intent = useRef<ApplicationRequirementsIntent | null>(null);
  const canInitialize = saved !== null && canInitializeRequirements(canSelectPrograms, saved.applicationStatus);
  // Неудачное чтение не оставляет прежний ответ «текущим» (веб: `setDocuments(null)`): после сбоя список и файлы не показываются.
  const documents = readiness.isError ? null : (readiness.data ?? null);
  const errorText = useCallback((key: RequirementsErrorKey) => (key === "prep.forbidden" ? m("prep.forbidden") : strings[key]), [m, strings]);

  const update = useCallback(
    async (initialize: boolean) => {
      if (lock.current || saved === null) return;
      lock.current = true;
      setBusy(initialize ? "initialize" : "read");
      setError(null);
      try {
        const outcome = await runRequirementsUpdate({
          initialize,
          canInitialize,
          studentCaseId,
          applicationId,
          read: async () => {
            const result = await readiness.refetch({ throwOnError: true });
            if (!result.data) throw new Error("readiness");
            return result.data;
          },
          runInitialize: (value) => initializeApplicationRequirements(transport, value),
          intents: memoryIntentHolder(intent),
          newRequestId: randomUUID,
        });
        setError(outcome.error);
        announce(outcome.error ? errorText(outcome.error) : outcome.initialized ? m("prep.listOpened") : null);
      } finally {
        lock.current = false;
        setBusy(null);
      }
    },
    [applicationId, canInitialize, errorText, m, readiness, saved, studentCaseId, transport],
  );

  const refresh = () => {
    void preparations.refetch();
    if (saved) void readiness.refetch();
  };

  let body;
  if (preparations.data === undefined) {
    body =
      preparations.status === "error" ? (
        <InlineAlert message={m(loadErrorKey(preparations.error))} retryLabel={m("gate.retry")} onRetry={() => void preparations.refetch()} testID="prep-error-list" />
      ) : (
        <CardSkeleton label={m("state.loading")} lines={4} testID="prep-loading" />
      );
  } else if (saved === null) {
    body = (
      <Text variant="body" accessibilityRole="alert" testID="prep-not-found">
        {m("prep.notFound")}
      </Text>
    );
  } else {
    body = (
      <>
        <PreparationHeader saved={saved} strings={strings} universityStrings={universityStrings} lang={lang} />
        <RequirementsSection
          documents={documents}
          loading={readiness.isPending}
          eligible={canInitialize && documents !== null}
          busy={busy}
          error={error ? errorText(error) : null}
          loadingLabel={`${strings.requirements}. ${m("state.loading")}`}
          strings={strings}
          documentStrings={documentStrings}
          onCheck={() => void update(false)}
          onInitialize={() => void update(true)}
          onOpenDocuments={isAllowed("documents", tier) ? () => go("/documents") : null}
          onWrite={tier === "assisted" ? () => go(WRITE_EVO_ROUTE) : null}
        />
      </>
    );
  }
  return (
    <Screen topInset={false} tabBar onRefresh={refresh} refreshing={preparations.isRefetching || readiness.isRefetching}>
      <View style={{ gap: 16 }} testID="prep-screen">
        <BackLink label={strings.back} />
        {body}
      </View>
    </Screen>
  );
}
