import type {
  PlatformActivePromptArtifacts,
  PlatformPinnedPromptArtifacts,
  PlatformPromptArtifactMetadata,
} from "@/lib/platform-bw4-workflow";

type Labels = Readonly<Record<string, string>>;

function formatTimestamp(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const language =
    locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU";
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function PromptArtifact({
  artifact,
  kindLabel,
  testId,
  pinned = false,
  labels,
}: {
  artifact: PlatformPromptArtifactMetadata | null;
  kindLabel: string;
  testId: string;
  pinned?: boolean;
  labels: Labels;
}) {
  if (artifact === null || (!pinned && artifact.status !== "approved")) {
    return (
      <div
        className="rounded-ctl border border-warn/30 bg-warn-weak p-3 text-warn"
        data-artifact-state="unavailable"
        data-testid={testId}
      >
        <p className="text-[11px] font-bold">{kindLabel}</p>
        <p className="mt-1 text-[10.5px] leading-4">
          {labels.platformPromptUnavailable}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-ctl border p-3 ${
        pinned
          ? "border-info/30 bg-info-weak text-info"
          : "border-ok/30 bg-ok-weak text-ok"
      }`}
      data-artifact-state={pinned ? "pinned" : "approved"}
      data-artifact-kind={artifact.artifactKind}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.04em] opacity-80">
            {kindLabel}
          </p>
          <p className="mt-1 break-words text-[11px] font-bold">
            {artifact.title}
          </p>
        </div>
        <span className="rounded-full bg-surface/70 px-2 py-0.5 text-[9.5px] font-semibold">
          {pinned
            ? labels.platformPromptPinnedSnapshot
            : labels.platformPromptApproved}
        </span>
      </div>
      <dl className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr]">
        <dt className="text-[10px] opacity-80">
          {labels.platformPromptVersion}
        </dt>
        <dd className="break-words font-mono text-[10px]">{artifact.version}</dd>
        <dt className="text-[10px] opacity-80">
          {labels.platformPromptSha}
        </dt>
        <dd className="break-all font-mono text-[9.5px]">
          {artifact.contentSha256}
        </dd>
      </dl>
    </div>
  );
}

export function PlatformPromptEvidenceCard({
  activeArtifacts,
  pinnedArtifacts,
  locale,
  labels,
}: {
  activeArtifacts: PlatformActivePromptArtifacts;
  pinnedArtifacts: PlatformPinnedPromptArtifacts | null;
  locale: string;
  labels: Labels;
}) {
  return (
    <section
      aria-labelledby="platform-prompt-evidence-title"
      className="rounded-ctl border border-border bg-surface-2 p-3"
      data-testid="platform-prompt-evidence"
    >
      <h3
        id="platform-prompt-evidence-title"
        className="text-[11px] font-bold text-fg"
      >
        {labels.platformPromptEvidenceTitle}
      </h3>
      <p className="mt-1 text-[10.5px] leading-4 text-fg-3">
        {labels.platformPromptEvidenceHint}
      </p>

      <h4 className="mt-3 text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
        {labels.platformPromptActiveArtifacts}
      </h4>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <PromptArtifact
          artifact={activeArtifacts.promptPolicy}
          kindLabel={labels.platformPromptPolicy}
          testId="platform-active-prompt-policy"
          labels={labels}
        />
        <PromptArtifact
          artifact={activeArtifacts.businessContext}
          kindLabel={labels.platformBusinessContext}
          testId="platform-active-business-context"
          labels={labels}
        />
      </div>

      {pinnedArtifacts !== null && (
        <div className="mt-3" data-testid="platform-pinned-prompt-evidence">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3">
              {labels.platformPromptPinnedArtifacts}
            </h4>
            <p className="text-[9.5px] text-fg-3">
              {labels.platformPromptPinnedAt}: {" "}
              {formatTimestamp(pinnedArtifacts.selectedAt, locale)}
            </p>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <PromptArtifact
              artifact={pinnedArtifacts.promptPolicy}
              kindLabel={labels.platformPromptPolicy}
              testId="platform-pinned-prompt-policy"
              pinned
              labels={labels}
            />
            <PromptArtifact
              artifact={pinnedArtifacts.businessContext}
              kindLabel={labels.platformBusinessContext}
              testId="platform-pinned-business-context"
              pinned
              labels={labels}
            />
          </div>
        </div>
      )}

      <p className="mt-2 text-[9.5px] leading-4 text-fg-3">
        {labels.platformPromptRawHidden}
      </p>
    </section>
  );
}
