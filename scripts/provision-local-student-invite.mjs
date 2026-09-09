import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

/** Seed only staff and pre-handoff business facts; never create/confirm a Student. */
export async function provisionLocalStudentInvite({ url, serviceKey, publishableKey, dbUrl }) {
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.equal(new URL(dbUrl).hostname, "127.0.0.1");
  const auth = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  const ids = Object.fromEntries(["organization", "scope", "client", "lead"].map((key) => [key, randomUUID()]));
  const identities = {};
  const studentEmail = `invite-${randomUUID()}@invite.local.test`;
  try {
    for (const role of ["admin", "sales", "curator"]) {
      const email = `${role}-${randomUUID()}@invite.local.test`;
      const password = `${randomUUID()}Aa1!`;
      const result = await auth.auth.admin.createUser({ email, password, email_confirm: true });
      assert.equal(result.error, null, `STAFF_${role.toUpperCase()}_AUTH_FAILED`);
      identities[role] = { email, password, userId: result.data.user.id, profileId: randomUUID(), membershipId: randomUUID() };
    }
    await sql.begin(async (tx) => {
      await tx`INSERT INTO platform.organizations(id,name) VALUES (${ids.organization},'Isolated Student Invite Proof')`;
      await tx`INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version)
        VALUES (${ids.scope},${ids.organization},'organization',${ids.organization},1)`;
      for (const [role, identity] of Object.entries(identities)) {
        const [bundle] = await tx`SELECT id FROM platform.role_bundle_versions WHERE role=${role} AND status='published' ORDER BY version DESC LIMIT 1`;
        assert.ok(bundle, `MISSING_${role.toUpperCase()}_BUNDLE`);
        await tx`INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version)
          VALUES (${identity.profileId},${identity.userId},${`Invite Proof ${role}`},'active',1)`;
        await tx`INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id)
          VALUES (${identity.membershipId},${ids.organization},${identity.profileId},'active',${role},${bundle.id})`;
        await tx`INSERT INTO platform.membership_scope_assignments(id,organization_id,membership_id,scope_id,scope_version,assignment_version,granted,actor_kind,actor_profile_id,reason,request_id)
          VALUES (${randomUUID()},${ids.organization},${identity.membershipId},${ids.scope},1,1,TRUE,'system',NULL,'Isolated staff fixture',${randomUUID()})`;
      }
      await tx`INSERT INTO platform.clients(id,organization_id,display_name,normalized_name,email,normalized_email)
        VALUES (${ids.client},${ids.organization},'Invite Proof Student','invite proof student',${studentEmail},${studentEmail})`;
      await tx`INSERT INTO platform.leads(id,organization_id,client_id,current_owner_membership_id,stage_key,source_key,lifecycle_state)
        VALUES (${ids.lead},${ids.organization},${ids.client},${identities.sales.membershipId},'qualified','synthetic_invite_proof','open')`;
      // Input facts for normal handoff, not a claim about real payments/contracts.
      await tx`UPDATE platform.lead_admissions_gates SET contract_confirmed=TRUE,
        contract_confirmed_by_membership_id=${identities.admin.membershipId},contract_confirmed_by_profile_id=${identities.admin.profileId},
        contract_confirmed_at=statement_timestamp(),contract_evidence_reference='synthetic:invite-contract',
        first_payment_amount=100,first_payment_currency='USD',first_payment_due_date=CURRENT_DATE,first_payment_received_date=CURRENT_DATE,
        first_payment_confirmed_by_membership_id=${identities.admin.membershipId},first_payment_confirmed_by_profile_id=${identities.admin.profileId},
        first_payment_confirmed_at=statement_timestamp(),first_payment_evidence_reference='synthetic:invite-payment',gate_state='satisfied',gate_version=2
        WHERE organization_id=${ids.organization} AND lead_id=${ids.lead}`;
    });
    // Real Auth token and normal domain command create the case and its tasks.
    const actor = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await actor.auth.signInWithPassword(identities.admin);
    assert.equal(signed.error, null, "ADMIN_LOGIN_FAILED");
    const handed = await actor.schema("platform").rpc("handoff_lead_to_admissions", {
      p_lead_id: ids.lead, p_expected_gate_version: 2,
      p_admissions_owner_membership_id: identities.curator.membershipId,
      p_handoff_mode: "normal", p_reason: "Isolated normal Student invitation proof", p_request_id: randomUUID(),
    });
    if (handed.error) throw new Error(`NORMAL_HANDOFF_FAILED:${handed.error.code}`);
    assert.ok(handed.data?.case_id, "NORMAL_HANDOFF_NO_CASE");
    const [before] = await sql`SELECT student_membership_id,portal_activated_at FROM platform.student_cases WHERE id=${handed.data.case_id}`;
    assert.equal(before.student_membership_id, null);
    assert.equal(before.portal_activated_at, null);
    const [noStudent] = await sql`SELECT count(*)::int AS count FROM auth.users WHERE email=${studentEmail}`;
    assert.equal(noStudent.count, 0, "STUDENT_MUST_NOT_BE_PRECREATED");
    await actor.auth.signOut();
    return { organizationId: ids.organization, caseId: handed.data.case_id, leadId: ids.lead,
      adminEmail: identities.admin.email, adminPassword: identities.admin.password, studentEmail,
      studentPassword: `${randomUUID()}Aa1!`, handoffTaskCount: handed.data.starter_task_count };
  } finally {
    await sql.end();
  }
}
