type CommandState = Readonly<{
  status: string;
  attemptId: string | null;
}>;

export type CanonicalAmoCrmCommandPanelResolution = Readonly<{
  activeUnknownSource: "reconcile" | "sync" | "persisted" | null;
  flowBlocked: boolean;
  showPersistedBlockingState: boolean;
  showSyncState: boolean;
}>;

export function resolveCanonicalAmoCrmCommandPanelState(input: Readonly<{
  blockingAttemptId: string | null;
  persistedBlockingStatus: string;
  reconcileState: CommandState;
  syncState: CommandState;
}>): CanonicalAmoCrmCommandPanelResolution {
  const reconciledAttemptId =
    input.reconcileState.status === "accepted" &&
    input.reconcileState.attemptId !== null
      ? input.reconcileState.attemptId
      : null;
  const syncUnknown =
    input.syncState.status === "unknown" &&
    input.syncState.attemptId !== reconciledAttemptId;
  const showPersistedBlockingState =
    input.blockingAttemptId !== null &&
    input.blockingAttemptId !== reconciledAttemptId;
  const persistedUnknown =
    showPersistedBlockingState && input.persistedBlockingStatus === "unknown";
  const reconcileUnknown = input.reconcileState.status === "unknown";

  return Object.freeze({
    activeUnknownSource: reconcileUnknown
      ? "reconcile"
      : syncUnknown
        ? "sync"
        : persistedUnknown
          ? "persisted"
          : null,
    flowBlocked:
      showPersistedBlockingState || syncUnknown || reconcileUnknown,
    showPersistedBlockingState,
    showSyncState: !(
      input.syncState.status === "unknown" &&
      input.syncState.attemptId === reconciledAttemptId &&
      reconciledAttemptId !== null
    ),
  });
}
