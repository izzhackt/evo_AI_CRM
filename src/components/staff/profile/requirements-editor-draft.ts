import type {
  ApplicationRequirementsEditorContext as Context,
  ApplicationRequirementsEditorItem as Item,
  ApplicationRequirementsEditorPayload as Payload,
  ApplicationRequirementsEditorSource as Source,
} from "../../../lib/portal/application-requirements-editor.ts";
import { parseApplicationRequirementsEditorPayload } from "../../../lib/portal/application-requirements-editor.ts";

export type RequirementsDraftItem = Omit<Item, "material"> & { material: Item["material"] | null };
export type RequirementsDraftDecision = { sourceKey: string; disposition: "included" | "excluded" | null; requirementKey: string | null; reason: string | null };
export type RequirementsDraft = { items: RequirementsDraftItem[]; sourceDecisions: RequirementsDraftDecision[]; changeReason: string };
export type DraftProblem = { target: string; message: string };

export function editorMaterial(context: Context, slotId: string): Item["material"] | null {
  const slot = context.candidates.find(candidate => candidate.documentSlotId === slotId);
  return slot ? { kind: "existing", documentSlotId: slot.documentSlotId, expectedSlotVersion: slot.slotVersion,
    expectedCurrentVersionId: slot.currentVersionId, expectedCurrentVersionNo: slot.currentVersionNo } : null;
}
export function newRequirementsDraftItem(key: string): RequirementsDraftItem {
  return { requirementKey: key, required: true, label: "", groupLabel: "", instructions: "", deadline: null,
    material: null, provenance: { kind: "staff_entry", sourceKey: null, basis: "" } };
}
export function initialRequirementsDraft(context: Context): RequirementsDraft {
  const items = context.requirements.items.map(item => {
    const source = context.sources.find(source => source.kind === "prior" && source.reference.requirementKey === item.requirementKey);
    return { requirementKey: item.requirementKey, required: item.required, label: item.label, groupLabel: item.groupLabel,
      instructions: item.instructions, deadline: item.deadline, material: editorMaterial(context, item.documentSlotId),
      provenance: source?.kind === "prior" && source.reference.typedStarterEligible
        ? { kind: "typed_starter" as const, sourceKey: source.sourceKey, basis: "Стартовое требование EVO из предыдущего списка" }
        : { kind: "staff_entry" as const, sourceKey: null, basis: "Сохранена связь документа из предыдущего списка" } };
  });
  return { items, changeReason: "", sourceDecisions: context.sources.map(source => ({ sourceKey: source.sourceKey,
    disposition: source.kind === "prior" ? "included" : null,
    requirementKey: source.kind === "prior" ? source.reference.requirementKey : null, reason: null })) };
}
export function draftFromPayload(payload: Payload): RequirementsDraft {
  return structuredClone({ items: payload.items, sourceDecisions: payload.sourceDecisions, changeReason: payload.changeReason }) as RequirementsDraft;
}
export function sourceCanUseItem(source: Source, item: RequirementsDraftItem, context: Context): boolean {
  if (source.kind === "prior") return source.reference.requirementKey === item.requirementKey;
  if (item.material?.kind !== "existing" || source.documentSlotId !== item.material.documentSlotId) return false;
  if (source.kind === "country") {
    const candidate = context.candidates.find(candidate => candidate.documentSlotId === source.documentSlotId);
    return candidate?.sourceRequirement?.requirementId === source.reference.requirementId;
  }
  return true;
}
export function draftProblems(context: Context, draft: RequirementsDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (draft.items.length < 1 || draft.items.length > 100) problems.push({ target: "items", message: "Добавьте от 1 до 100 требований." });
  const usedSlots = new Set<string>();
  for (const item of draft.items) {
    const target = `item-${item.requirementKey}`;
    for (const [name, label, max] of [["label", "Название", 500], ["groupLabel", "Группа", 200], ["instructions", "Инструкция", 4000]] as const) {
      if (!item[name].trim() || [...item[name]].length > max) problems.push({ target, message: `${label}: заполните поле (до ${max} символов).` });
    }
    if (!item.provenance.basis.trim()) problems.push({ target, message: "Укажите, почему этот документ подходит к требованию." });
    if (!item.material) problems.push({ target, message: "Выберите документ дела или создайте отдельный пустой документ." });
    else if (item.material.kind === "existing") {
      const slotId = item.material.documentSlotId;
      if (!context.candidates.some(slot => slot.documentSlotId === slotId)) problems.push({ target, message: "Этот документ больше недоступен для выбора. Выберите материал заново." });
      if (usedSlots.has(item.material.documentSlotId)) problems.push({ target, message: "Один документ выбран для двух пунктов. Каждый пункт должен иметь отдельный материал." });
      usedSlots.add(item.material.documentSlotId);
    } else if (!item.material.label.trim() || !item.material.groupLabel.trim()) problems.push({ target, message: "Заполните название и группу нового документа." });
  }
  for (const source of context.sources) {
    const decision = draft.sourceDecisions.find(decision => decision.sourceKey === source.sourceKey);
    const item = draft.items.find(item => item.requirementKey === decision?.requirementKey);
    const target = `source-${source.sourceKey}`;
    if (!decision?.disposition) problems.push({ target, message: "Укажите, как учесть прежний источник." });
    else if (decision.disposition === "excluded") {
      if (source.mustRetain) problems.push({ target, message: "Этот документ выбран в настройках заявки. Измените их отдельно перед исключением." });
      if (!decision.reason?.trim()) problems.push({ target, message: "Укажите причину исключения прежнего источника." });
    } else if (!item || !sourceCanUseItem(source, item, context)) problems.push({ target, message: "Источник должен соответствовать выбранному пункту и его документу." });
    else if (source.required && !item.required && !decision.reason?.trim()) problems.push({ target, message: "Укажите причину изменения обязательности." });
  }
  if (!draft.changeReason.trim()) problems.push({ target: "reason", message: "Укажите основание подтверждения или изменения списка." });
  return problems;
}
export function buildRequirementsPayload(context: Context, draft: RequirementsDraft): Payload | null {
  if (draftProblems(context, draft).length) return null;
  return parseApplicationRequirementsEditorPayload({ expectedContextHash: context.contextHash,
    expectedApplicationVersion: context.applicationVersion, expectedRevisionId: context.requirements.revisionId,
    expectedRevisionVersion: context.requirements.revisionVersion, changeReason: draft.changeReason,
    items: draft.items, sourceDecisions: draft.sourceDecisions });
}

const fields = ["required", "label", "groupLabel", "instructions", "deadline", "material", "provenance"] as const;
type MergeField = (typeof fields)[number];
export type RequirementsRebaseChoices = Record<string, "local" | "current">;
export type RequirementsRebaseConflict = { id: string; label: string; local: string; current: string; restoredAsNew: boolean };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(",")}}`;
  return JSON.stringify(value);
}
function equal(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
function meaning(item: RequirementsDraftItem, field: MergeField): unknown {
  if (field === "material" && item.material?.kind === "existing") return { kind: "existing", documentSlotId: item.material.documentSlotId };
  if (field === "provenance" && item.provenance.kind === "typed_starter") return { kind: "typed_starter", basis: item.provenance.basis };
  return item[field];
}
function sameItem(a: RequirementsDraftItem, b: RequirementsDraftItem) { return fields.every(field => equal(meaning(a, field), meaning(b, field))); }
export function requirementsDraftMatchesPayload(draft: RequirementsDraft, payload: Payload): boolean {
  return equal(draft, draftFromPayload(payload));
}
const fieldNames: Record<MergeField, string> = { required: "обязательность", label: "название", groupLabel: "группа", instructions: "инструкция", deadline: "срок", material: "документ", provenance: "основание соответствия" };
function describe(item: RequirementsDraftItem, field: MergeField, context: Context): string {
  if (field === "required") return item.required ? "Обязательный" : "Необязательный";
  if (field === "material") {
    const material = item.material;
    return material?.kind === "existing" ? context.candidates.find(slot => slot.documentSlotId === material.documentSlotId)?.label ?? "Документ недоступен" : material?.kind === "new" ? `Новый документ: ${material.label}` : "Документ не выбран";
  }
  if (field === "provenance") return item.provenance.basis;
  if (field === "deadline") return item.deadline ? [item.deadline.date, item.deadline.time, item.deadline.timezone, item.deadline.sourceUrl, item.deadline.verifiedOn].filter(Boolean).join(" · ") : "Не указан";
  return String(item[field]);
}
export function requirementsRebaseConflicts(previous: Context, fresh: Context, draft: RequirementsDraft): RequirementsRebaseConflict[] {
  const before = initialRequirementsDraft(previous).items, current = initialRequirementsDraft(fresh).items;
  const conflicts: RequirementsRebaseConflict[] = [];
  for (const old of before) {
    const local = draft.items.find(item => item.requirementKey === old.requirementKey);
    const remote = current.find(item => item.requirementKey === old.requirementKey);
    if (!local && remote && !sameItem(old, remote)) conflicts.push({ id: `${old.requirementKey}:presence`, label: old.label, local: "Убрать пункт", current: `Оставить актуальный пункт: ${remote.label}`, restoredAsNew: false });
    else if (local && !remote && !sameItem(old, local)) conflicts.push({ id: `${old.requirementKey}:presence`, label: old.label, local: `Создать новый пункт из моего текста: ${local.label}`, current: "Пункт уже убран из актуального списка", restoredAsNew: true });
    else if (local && remote) for (const field of fields) {
      const original = meaning(old, field), mine = meaning(local, field), theirs = meaning(remote, field);
      if (!equal(original, mine) && !equal(original, theirs) && !equal(mine, theirs)) conflicts.push({ id: `${old.requirementKey}:${field}`, label: `${local.label}: ${fieldNames[field]}`, local: describe(local, field, previous), current: describe(remote, field, fresh), restoredAsNew: false });
    }
  }
  // A simultaneous reorder needs an explicit choice; independent new rows are appended.
  const shared = before.map(item => item.requirementKey).filter(key => draft.items.some(item => item.requirementKey === key) && current.some(item => item.requirementKey === key));
  const order = (items: RequirementsDraftItem[]) => items.filter(item => shared.includes(item.requirementKey)).map(item => item.requirementKey);
  const addedLocally = draft.items.some(item => !before.some(old => old.requirementKey === item.requirementKey));
  if ((!equal(order(before), order(draft.items)) || addedLocally) && !equal(order(before), order(current)) && !equal(order(draft.items), order(current))) conflicts.push({ id: "order", label: "Порядок требований", local: "Оставить мой порядок", current: "Использовать актуальный порядок", restoredAsNew: false });
  return conflicts;
}

/** Explicit three-way reconciliation: never replace user edits or concurrent untouched fields silently. */
export function rebaseRequirementsDraft(previous: Context, fresh: Context, draft: RequirementsDraft, choices: RequirementsRebaseChoices = {}): RequirementsDraft {
  const conflicts = requirementsRebaseConflicts(previous, fresh, draft);
  if (conflicts.some(conflict => !choices[conflict.id])) throw new Error("Resolve requirement conflicts before changing the base");
  const before = initialRequirementsDraft(previous).items, current = initialRequirementsDraft(fresh).items;
  const merged = new Map<string, RequirementsDraftItem>();
  for (const remote of current) {
    const old = before.find(item => item.requirementKey === remote.requirementKey);
    const local = draft.items.find(item => item.requirementKey === remote.requirementKey);
    if (!old) { merged.set(remote.requirementKey, remote); continue; }
    if (!local) { if (choices[`${remote.requirementKey}:presence`] === "current") merged.set(remote.requirementKey, remote); continue; }
    let item = { ...local };
    for (const field of fields) {
      const useCurrent = equal(meaning(local, field), meaning(old, field)) || choices[`${local.requirementKey}:${field}`] === "current";
      if (useCurrent) item = { ...item, [field]: remote[field] };
    }
    merged.set(item.requirementKey, item);
  }
  for (const local of draft.items) {
    if (current.some(item => item.requirementKey === local.requirementKey)) continue;
    const old = before.find(item => item.requirementKey === local.requirementKey);
    if (!old) merged.set(local.requirementKey, local);
    else if (choices[`${local.requirementKey}:presence`] === "local") {
      const restored = { ...local, requirementKey: `r.${crypto.randomUUID()}`, provenance: { kind: "staff_entry" as const, sourceKey: null, basis: "" } };
      merged.set(restored.requirementKey, restored);
    }
  }
  const priorOrder = before.map(item => item.requirementKey);
  const localOrder = draft.items.filter(item => priorOrder.includes(item.requirementKey)).map(item => item.requirementKey);
  const localReordered = !equal(localOrder, priorOrder.filter(key => localOrder.includes(key)));
  const primary = choices.order === "local" ? draft.items : choices.order === "current" || !localReordered ? current : draft.items;
  const secondary = primary === current ? draft.items : current;
  const keys = primary.map(item => item.requirementKey).filter(key => merged.has(key));
  // Place added rows beside their chosen surviving anchors, never just append them.
  for (let index = 0; index < secondary.length; index++) {
    const key = secondary[index].requirementKey;
    if (!merged.has(key) || keys.includes(key)) continue;
    const next = secondary.slice(index + 1).find(item => keys.includes(item.requirementKey));
    const previous = secondary.slice(0, index).reverse().find(item => keys.includes(item.requirementKey));
    const crossed = next && previous && keys.indexOf(previous.requirementKey) > keys.indexOf(next.requirementKey);
    const at = crossed ? keys.indexOf(previous.requirementKey) + 1 : next ? keys.indexOf(next.requirementKey) : previous ? keys.indexOf(previous.requirementKey) + 1 : keys.length;
    keys.splice(at, 0, key);
  }
  for (const key of merged.keys()) if (!keys.includes(key)) keys.push(key);
  const items = keys.flatMap(key => merged.has(key) ? [merged.get(key)!] : []).map(item => {
    const material = item.material?.kind === "existing" ? editorMaterial(fresh, item.material.documentSlotId) ?? item.material : item.material;
    let provenance = item.provenance;
    if (provenance.kind === "typed_starter") {
      const source = fresh.sources.find(source => source.kind === "prior" && source.reference.requirementKey === item.requirementKey && source.reference.typedStarterEligible);
      const remote = current.find(remote => remote.requirementKey === item.requirementKey);
      const unchanged = remote && fields.filter(field => field !== "provenance").every(field => equal(meaning(item, field), meaning(remote, field)));
      provenance = source && unchanged ? { ...provenance, sourceKey: source.sourceKey } : { kind: "staff_entry", sourceKey: null, basis: "" };
    } else if (provenance.sourceKey && !fresh.sources.some(source => source.sourceKey === provenance.sourceKey)) provenance = { kind: "staff_entry", sourceKey: null, basis: "" };
    return { ...item, material, provenance };
  });
  return { ...draft, items, sourceDecisions: fresh.sources.map(source => {
    const old = previous.sources.find(old => old.sourceKey === source.sourceKey);
    const decision = draft.sourceDecisions.find(decision => decision.sourceKey === source.sourceKey);
    return decision && equal(old, source) ? decision : { sourceKey: source.sourceKey, disposition: null, requirementKey: null, reason: null };
  }) };
}

export function requirementChanges(context: Context, draft: RequirementsDraft): string[] {
  const changes: string[] = [];
  const oldItems = context.requirements.items;
  for (const [index, item] of draft.items.entries()) {
    const old = oldItems.find(old => old.requirementKey === item.requirementKey);
    const title = item.label || "Новый пункт";
    if (!old) { changes.push(`Добавлено: ${title}`); continue; }
    const fields: string[] = [];
    if (old.position !== index + 1) fields.push("порядок");
    if (old.required !== item.required) fields.push("обязательность");
    if (old.label !== item.label || old.groupLabel !== item.groupLabel || old.instructions !== item.instructions) fields.push("текст");
    if (JSON.stringify(old.deadline) !== JSON.stringify(item.deadline)) fields.push("срок");
    if (item.material?.kind !== "existing" || item.material.documentSlotId !== old.documentSlotId) fields.push("документ");
    if (fields.length) changes.push(`${title}: ${fields.join(", ")}`);
  }
  for (const old of oldItems) if (!draft.items.some(item => item.requirementKey === old.requirementKey)) changes.push(`Убрано: ${old.label}`);
  return changes;
}
export function contextChanges(previous: Context, fresh: Context): string[] {
  const changes = requirementChanges(previous, initialRequirementsDraft(fresh));
  if (previous.applicationVersion !== fresh.applicationVersion) changes.push("Изменились настройки заявки.");
  if (JSON.stringify(previous.legacyApplication) !== JSON.stringify(fresh.legacyApplication)) changes.push("Изменились прежние требования или исключения заявки.");
  for (const source of fresh.sources) {
    const old = previous.sources.find(old => old.sourceKey === source.sourceKey);
    if (JSON.stringify(old) !== JSON.stringify(source)) changes.push(`Источник изменился: ${source.label ?? source.sourceKey}`);
  }
  for (const old of previous.sources) if (!fresh.sources.some(source => source.sourceKey === old.sourceKey)) changes.push(`Источник убран: ${old.label ?? old.sourceKey}`);
  for (const candidate of fresh.candidates) {
    const old = previous.candidates.find(old => old.documentSlotId === candidate.documentSlotId);
    if (JSON.stringify(old) !== JSON.stringify(candidate)) changes.push(`Документ изменился: ${candidate.label}`);
  }
  for (const old of previous.candidates) if (!fresh.candidates.some(candidate => candidate.documentSlotId === old.documentSlotId)) changes.push(`Документ недоступен: ${old.label}`);
  if (!fresh.canSave) changes.push("Сохранение для текущего состояния или прав недоступно.");
  return changes.length ? changes : ["Состав не изменился; обновились сведения, на которых основано сохранение."];
}
