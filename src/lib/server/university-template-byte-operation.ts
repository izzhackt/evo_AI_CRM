import "server-only";

export type RetainUniversityTemplateByteWork = <T>(task: Promise<T>) => Promise<T>;
export class UniversityTemplateByteOperationError extends Error {
  readonly status = 503;
  readonly code = "unavailable";
  constructor() { super("unavailable"); }
}
let activeByteOperations = 0;

/** One existing admission limit shared by template ingress, preview and export. */
export async function withUniversityTemplateByteOperation<T>(work: (retain: RetainUniversityTemplateByteWork) => Promise<T>): Promise<T> {
  if (activeByteOperations >= 1) throw new UniversityTemplateByteOperationError();
  activeByteOperations++;
  const pending = new Set<Promise<unknown>>();
  const retain: RetainUniversityTemplateByteWork = task => {
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  try { return await work(retain); }
  finally {
    // Cancellation is not settlement. This continuation only releases admission;
    // it never starts a parser, upload or database operation in the background.
    if (pending.size) void Promise.allSettled([...pending]).then(() => { activeByteOperations--; });
    else activeByteOperations--;
  }
}
