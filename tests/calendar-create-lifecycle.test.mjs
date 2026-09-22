import assert from "node:assert/strict";
import test from "node:test";

import {
  canEditCalendarCreate,
  canResumeCalendarCreate,
  nextCalendarCreateAttempt,
} from "../src/components/v3/calendar/create-lifecycle.ts";

// Pure UI state transitions, not Auth/RPC or successful-save evidence.
const ready = {
  recovery: { baselineToken: "before-refresh", refreshRequested: true },
  renderToken: "fresh-authorized-render",
  actionPending: false,
  refreshPending: false,
  navigationPending: false,
  allowed: true,
  caseId: "selected-case",
  candidateCaseId: "selected-case",
  candidateRenderToken: "fresh-authorized-render",
  candidatesReady: true,
  eligibleAssignee: true,
};

test("a fresh authorized render plus exact ready candidates permits manual continuation", () => {
  assert.equal(canResumeCalendarCreate(ready), true);
});

test("stale detection alone does not authorize a retry", () => {
  assert.equal(canResumeCalendarCreate({ ...ready, recovery: null }), false);
  assert.equal(canResumeCalendarCreate({
    ...ready, recovery: { ...ready.recovery, refreshRequested: false },
  }), false);
});

test("refresh click or ended pending with the old server props stays locked", () => {
  assert.equal(canResumeCalendarCreate({
    ...ready, renderToken: ready.recovery.baselineToken,
    candidateRenderToken: ready.recovery.baselineToken,
  }), false);
});

test("action, refresh and navigation each keep the fresh form locked until settled", () => {
  for (const flag of ["actionPending", "refreshPending", "navigationPending"]) {
    assert.equal(canResumeCalendarCreate({ ...ready, [flag]: true }), false, flag);
  }
});

test("late candidates for the prior case or render cannot unlock the current draft", () => {
  assert.equal(canResumeCalendarCreate({ ...ready, candidateCaseId: "previous-case" }), false);
  assert.equal(canResumeCalendarCreate({ ...ready, candidateRenderToken: "before-refresh" }), false);
  assert.equal(canResumeCalendarCreate({ ...ready, renderToken: "another-render" }), false);
});

test("unavailable candidates, changed permission or removed assignee stay blocked", () => {
  for (const flag of ["allowed", "candidatesReady", "eligibleAssignee"]) {
    assert.equal(canResumeCalendarCreate({ ...ready, [flag]: false }), false, flag);
  }
  assert.equal(canResumeCalendarCreate({ ...ready, caseId: "", candidateCaseId: "" }), false);
});

test("fresh candidates allow repairing a removed assignee while submit remains blocked", () => {
  const removedAssignee = { ...ready, eligibleAssignee: false };
  assert.equal(canEditCalendarCreate(removedAssignee), true);
  assert.equal(canResumeCalendarCreate(removedAssignee), false);
  assert.equal(canResumeCalendarCreate({ ...removedAssignee, eligibleAssignee: true }), true);
  assert.equal(canEditCalendarCreate({ ...removedAssignee, candidatesReady: false }), false);
});

test("only confirmed saved state can offer a new attempt with the returned identity", () => {
  const returnedId = "8465715b-58d9-4b0d-a7f4-a14b2e5b4f1f";
  assert.equal(nextCalendarCreateAttempt("saved", returnedId, false), returnedId);
  assert.equal(nextCalendarCreateAttempt("saved", returnedId, true), null);
  for (const status of ["idle", "invalid", "forbidden", "stale", "request_conflict", "unavailable"]) {
    assert.equal(nextCalendarCreateAttempt(status, returnedId, false), null, status);
  }
});
