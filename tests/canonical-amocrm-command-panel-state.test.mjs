import assert from "node:assert/strict";
import test from "node:test";

import { resolveCanonicalAmoCrmCommandPanelState } from "../src/lib/canonical-amocrm-command-panel-state.ts";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

test("accepted reconciliation clears the matching stale client and persisted blocker", () => {
  const resolved = resolveCanonicalAmoCrmCommandPanelState({
    blockingAttemptId: ATTEMPT_ID,
    persistedBlockingStatus: "unknown",
    syncState: { status: "unknown", attemptId: ATTEMPT_ID },
    reconcileState: { status: "accepted", attemptId: ATTEMPT_ID },
  });

  assert.deepEqual(resolved, {
    activeUnknownSource: null,
    flowBlocked: false,
    showPersistedBlockingState: false,
    showSyncState: false,
  });
});

test("accepted reconciliation never clears a different unresolved attempt", () => {
  const resolved = resolveCanonicalAmoCrmCommandPanelState({
    blockingAttemptId: "22222222-2222-4222-8222-222222222222",
    persistedBlockingStatus: "unknown",
    syncState: { status: "unknown", attemptId: ATTEMPT_ID },
    reconcileState: {
      status: "accepted",
      attemptId: "33333333-3333-4333-8333-333333333333",
    },
  });

  assert.deepEqual(resolved, {
    activeUnknownSource: "sync",
    flowBlocked: true,
    showPersistedBlockingState: true,
    showSyncState: true,
  });
});

test("an unresolved reconciliation result remains the highest-priority blocker", () => {
  const resolved = resolveCanonicalAmoCrmCommandPanelState({
    blockingAttemptId: ATTEMPT_ID,
    persistedBlockingStatus: "unknown",
    syncState: { status: "idle", attemptId: null },
    reconcileState: { status: "unknown", attemptId: ATTEMPT_ID },
  });

  assert.equal(resolved.activeUnknownSource, "reconcile");
  assert.equal(resolved.flowBlocked, true);
});
