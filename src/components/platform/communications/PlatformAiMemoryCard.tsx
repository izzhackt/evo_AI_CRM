import {
  previewPlatformAiLexicalAction,
  recordPlatformAiFactAction,
  recordPlatformAiMemoryAction,
  recordPlatformAiQualificationAction,
  setPlatformAiControlAction,
} from "@/lib/platform-ai-memory-actions";
import {
  PLATFORM_AI_FACT_KEYS,
  PLATFORM_AI_QUALIFICATION_STATES,
  type PlatformAiControlState,
  type PlatformAiFactKey,
  type PlatformAiRetrievalCapabilities,
  type PlatformAiRetrievalEvidence,
  type PlatformConversationAiMemory,
} from "@/lib/platform-ai-memory";

export type PlatformAiMemoryCardLabels = Readonly<{
  title: string;
  hint: string;
  disabled: string;
  summary: string;
  shortSummary: string;
  longSummary: string;
  saveSummary: string;
  facts: string;
  noFacts: string;
  factKey: string;
  factValue: string;
  factStatus: string;
  factActive: string;
  factRetracted: string;
  saveFact: string;
  qualification: string;
  completeness: string;
  missingFacts: string;
  notes: string;
  saveQualification: string;
  control: string;
  controlPaused: string;
  controlStaffTakeover: string;
  controlStaffOnly: string;
  pause: string;
  staffTakeover: string;
  returnStaffOnly: string;
  retrieval: string;
  lexicalPreview: string;
  lexicalDegraded: string;
  providerBlocked: string;
  noEvidence: string;
  noMatch: string;
  latestInboundRequired: string;
  edit: string;
  sourceMessage: string;
  sourceMessageHint: string;
  factLabels: Readonly<Record<PlatformAiFactKey, string>>;
  qualificationLabels: Readonly<
    Record<(typeof PLATFORM_AI_QUALIFICATION_STATES)[number], string>
  >;
}>;

export type PlatformAiMemorySourceMessage = Readonly<{
  id: string;
  label: string;
}>;

function displayFactValue(value: string | readonly string[] | null) {
  if (Array.isArray(value)) return value.join(" · ");
  return value ?? "—";
}

function controlLabel(
  state: PlatformAiControlState,
  labels: PlatformAiMemoryCardLabels,
) {
  if (state === "staff_takeover") return labels.controlStaffTakeover;
  if (state === "staff_only") return labels.controlStaffOnly;
  return labels.controlPaused;
}

const fieldClass =
  "w-full rounded-nav border border-border bg-surface px-2.5 py-2 text-[11px] text-fg outline-none transition focus:border-info/60 focus:ring-2 focus:ring-info/10";
const secondaryButtonClass =
  "rounded-nav border border-border bg-surface px-2.5 py-1.5 text-[10.5px] font-bold text-fg-2 transition hover:border-info/40 hover:text-fg";

export function PlatformAiMemoryCard({
  conversationId,
  inboundSourceMessages,
  memory,
  capabilities,
  evidence,
  labels,
  testIdSuffix = "",
}: {
  conversationId: string;
  inboundSourceMessages: readonly PlatformAiMemorySourceMessage[];
  memory: PlatformConversationAiMemory | null;
  capabilities: PlatformAiRetrievalCapabilities | null;
  evidence: PlatformAiRetrievalEvidence | null;
  labels: PlatformAiMemoryCardLabels;
  testIdSuffix?: "" | "-mobile";
}) {
  const testId = (value: string) => `${value}${testIdSuffix}`;
  const currentFactByKey = new Map(
    memory?.facts.map((fact) => [fact.key, fact]) ?? [],
  );
  const latestSourceMessageId = inboundSourceMessages[0]?.id;

  function sourceMessageSelect(
    selectorTestId: string,
    defaultValue: string | null,
  ) {
    return (
      <label className="block text-[10px] font-semibold text-fg-3">
        {labels.sourceMessage}
        <select
          className={`${fieldClass} mt-1`}
          data-testid={testId(selectorTestId)}
          defaultValue={
            inboundSourceMessages.some((message) => message.id === defaultValue)
              ? defaultValue ?? undefined
              : latestSourceMessageId
          }
          name="sourceMessageId"
          required
        >
          {inboundSourceMessages.map((message) => (
            <option key={message.id} value={message.id}>
              {message.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block font-normal leading-4 text-fg-3">
          {labels.sourceMessageHint}
        </span>
      </label>
    );
  }

  return (
    <section
      className="border-y border-border py-3"
      data-testid={testId("platform-ai-memory-card")}
      data-enabled={memory !== null && capabilities !== null ? "true" : "false"}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.05em] text-fg">
            {labels.title}
          </h3>
          <p className="mt-1 text-[10.5px] leading-4 text-fg-3">{labels.hint}</p>
        </div>
        <span
          className="shrink-0 rounded-full border border-warn/25 bg-warn-weak px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-warn"
          data-testid={testId("platform-ai-memory-control-state")}
          data-control-state={memory?.control.state ?? "paused"}
          data-control-version={memory?.control.version ?? "0"}
        >
          {controlLabel(memory?.control.state ?? "paused", labels)}
        </span>
      </div>

      {!memory || !capabilities ? (
        <p className="mt-3 border-l-2 border-warn/40 pl-2 text-[10.5px] leading-4 text-fg-3">
          {labels.disabled}
        </p>
      ) : (
        <>
          <div className="mt-3" data-testid={testId("platform-ai-memory-summary")}>
            <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.summary}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-fg-2">
              {memory.memory.shortSummary ?? "—"}
            </p>
            {memory.memory.longSummary ? (
              <p className="mt-1 line-clamp-4 text-[10.5px] leading-4 text-fg-3">
                {memory.memory.longSummary}
              </p>
            ) : null}
          </div>

          <details className="mt-2 border-t border-border/70 pt-2">
            <summary className="cursor-pointer text-[10px] font-bold text-info">
              {labels.edit}
            </summary>
            <form
              action={recordPlatformAiMemoryAction}
              className="mt-2 space-y-2"
              data-testid={testId("platform-ai-memory-summary-form")}
            >
              <input type="hidden" name="conversationId" value={conversationId} />
              {sourceMessageSelect(
                "platform-ai-memory-summary-source",
                memory.memory.sourceMessageId,
              )}
              <label className="block text-[10px] font-semibold text-fg-3">
                {labels.shortSummary}
                <textarea
                  className={`${fieldClass} mt-1 min-h-16 resize-y`}
                  defaultValue={memory.memory.shortSummary ?? ""}
                  maxLength={1_000}
                  name="shortSummary"
                  required
                />
              </label>
              <label className="block text-[10px] font-semibold text-fg-3">
                {labels.longSummary}
                <textarea
                  className={`${fieldClass} mt-1 min-h-24 resize-y`}
                  defaultValue={memory.memory.longSummary ?? ""}
                  maxLength={6_000}
                  name="longSummary"
                  required
                />
              </label>
              <button
                className={secondaryButtonClass}
                disabled={inboundSourceMessages.length === 0}
                type="submit"
              >
                {labels.saveSummary}
              </button>
            </form>
          </details>

          <div className="mt-3 border-t border-border/70 pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
                {labels.facts}
              </p>
              <span className="font-mono text-[9px] text-fg-3">
                {memory.facts.length}/{PLATFORM_AI_FACT_KEYS.length}
              </span>
            </div>
            <dl className="mt-2 space-y-1.5" data-testid={testId("platform-ai-memory-facts")}>
              {memory.facts.length ? (
                memory.facts.map((fact) => (
                  <div
                    className="border-l border-border pl-2"
                    data-fact-key={fact.key}
                    data-fact-status={fact.status}
                    data-fact-version={fact.version}
                    key={fact.key}
                  >
                    <dt className="text-[9.5px] font-bold text-fg-3">
                      {labels.factLabels[fact.key]}
                    </dt>
                    <dd className="break-words text-[10.5px] leading-4 text-fg-2">
                      {displayFactValue(fact.value)}
                    </dd>
                  </div>
                ))
              ) : (
                <div className="text-[10.5px] text-fg-3">{labels.noFacts}</div>
              )}
            </dl>

            <details className="mt-2">
              <summary className="cursor-pointer text-[10px] font-bold text-info">
                {labels.edit}
              </summary>
              <form
                action={recordPlatformAiFactAction}
                className="mt-2 grid gap-2"
                data-testid={testId("platform-ai-memory-fact-form")}
              >
                <input type="hidden" name="conversationId" value={conversationId} />
                {sourceMessageSelect(
                  "platform-ai-memory-fact-source",
                  latestSourceMessageId ?? null,
                )}
                <label className="text-[10px] font-semibold text-fg-3">
                  {labels.factKey}
                  <select
                    className={`${fieldClass} mt-1`}
                    data-testid={testId("platform-ai-memory-fact-key")}
                    name="factKey"
                  >
                    {PLATFORM_AI_FACT_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {labels.factLabels[key]}
                        {currentFactByKey.has(key)
                          ? ` · v${currentFactByKey.get(key)?.version}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] font-semibold text-fg-3">
                  {labels.factStatus}
                  <select className={`${fieldClass} mt-1`} name="factStatus">
                    <option value="active">{labels.factActive}</option>
                    <option value="retracted">{labels.factRetracted}</option>
                  </select>
                </label>
                <label className="text-[10px] font-semibold text-fg-3">
                  {labels.factValue}
                  <textarea
                    className={`${fieldClass} mt-1 min-h-16 resize-y`}
                    data-testid={testId("platform-ai-memory-fact-value")}
                    maxLength={10_000}
                    name="factValue"
                  />
                </label>
                <button
                  className={secondaryButtonClass}
                  data-testid={testId("platform-ai-memory-fact-save")}
                  disabled={inboundSourceMessages.length === 0}
                  type="submit"
                >
                  {labels.saveFact}
                </button>
              </form>
            </details>
          </div>

          <div
            className="mt-3 border-t border-border/70 pt-3"
            data-qualification-state={memory.qualification.status}
            data-qualification-version={memory.qualification.version}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.qualification}
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <p
                className="text-[10.5px] font-semibold text-fg-2"
                data-testid={testId("platform-ai-memory-qualification-current-state")}
              >
                {labels.qualificationLabels[memory.qualification.status]}
              </p>
              <span className="font-mono text-[10px] text-fg-3">
                {memory.qualification.completeness}%
              </span>
            </div>
            {memory.qualification.notes ? (
              <p className="mt-1 text-[10.5px] leading-4 text-fg-3">
                {memory.qualification.notes}
              </p>
            ) : null}

            <details className="mt-2">
              <summary className="cursor-pointer text-[10px] font-bold text-info">
                {labels.edit}
              </summary>
              <form
                action={recordPlatformAiQualificationAction}
                className="mt-2 grid gap-2"
                data-testid={testId("platform-ai-memory-qualification-form")}
              >
                <input type="hidden" name="conversationId" value={conversationId} />
                {sourceMessageSelect(
                  "platform-ai-memory-qualification-source",
                  memory.qualification.sourceMessageId,
                )}
                <select
                  className={fieldClass}
                  data-testid={testId("platform-ai-memory-qualification-state")}
                  defaultValue={memory.qualification.status}
                  name="qualificationStatus"
                >
                  {PLATFORM_AI_QUALIFICATION_STATES.map((state) => (
                    <option key={state} value={state}>
                      {labels.qualificationLabels[state]}
                    </option>
                  ))}
                </select>
                <label className="text-[10px] font-semibold text-fg-3">
                  {labels.completeness}
                  <input
                    className={`${fieldClass} mt-1`}
                    defaultValue={memory.qualification.completeness}
                    max={100}
                    min={0}
                    name="completeness"
                    required
                    type="number"
                  />
                </label>
                <label className="text-[10px] font-semibold text-fg-3">
                  {labels.missingFacts}
                  <select
                    className={`${fieldClass} mt-1 min-h-24`}
                    defaultValue={[...memory.qualification.missingFactKeys]}
                    multiple
                    name="missingFactKeys"
                  >
                    {PLATFORM_AI_FACT_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {labels.factLabels[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px] font-semibold text-fg-3">
                  {labels.notes}
                  <textarea
                    className={`${fieldClass} mt-1 min-h-16 resize-y`}
                    defaultValue={memory.qualification.notes ?? ""}
                    maxLength={2_000}
                    name="qualificationNotes"
                  />
                </label>
                <button
                  className={secondaryButtonClass}
                  data-testid={testId("platform-ai-memory-qualification-save")}
                  disabled={inboundSourceMessages.length === 0}
                  type="submit"
                >
                  {labels.saveQualification}
                </button>
              </form>
            </details>
          </div>

          <div className="mt-3 border-t border-border/70 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.control}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ["paused", labels.pause, "platform-ai-memory-control-pause"],
                  [
                    "staff_takeover",
                    labels.staffTakeover,
                    "platform-ai-memory-control-staff-takeover",
                  ],
                  [
                    "staff_only",
                    labels.returnStaffOnly,
                    "platform-ai-memory-control-staff-only",
                  ],
                ] as const
              ).map(([state, label, actionTestId]) => (
                <form action={setPlatformAiControlAction} key={state}>
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <input type="hidden" name="controlState" value={state} />
                  <button
                    className={secondaryButtonClass}
                    data-testid={testId(actionTestId)}
                    disabled={memory.control.state === state}
                    type="submit"
                  >
                    {label}
                  </button>
                </form>
              ))}
            </div>
          </div>

          <div className="mt-3 border-t border-border/70 pt-3">
            <div
              data-autonomous-authority="false"
              data-lexical-preview-degraded={String(
                capabilities.lexicalPreviewDegraded,
              )}
              data-provider-proof-state={capabilities.providerProofState}
              data-testid={testId("platform-ai-memory-capabilities")}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
                {labels.retrieval}
              </p>
              <p className="mt-1 text-[10.5px] leading-4 text-warn">
                {labels.lexicalDegraded} · {labels.providerBlocked}
              </p>
            </div>
            <form action={previewPlatformAiLexicalAction} className="mt-2">
              <input type="hidden" name="conversationId" value={conversationId} />
              <button
                className={secondaryButtonClass}
                data-testid={testId("platform-ai-memory-lexical-preview")}
                disabled={
                  inboundSourceMessages.length === 0 ||
                  !capabilities.lexicalPreviewEnabled
                }
                type="submit"
              >
                {labels.lexicalPreview}
              </button>
            </form>
            {inboundSourceMessages.length === 0 ? (
              <p className="mt-1 text-[10px] text-fg-3">
                {labels.latestInboundRequired}
              </p>
            ) : null}
            <div
              className="mt-2"
              data-autonomous-authority={String(
                evidence?.autonomousAuthority ?? false,
              )}
              data-provider-proof-state={
                evidence?.providerProofState ?? capabilities.providerProofState
              }
              data-retrieval-mode={evidence?.mode ?? "none"}
              data-retrieval-outcome={evidence?.outcome ?? "none"}
              data-testid={testId("platform-ai-memory-retrieval-evidence")}
            >
              {!evidence ? (
                <p className="text-[10.5px] text-fg-3">{labels.noEvidence}</p>
              ) : evidence.outcome === "no_match" ? (
                <p className="text-[10.5px] text-fg-3">{labels.noMatch}</p>
              ) : (
                <ol className="space-y-1.5">
                  {evidence.items.map((item) => (
                    <li
                      className="border-l border-info/30 pl-2 text-[10.5px] leading-4 text-fg-2"
                      data-evidence-ordinal={item.ordinal}
                      key={`${item.knowledgeKey}:${item.knowledgeVersion}:${item.ordinal}`}
                    >
                      {item.knowledgeTitle} · v{item.knowledgeVersion}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
