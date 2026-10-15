/**
 * Fixed answer time for the public recovery form.
 *
 * Whether the work (staff lookup, then the Auth call that sends the email only
 * for a real account) takes 0.3 s or 3 s depends on the account, so a minimum
 * wait alone is only a floor: once the real work outlasts it, the answer time
 * separates known from unknown addresses. Here the work runs to completion in
 * the background and the answer leaves at one fixed moment either way. If the
 * work has not finished by then, the neutral `pending` answer is used.
 */

export type RecoveryAnswerClock = Readonly<{
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}>;

const REAL_CLOCK: RecoveryAnswerClock = Object.freeze({
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
});

/**
 * Resolves exactly `deadlineMs` after `startedAt`, with the result of `work`
 * if it finished by then and `pending` otherwise. `work` keeps running after
 * a missed deadline; it must not reject (the caller turns failures into a
 * value), because a rejection before the deadline would end the wait early.
 */
export async function answerAtFixedDeadline<T>(
  input: Readonly<{
    work: Promise<T>;
    startedAt: number;
    deadlineMs: number;
    pending: T;
    clock?: RecoveryAnswerClock;
  }>,
): Promise<T> {
  const clock = input.clock ?? REAL_CLOCK;
  const deadline = clock.sleep(Math.max(0, input.startedAt + input.deadlineMs - clock.now()));
  const first = await Promise.race([
    input.work.then((value) => ({ finished: true as const, value })),
    deadline.then(() => ({ finished: false as const })),
  ]);
  // A result that arrives early is held back: the answer time must not
  // depend on how long the work took.
  await deadline;
  return first.finished ? first.value : input.pending;
}
