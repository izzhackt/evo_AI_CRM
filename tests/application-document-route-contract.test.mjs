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
