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

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      schema(name) {
        calls.push(["schema", name]);
        return {
          rpc(name, args) {
            calls.push(["rpc", name, args]);
            return Promise.resolve(responses.shift());
          },
        };
      },
    },
  };
}

// Existing technical adapter contracts, not proof of genuine staff execution.
// The RPC, not this DTO decoder, owns active role/bundle eligibility.
test("normalizer returns only the organization-bound eligible-owner DTO", () => {
  assert.deepEqual(
    normalizeStudentPortalCuratorOptions(
      {
        organization_id: ORGANIZATION_ID,
        owners: [{
          membership_id: CURATOR_MEMBERSHIP_ID,
          display_name: "  Assigned Curator  ",
        }],
      },
      ORGANIZATION_ID,
    ),
    [{
      membershipId: CURATOR_MEMBERSHIP_ID,
      displayName: "Assigned Curator",
    }],
  );
});

test("normalizer fails closed on invalid, cross-organization, and extra-field rows", () => {
  const snapshot = {
    organization_id: ORGANIZATION_ID,
    owners: [{ membership_id: CURATOR_MEMBERSHIP_ID, display_name: "Assigned Curator" }],
  };

  assert.throws(
    () => normalizeStudentPortalCuratorOptions({}, ORGANIZATION_ID),
    StudentPortalCuratorOptionsError,
  );
  assert.throws(
    () => normalizeStudentPortalCuratorOptions(
      { ...snapshot, organization_id: OTHER_ORGANIZATION_ID },
      ORGANIZATION_ID,
    ),
    StudentPortalCuratorOptionsError,
  );
  assert.throws(
    () => normalizeStudentPortalCuratorOptions(
      { ...snapshot, owners: [{ ...snapshot.owners[0], current_role: "sales" }] },
      ORGANIZATION_ID,
    ),
    StudentPortalCuratorOptionsError,
  );
});

test("repository binds the actor organization and returns normalized options", async () => {
  const fake = fakeClient([
    {
      data: {
        organization_id: ORGANIZATION_ID,
        owners: [{ membership_id: CURATOR_MEMBERSHIP_ID, display_name: "Assigned Curator" }],
      },
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
    fake.calls,
    [
      ["schema", "platform"],
      ["rpc", "staff_student_portal_curator_options", { p_organization_id: ORGANIZATION_ID }],
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
