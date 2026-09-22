import assert from "node:assert/strict";
import test from "node:test";
import { isConnectedPlatformApi, isConnectedPlatformPage, isConnectedStudentPortalApi, isConnectedStudentPortalPage } from "../src/lib/platform-route-contract.ts";

test("program document transport is reachable only in its intended route audience", () => {
  for (const [suffix, method] of [["uploads", "POST"], ["downloads", "GET"]]) {
    const student = `/api/portal/application-document-${suffix}`;
    const staff = `/api/v3/application-document-${suffix}`;
    assert.equal(isConnectedStudentPortalApi(student, method), true);
    for (const wrong of ["GET", "POST", "PUT", "DELETE"].filter(value => value !== method)) {
      assert.equal(isConnectedStudentPortalApi(student, wrong), false);
    }
    assert.equal(isConnectedPlatformApi(student), false);
    assert.equal(isConnectedPlatformApi(staff), true);
    assert.equal(isConnectedStudentPortalApi(staff, method), false);
    assert.equal(isConnectedPlatformApi(`${staff}/extra`), false);
    assert.equal(isConnectedStudentPortalApi(`${student}/extra`, method), false);
  }
});

test("exact review notification details use a bounded Student page route", () => {
  const route = "/portal/document-notifications/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  assert.equal(isConnectedStudentPortalPage(route), true);
  assert.equal(isConnectedPlatformPage(route), true);
  for (const bad of ["/portal/document-notifications", "/portal/document-notifications/not-an-id", `${route}/extra`]) {
    assert.equal(isConnectedStudentPortalPage(bad), false);
    assert.equal(isConnectedPlatformPage(bad), false);
  }
});

test("package notification detail connects only the exact UUID Student route", () => {
  const base = "/portal/package-notifications";
  const uuid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  for (const path of [`${base}/${uuid}`, `${base}/${uuid.toUpperCase()}`]) {
    assert.equal(isConnectedStudentPortalPage(path), true, path);
    assert.equal(isConnectedPlatformPage(path), true, path);
    assert.equal(isConnectedStudentPortalApi(path, "GET"), false, path);
    assert.equal(isConnectedPlatformApi(path), false, path);
  }
  for (const path of [base, `${base}/not-an-id`, `${base}/${uuid}/extra`, `${base}/${uuid}/`,
    `${base}/eeeeeeee-eeee-0eee-8eee-eeeeeeeeeeee`, `${base}/eeeeeeee-eeee-9eee-8eee-eeeeeeeeeeee`,
    `${base}/eeeeeeee-eeee-4eee-7eee-eeeeeeeeeeee`, `${base}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeeg`,
    `/unexpected${base}/${uuid}`]) {
    assert.equal(isConnectedStudentPortalPage(path), false, path);
    assert.equal(isConnectedPlatformPage(path), false, path);
  }
});

test("detached package recovery is an exact Student page without a portal wildcard", () => {
  const path = "/portal/package-recovery";
  assert.equal(isConnectedStudentPortalPage(path), true);
  assert.equal(isConnectedPlatformPage(path), true);
  for (const method of ["GET", "POST"]) assert.equal(isConnectedStudentPortalApi(path, method), false);
  assert.equal(isConnectedPlatformApi(path), false);
  for (const bad of [`${path}/extra`, `${path}/`, "/portal/package-recovery-other", "/portal/not-implemented"]) {
    assert.equal(isConnectedStudentPortalPage(bad), false, bad);
    assert.equal(isConnectedPlatformPage(bad), false, bad);
  }
});
