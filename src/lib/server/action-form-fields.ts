import "server-only";

const ACTION_STATE_FIELD_PREFIX = "_1_";
const ACTION_METADATA_PATTERN =
  /^\$ACTION_(?:KEY|(?:REF|ID)_[A-Za-z0-9]+|[A-Za-z0-9]+:[A-Za-z0-9]+)$/;

function isActionMetadataField(key: string): boolean {
  return ACTION_METADATA_PATTERN.test(key);
}

/**
 * Extracts one exact set of user fields from either a direct FormData call or
 * the envelope React 19 creates for a `useActionState` server action.
 * Framework metadata is ignored, but duplicate or unknown user fields fail
 * closed.
 */
export function exactActionStringFields(
  form: FormData,
  expectedKeys: readonly string[],
): Map<string, string> | null {
  const entries = [...form.entries()];
  const expected = new Set(expectedKeys);
  const usesActionStateEnvelope = entries.some(([key]) =>
    key.startsWith(ACTION_STATE_FIELD_PREFIX),
  );
  const fields = new Map<string, string>();
  const rawKeys = new Set<string>();
  let sawActionMetadata = false;
  let sawStateSlot = false;

  for (const [rawKey, value] of entries) {
    if (rawKeys.has(rawKey)) return null;
    rawKeys.add(rawKey);

    if (usesActionStateEnvelope && rawKey === "0") {
      if (sawStateSlot || typeof value !== "string") return null;
      sawStateSlot = true;
      continue;
    }

    let key = rawKey;
    if (usesActionStateEnvelope) {
      if (!rawKey.startsWith(ACTION_STATE_FIELD_PREFIX)) return null;
      key = rawKey.slice(ACTION_STATE_FIELD_PREFIX.length);
    } else if (/^\d+$/.test(rawKey)) {
      return null;
    }

    if (isActionMetadataField(key)) {
      if (typeof value !== "string") return null;
      sawActionMetadata = true;
      continue;
    }
    if (!expected.has(key) || typeof value !== "string" || fields.has(key)) {
      return null;
    }
    fields.set(key, value);
  }

  if (
    usesActionStateEnvelope &&
    (!sawActionMetadata || !sawStateSlot)
  ) {
    return null;
  }
  return fields.size === expectedKeys.length ? fields : null;
}
