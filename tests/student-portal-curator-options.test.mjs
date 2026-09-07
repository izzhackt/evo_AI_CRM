import assert from "node:assert/strict";
import test from "node:test";

const {
  listStudentPortalActiveCurators,
  normalizeStudentPortalCuratorOptions,
  StudentPortalCuratorOptionsError,
} = await import("../src/lib/server/student-portal-curator-options.ts");

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000002";
const CURATOR_MEMBERSHIP_ID = "20000000-0000-4000-8000-000000000001";
const CURATOR_PROFILE_ID = "30000000-0000-4000-8000-000000000001";

function actor(platformRole = "admin") {
  return {
    authUserId: "40000000-0000-4000-8000-000000000001",
    profileId: "50000000-0000-4000-8000-000000000001",
    membershipId: "60000000-0000-4000-8000-000000000001",
    organizationId: ORGANIZATION_ID,
    displayName: "Admin",
    email: "admin@example.com",
    platformRole,
    authorityRole: platformRole,
    platformAccessVersion: 1,
    platformBundleId: "70000000-0000-4000-8000-000000000001",
    platformBundleVersion: 1,
  };
}

function thenableQuery(response, calls, table) {
  const query = {
    select(columns) {
      calls.push([table, "select", columns]);
      return query;
    },
    eq(column, value) {
      calls.push([table, "eq", column, value]);
      return query;
    },
    in(column, values) {
      calls.push([table, "in", column, values]);
      return query;
    },
    then(resolve, reject) {
      return Promise.resolve(response).then(resolve, reject);
    },
  };
  return query;
}

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      schema(name) {
        calls.push(["schema", name]);
        return {
          from(table) {
            calls.push(["from", table]);
            return thenableQuery(responses.shift(), calls, table);
          },
        };
      },
    },
  };
}

test("normalizer returns only exact active same-organization Curators", () => {
  assert.deepEqual(
    normalizeStudentPortalCuratorOptions(
      [{
        id: CURATOR_MEMBERSHIP_ID,
        organization_id: ORGANIZATION_ID,
        profile_id: CURATOR_PROFILE_ID,
        status: "active",
        current_role: "curator",
      }],
      [{
        id: CURATOR_PROFILE_ID,
        display_name: "  Assigned Curator  ",
        status: "active",
      }],
      ORGANIZATION_ID,
    ),
    [{
      membershipId: CURATOR_MEMBERSHIP_ID,
      displayName: "Assigned Curator",
    }],
  );
});

test("normalizer fails closed on invalid, cross-organization, and wrong-role rows", () => {
  const profileRows = [{
    id: CURATOR_PROFILE_ID,
    display_name: "Assigned Curator",
    status: "active",
  }];
  const membership = {
    id: CURATOR_MEMBERSHIP_ID,
    organization_id: ORGANIZATION_ID,
    profile_id: CURATOR_PROFILE_ID,
    status: "active",
    current_role: "curator",
  };

  assert.throws(
    () => normalizeStudentPortalCuratorOptions({}, profileRows, ORGANIZATION_ID),
    StudentPortalCuratorOptionsError,
  );
  assert.throws(
    () => normalizeStudentPortalCuratorOptions(
      [{ ...membership, organization_id: OTHER_ORGANIZATION_ID }],
      profileRows,
      ORGANIZATION_ID,
    ),
    StudentPortalCuratorOptionsError,
  );
  assert.throws(
    () => normalizeStudentPortalCuratorOptions(
      [{ ...membership, current_role: "sales" }],
      profileRows,
      ORGANIZATION_ID,
    ),
    StudentPortalCuratorOptionsError,
  );
});

test("repository binds the actor organization and returns normalized options", async () => {
  const fake = fakeClient([
    {
      data: [{
        id: CURATOR_MEMBERSHIP_ID,
        organization_id: ORGANIZATION_ID,
        profile_id: CURATOR_PROFILE_ID,
        status: "active",
        current_role: "curator",
      }],
      error: null,
    },
    {
      data: [{
        id: CURATOR_PROFILE_ID,
        display_name: "Assigned Curator",
        status: "active",
      }],
      error: null,
    },
  ]);

  assert.deepEqual(
    await listStudentPortalActiveCurators(actor(), { client: fake.client }),
    [{
      membershipId: CURATOR_MEMBERSHIP_ID,
      displayName: "Assigned Curator",
    }],
  );
  assert.deepEqual(
    fake.calls.filter((call) => call[0] === "organization_memberships"),
    [
      [
        "organization_memberships",
        "select",
        "id,organization_id,profile_id,status,current_role",
      ],
      ["organization_memberships", "eq", "organization_id", ORGANIZATION_ID],
      ["organization_memberships", "eq", "status", "active"],
      ["organization_memberships", "eq", "current_role", "curator"],
    ],
  );
});

test("repository rejects non-Admin authority before any database access", async () => {
  const fake = fakeClient([]);
  await assert.rejects(
    () => listStudentPortalActiveCurators(actor("sales"), { client: fake.client }),
    StudentPortalCuratorOptionsError,
  );
  assert.deepEqual(fake.calls, []);
});
