"use client";

import { useState, type FormEvent } from "react";

import {
  approvePlatformAmoCrmMappingAction,
  revokePlatformAmoCrmMappingAction,
} from "@/lib/platform-amocrm-approval-actions";
import {
  btnCls,
  btnDangerGhostCls,
  btnGhostCls,
  inputCls,
  labelCls,
} from "@/components/ui";

type Labels = Readonly<Record<string, string>>;

type UiMappingBinding = Readonly<{ bindingKey: string; fieldId: string }>;
type UiSelectedBindings = Readonly<{
  pipelineId: string;
  signedContractStatusId: string;
  leadCustomFields: readonly UiMappingBinding[];
  contactCustomFields: readonly UiMappingBinding[];
}>;
type UiMappingState = "not_approved" | "approved_configured_unverified";
type UiMappingStateForConversation = Readonly<{
  mappingState: UiMappingState;
}>;
type UiMappingApprovalWorkspace = Readonly<{
  conversationId: string;
  amocrmAccountId: string;
  mappingState: UiMappingState;
  reviewDiscovery: Readonly<{
    discoveryVersionId: string;
    version: number;
    accountDomain: string;
    evidenceKind: "local_non_provider" | "provider_observed";
    discoveredAt: string;
    sanitizedSnapshot: Readonly<{
      pipelines: readonly Readonly<{
        id: string;
        name: string;
        statuses: readonly Readonly<{ id: string; name: string }>[];
      }>[];
      lead_custom_fields: readonly Readonly<{
        id: string;
        name: string;
        code: string | null;
      }>[];
      contact_custom_fields: readonly Readonly<{
        id: string;
        name: string;
        code: string | null;
      }>[];
    }>;
  }> | null;
  latestDecision: Readonly<{
    eventId: string;
    eventKind: "approved" | "revoked";
    discoveryVersionId: string;
    selectedBindings: UiSelectedBindings;
    createdAt: string;
  }> | null;
}>;

export type PlatformAmoCrmMappingUiWorkspace =
  | Readonly<{ kind: "account_unlinked" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{
      kind: "staff";
      state: UiMappingStateForConversation;
    }>
  | Readonly<{
      kind: "admin";
      workspace: UiMappingApprovalWorkspace;
    }>;

type BindingRow = Readonly<{
  key: number;
  bindingKey: string;
  fieldId: string;
}>;

function addRequestId(event: FormEvent<HTMLFormElement>) {
  const input = event.currentTarget.elements.namedItem("request_id");
  if (input instanceof HTMLInputElement && input.value === "") {
    input.value = globalThis.crypto.randomUUID();
  }
}

function initialBindingRows(
  bindings: readonly UiMappingBinding[],
  validFieldIds: ReadonlySet<string>,
): BindingRow[] {
  const valid = bindings.filter((binding) => validFieldIds.has(binding.fieldId));
  const source = valid.length > 0
    ? valid
    : [{ bindingKey: "", fieldId: [...validFieldIds][0] ?? "" }];
  return source.map((binding, index) => ({ ...binding, key: index + 1 }));
}

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

function MappingStatus({
  state,
  labels,
}: {
  state:
    | "account_unlinked"
    | "discovery_missing"
    | "not_approved"
    | "approved_configured_unverified"
    | "unavailable";
  labels: Labels;
}) {
  const approved = state === "approved_configured_unverified";
  const label = approved
    ? labels.platformAmoMappingConfiguredUnverified
    : state === "account_unlinked"
      ? labels.platformAmoMappingAccountUnlinked
      : state === "discovery_missing"
        ? labels.platformAmoMappingDiscoveryMissing
        : state === "not_approved"
          ? labels.platformAmoMappingNotApproved
          : labels.platformAmoMappingUnavailable;
  return (
    <div
      aria-live="polite"
      className={`rounded-ctl border px-3 py-2 ${
        approved
          ? "border-warn/30 bg-warn-weak text-warn"
          : "border-danger/30 bg-danger-weak text-danger"
      }`}
      data-testid="platform-amocrm-mapping-status"
    >
      <p className="text-[11px] font-bold">{label}</p>
      <p className="mt-0.5 text-[10px] leading-4 opacity-80">
        {approved
          ? labels.platformAmoMappingConfiguredUnverifiedHint
          : labels.platformAmoMappingBlockedHint}
      </p>
    </div>
  );
}

function BindingEditor({
  entity,
  rows,
  setRows,
  fields,
  labels,
}: {
  entity: "lead" | "contact";
  rows: readonly BindingRow[];
  setRows: (rows: BindingRow[]) => void;
  fields: readonly Readonly<{
    id: string;
    name: string;
    code: string | null;
  }>[];
  labels: Labels;
}) {
  const entityLabel = entity === "lead"
    ? labels.platformAmoMappingLeadBindings
    : labels.platformAmoMappingContactBindings;
  const nextKey = rows.reduce((maximum, row) => Math.max(maximum, row.key), 0) + 1;
  return (
    <fieldset className="rounded-ctl border border-border bg-surface-2 p-3">
      <legend className="px-1 text-[11px] font-bold text-fg">{entityLabel}</legend>
      <p className="text-[10px] leading-4 text-fg-3">
        {labels.platformAmoMappingBindingHint}
      </p>
      <div className="mt-2 space-y-2">
        {rows.map((row, index) => {
          const keyId = `${entity}-binding-key-${row.key}`;
          const fieldId = `${entity}-field-id-${row.key}`;
          return (
            <div
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"
              key={row.key}
            >
              <div>
                <label className={labelCls} htmlFor={keyId}>
                  {labels.platformAmoMappingBindingKey}
                </label>
                <input
                  className={inputCls}
                  id={keyId}
                  name={`${entity}_binding_key`}
                  pattern="[a-z][a-z0-9_.-]{0,63}"
                  required
                  value={row.bindingKey}
                  onChange={(event) =>
                    setRows(rows.map((candidate) =>
                      candidate.key === row.key
                        ? { ...candidate, bindingKey: event.target.value }
                        : candidate
                    ))
                  }
                />
              </div>
              <div>
                <label className={labelCls} htmlFor={fieldId}>
                  {labels.platformAmoMappingProviderField}
                </label>
                <select
                  className={inputCls}
                  id={fieldId}
                  name={`${entity}_field_id`}
                  required
                  value={row.fieldId}
                  onChange={(event) =>
                    setRows(rows.map((candidate) =>
                      candidate.key === row.key
                        ? { ...candidate, fieldId: event.target.value }
                        : candidate
                    ))
                  }
                >
                  {fields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}{field.code ? ` · ${field.code}` : ""} · #{field.id}
                    </option>
                  ))}
                </select>
              </div>
              <button
                aria-label={`${labels.platformAmoMappingRemoveBinding}: ${entityLabel} ${index + 1}`}
                className={`${btnGhostCls} self-end`}
                disabled={rows.length === 1}
                type="button"
                onClick={() => setRows(rows.filter((candidate) => candidate.key !== row.key))}
              >
                {labels.platformAmoMappingRemoveBinding}
              </button>
            </div>
          );
        })}
      </div>
      <button
        className={`${btnGhostCls} mt-2`}
        disabled={rows.length >= 100 || fields.length === 0}
        type="button"
        onClick={() =>
          setRows([
            ...rows,
            { key: nextKey, bindingKey: "", fieldId: fields[0]?.id ?? "" },
          ])
        }
      >
        {labels.platformAmoMappingAddBinding}
      </button>
    </fieldset>
  );
}

function AdminMappingWorkspace({
  workspace,
  labels,
  locale,
}: {
  workspace: UiMappingApprovalWorkspace;
  labels: Labels;
  locale: string;
}) {
  const discovery = workspace.reviewDiscovery;
  const current = workspace.latestDecision;
  const currentAppliesToReview = Boolean(
    discovery && current?.discoveryVersionId === discovery.discoveryVersionId,
  );
  const snapshot = discovery?.sanitizedSnapshot ?? null;
  const preferredSelection = currentAppliesToReview ? current?.selectedBindings : null;
  const initialPipeline =
    snapshot?.pipelines.find(
      (pipeline) => pipeline.id === preferredSelection?.pipelineId,
    ) ?? snapshot?.pipelines[0] ?? null;
  const [pipelineId, setPipelineId] = useState(initialPipeline?.id ?? "");
  const statuses =
    snapshot?.pipelines.find((pipeline) => pipeline.id === pipelineId)?.statuses ?? [];
  const preferredStatusId = statuses.some(
    (status) => status.id === preferredSelection?.signedContractStatusId,
  )
    ? preferredSelection?.signedContractStatusId ?? ""
    : statuses[0]?.id ?? "";
  const [statusId, setStatusId] = useState(preferredStatusId);
  const leadFieldIds = new Set(
    snapshot?.lead_custom_fields.map((field) => field.id) ?? [],
  );
  const contactFieldIds = new Set(
    snapshot?.contact_custom_fields.map((field) => field.id) ?? [],
  );
  const [leadBindings, setLeadBindings] = useState(() =>
    initialBindingRows(
      preferredSelection?.leadCustomFields ?? [],
      leadFieldIds,
    )
  );
  const [contactBindings, setContactBindings] = useState(() =>
    initialBindingRows(
      preferredSelection?.contactCustomFields ?? [],
      contactFieldIds,
    )
  );

  if (!discovery || !snapshot) {
    return <MappingStatus state="discovery_missing" labels={labels} />;
  }

  const canApprove =
    snapshot.pipelines.length > 0 &&
    statuses.length > 0 &&
    snapshot.lead_custom_fields.length > 0 &&
    snapshot.contact_custom_fields.length > 0;
  return (
    <div className="space-y-3" data-testid="platform-amocrm-admin-workspace">
      <MappingStatus state={workspace.mappingState} labels={labels} />
      <dl className="grid gap-2 rounded-ctl border border-border bg-surface-2 p-3 text-[10.5px] sm:grid-cols-2">
        <div>
          <dt className="font-bold text-fg-3">{labels.platformAmoMappingAccount}</dt>
          <dd className="mt-0.5 break-words font-semibold text-fg">
            {discovery.accountDomain} · #{workspace.amocrmAccountId}
          </dd>
        </div>
        <div>
          <dt className="font-bold text-fg-3">{labels.platformAmoMappingDiscoveryVersion}</dt>
          <dd className="mt-0.5 font-semibold text-fg">
            v{discovery.version} · {formatTimestamp(discovery.discoveredAt, locale)}
          </dd>
        </div>
        <div>
          <dt className="font-bold text-fg-3">{labels.platformAmoMappingDiscoveryEvidence}</dt>
          <dd className="mt-0.5 font-semibold text-fg">
            {discovery.evidenceKind === "provider_observed"
              ? labels.platformAmoMappingDiscoveryProviderObserved
              : labels.platformAmoMappingDiscoveryLocalOnly}
          </dd>
        </div>
        <div>
          <dt className="font-bold text-fg-3">{labels.platformAmoMappingLatestDecision}</dt>
          <dd className="mt-0.5 font-semibold text-fg">
            {current
              ? `${current.eventKind === "approved" ? labels.platformAmoMappingApprovedEvent : labels.platformAmoMappingRevokedEvent} · ${formatTimestamp(current.createdAt, locale)}`
              : labels.platformAmoMappingNoDecision}
          </dd>
        </div>
      </dl>

      <form
        action={approvePlatformAmoCrmMappingAction}
        className="space-y-3 rounded-ctl border border-border bg-surface p-3"
        data-testid="platform-amocrm-approve-form"
        onSubmit={addRequestId}
      >
        <input type="hidden" name="conversation_id" value={workspace.conversationId} />
        <input
          type="hidden"
          name="discovery_version_id"
          value={discovery.discoveryVersionId}
        />
        <input
          type="hidden"
          name="expected_prior_event_id"
          value={current?.eventId ?? ""}
        />
        <input
          type="hidden"
          name="responsible_user_source"
          value="lead.responsible_user_id"
        />
        <input
          type="hidden"
          name="request_id"
          defaultValue=""
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="amocrm-mapping-pipeline">
              {labels.platformAmoMappingPipeline}
            </label>
            <select
              className={inputCls}
              id="amocrm-mapping-pipeline"
              name="pipeline_id"
              required
              value={pipelineId}
              onChange={(event) => {
                const nextPipelineId = event.target.value;
                setPipelineId(nextPipelineId);
                const nextStatuses = snapshot.pipelines.find(
                  (pipeline) => pipeline.id === nextPipelineId,
                )?.statuses ?? [];
                setStatusId(nextStatuses[0]?.id ?? "");
              }}
            >
              {snapshot.pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name} · #{pipeline.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="amocrm-mapping-contract-status">
              {labels.platformAmoMappingSignedContractStatus}
            </label>
            <select
              className={inputCls}
              id="amocrm-mapping-contract-status"
              name="signed_contract_status_id"
              required
              value={statusId}
              onChange={(event) => setStatusId(event.target.value)}
            >
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name} · #{status.id}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="rounded-ctl border border-border bg-surface-2 px-3 py-2 text-[10.5px] text-fg-2">
          <span className="font-bold">{labels.platformAmoMappingResponsibleSource}:</span>{" "}
          <code>lead.responsible_user_id</code>
        </div>
        <BindingEditor
          entity="lead"
          rows={leadBindings}
          setRows={setLeadBindings}
          fields={snapshot.lead_custom_fields}
          labels={labels}
        />
        <BindingEditor
          entity="contact"
          rows={contactBindings}
          setRows={setContactBindings}
          fields={snapshot.contact_custom_fields}
          labels={labels}
        />
        <div>
          <label className={labelCls} htmlFor="amocrm-mapping-reason">
            {labels.platformAmoMappingReason}
          </label>
          <textarea
            className={`${inputCls} min-h-20 resize-y`}
            id="amocrm-mapping-reason"
            maxLength={1000}
            name="reason"
            required
          />
        </div>
        {!canApprove && (
          <p className="text-[10.5px] leading-4 text-danger">
            {labels.platformAmoMappingIncompleteDiscovery}
          </p>
        )}
        <button className={btnCls} disabled={!canApprove} type="submit">
          {current?.eventKind === "approved"
            ? labels.platformAmoMappingSupersede
            : labels.platformAmoMappingApprove}
        </button>
      </form>

      {workspace.mappingState === "approved_configured_unverified" &&
        current?.eventKind === "approved" && (
          <form
            action={revokePlatformAmoCrmMappingAction}
            className="rounded-ctl border border-danger/20 bg-danger-weak p-3"
            data-testid="platform-amocrm-revoke-form"
            onSubmit={addRequestId}
          >
            <input type="hidden" name="conversation_id" value={workspace.conversationId} />
            <input type="hidden" name="expected_prior_event_id" value={current.eventId} />
            <input
              type="hidden"
              name="request_id"
              defaultValue=""
            />
            <label className={labelCls} htmlFor="amocrm-mapping-revoke-reason">
              {labels.platformAmoMappingRevokeReason}
            </label>
            <textarea
              className={`${inputCls} min-h-16 resize-y`}
              id="amocrm-mapping-revoke-reason"
              maxLength={1000}
              name="reason"
              required
            />
            <button className={`${btnDangerGhostCls} mt-2`} type="submit">
              {labels.platformAmoMappingRevoke}
            </button>
          </form>
        )}
    </div>
  );
}

export function PlatformAmoCrmMappingPanel({
  workspace,
  labels,
  locale,
}: {
  workspace: PlatformAmoCrmMappingUiWorkspace;
  labels: Labels;
  locale: string;
}) {
  const renderedState = workspace.kind === "account_unlinked"
    ? "account_unlinked"
    : workspace.kind === "unavailable"
      ? "unavailable"
      : workspace.kind === "admin" && workspace.workspace.reviewDiscovery === null
        ? "discovery_missing"
        : workspace.kind === "admin"
          ? workspace.workspace.mappingState
          : workspace.state.mappingState;
  return (
    <section
      className="mt-2 rounded-ctl border border-border bg-surface p-3"
      data-mapping-state={renderedState}
      data-provider-proof="not-proved"
      data-testid="platform-amocrm-mapping"
    >
      <div>
        <h3 className="text-[11px] font-bold text-fg">
          {labels.platformAmoMappingTitle}
        </h3>
        <p className="mt-0.5 text-[10px] leading-4 text-fg-3">
          {labels.platformAmoMappingHint}
        </p>
      </div>
      <div className="mt-2">
        {workspace.kind === "admin" ? (
          <AdminMappingWorkspace
            key={`${workspace.workspace.reviewDiscovery?.discoveryVersionId ?? "none"}:${workspace.workspace.latestDecision?.eventId ?? "none"}`}
            workspace={workspace.workspace}
            labels={labels}
            locale={locale}
          />
        ) : (
          <MappingStatus
            state={workspace.kind === "staff" ? workspace.state.mappingState : workspace.kind}
            labels={labels}
          />
        )}
      </div>
    </section>
  );
}
