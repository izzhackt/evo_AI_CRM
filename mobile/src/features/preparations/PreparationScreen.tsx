// «Требования программы» (веб: /portal/preparations/[applicationId]): шапка выбранной программы и список документов,
// которые нужны для неё, с состоянием файла и решением EVO. Экран читает `student_catalog_preparations_v1` (общий
// запрос «Мои программы») и `application_package_readiness_v1`; единственная запись здесь - «Открыть список документов»
// (`student_initialize_application_requirements_v1`), только для дела на сопровождении и программы «Собираем документы».
// Файл к требованию (загрузка, отправка на проверку, сохранённые версии, история) идёт через `PreparationProvider`;
// комплект программы и восстановление прерванных отправок комплекта добавляет следующий PR этого среза (G37, G38).
import { universityUuid } from "@web/lib/platform-university-catalog";
import type { ApplicationRequirementsIntent } from "@web/lib/portal/application-requirements";
import { randomUUID } from "expo-crypto";
import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { useApplicationReadiness } from "@/api/preparations-queries";
import { initializeApplicationRequirements } from "@/api/preparations-writes";
import { loadErrorKey, usePreparations, useRefetchOnFocus } from "@/api/queries";
import { PreparationProvider } from "@/features/preparations/context";
import { useDocumentStrings } from "@/features/preparations/document-strings";
import { nativePreparationIo, type PreparationIo } from "@/features/preparations/io";
import { PreparationHeader } from "@/features/preparations/PreparationHeader";
import { RequirementsSection, type RequirementsBusy } from "@/features/preparations/RequirementsSection";
import { PROGRAMS_LIST_ROUTE, canInitializeRequirements } from "@/features/preparations/model";
import { memoryIntentHolder, runRequirementsUpdate, type RequirementsErrorKey } from "@/features/preparations/requirements-flow";
import { go, goStamped, WRITE_EVO_ROUTE } from "@/features/portal/navigation";
import { useLang } from "@/i18n/LangProvider";
import { useFocusEffect } from "@/lib/focus";
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

export function PreparationScreen({ applicationId: raw, io = nativePreparationIo }: { applicationId: string; io?: PreparationIo }) {
  // Как веб: `universityUuid(route.applicationId)?.toLowerCase() ?? notFound()`.
  const applicationId = universityUuid(String(raw ?? ""))?.toLowerCase() ?? null;
  // Экран один на все программы (`preparations/_layout.tsx`): другая программа приходит новым параметром, и ключ начинает
  // её с чистого состояния (текст ошибки и запрос прежней программы к ней не относятся).
  return applicationId === null ? <NotFound /> : <PreparationBody key={applicationId} applicationId={applicationId} io={io} />;
}

function PreparationBody({ applicationId, io }: { applicationId: string; io: PreparationIo }) {
  const { lang, m, t } = useLang();
  const strings = t("preparations");
  const documentStrings = useDocumentStrings();
  const universityStrings = t("universities");
  const { transport, studentCaseId, organizationId, membershipId, tier, canSelectPrograms } = usePortalApi();
  useRefetchOnFocus();
  const preparations = usePreparations();
  const saved = preparations.data?.find((item) => item.applicationId === applicationId) ?? null;
  const readiness = useApplicationReadiness(applicationId, saved !== null);
  const [busy, setBusy] = useState<RequirementsBusy>(null);
  const [error, setError] = useState<RequirementsErrorKey | null>(null);
  // Растёт при каждом обновлении: истории перечитываются, а не показывают прежние страницы (веб: `historyEpoch`).
  const [epoch, setEpoch] = useState(0);
  const lock = useRef(false);
  // Замороженный запрос «Открыть список документов» живёт в памяти экрана, а не в хранилище телефона. Это безопасно: сервер
  // повторяет квитанцию на тот же `requestId`, а новый `requestId` после потери прежнего не создаёт второй список (если список
  // уже открыт, сервер отвечает квитанцией на существующий и пишет одну строку аудита; записи идут под блокировкой дела и
  // программы, `student_initialize_application_requirements_v1`, миграция 218). Потерянный при закрытии приложения запрос
  // дубля не даёт.
  const intent = useRef<ApplicationRequirementsIntent | null>(null);
  // Экран остаётся смонтированным в скрытой вкладке, когда студент уходит на другую: уход сбрасывает то, что относилось к
  // прошлому показу (текст ошибки и замороженный запрос). Идущее обновление не трогается: у него свой замок.
  useFocusEffect(
    useCallback(
      () => () => {
        setError(null);
        intent.current = null;
      },
      [setError],
    ),
  );
  const canInitialize = saved !== null && canInitializeRequirements(canSelectPrograms, saved.applicationStatus);
  // Прежний ответ остаётся на экране, если очередное чтение не удалось (возврат на экран, опрос, «Проверить состояние»): под
  // списком пометка «Не удалось обновить» и повтор, полная ошибка только когда данных нет совсем. Сайт здесь прячет список
  // (`setDocuments(null)`), потому что читает только по нажатию; в приложении то же прятанье стирало бы хороший список при
  // каждом обрыве связи. Записи (файл, отправка) сервер всё равно сверяет с ожидаемым состоянием, прежний ответ их не подменяет.
  const documents = readiness.data ?? null;
  const stale = readiness.isError && documents !== null;
  const errorText = useCallback((key: RequirementsErrorKey) => (key === "prep.forbidden" ? m("prep.forbidden") : strings[key]), [m, strings]);

  /**
   * `announceSuccess`: сказать читалке об удачной проверке. После действия с документом (`onSaved`) этого не нужно: его итог
   * («Документ отправлен на проверку») уже сказан, и второе сообщение перебило бы первое. Ошибки озвучиваются всегда.
   */
  const update = useCallback(
    async (initialize: boolean, announceSuccess = true) => {
      if (lock.current || saved === null) return;
      lock.current = true;
      // Прежний ответ был: если чтение не удастся, он останется на экране с пометкой, и озвучить нужно её, а не «не загрузилось».
      const hadAnswer = readiness.data !== undefined;
      setEpoch((value) => value + 1);
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
        if (outcome.error) announce(outcome.error === "requirementsUnavailable" && hadAnswer ? m("prep.stale") : errorText(outcome.error));
        else if (announceSuccess) announce(m(outcome.initialized ? "prep.listOpened" : "prep.checked"));
      } finally {
        lock.current = false;
        setBusy(null);
      }
    },
    [applicationId, canInitialize, errorText, m, readiness, saved, studentCaseId, transport],
  );

  const scope = useMemo(() => ({ organizationId, membershipId, studentCaseId, applicationId }), [organizationId, membershipId, studentCaseId, applicationId]);
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
  } else if (saved === null && preparations.isFetching) {
    // Программу только что добавили, а список в кэше ещё прежний: пока он перечитывается, «не найдена» не мигает.
    body = <CardSkeleton label={m("state.loading")} lines={4} testID="prep-loading" />;
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
          // Пока прежний ответ на экране, о сбое чтения говорит пометка «Не удалось обновить», а не второй текст ошибки.
          error={error && !(error === "requirementsUnavailable" && stale) ? errorText(error) : null}
          staleNotice={stale ? { message: m("prep.stale"), retryLabel: m("gate.retry") } : null}
          loadingLabel={`${strings.requirements}. ${m("state.loading")}`}
          strings={strings}
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
      <PreparationProvider value={{ scope, io, strings: documentStrings, onSaved: () => void update(false, false), epoch }}>
        <View style={{ gap: 16 }} testID="prep-screen">
          <BackLink label={strings.back} />
          {body}
        </View>
      </PreparationProvider>
    </Screen>
  );
}
