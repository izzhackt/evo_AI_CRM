import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const BUCKET = "platform-documents";

/**
 * Synthetic data for the mobile-route proof, added to the organization the student-invite fixture already made:
 * students with an Auth account, student membership, login (340), optionally a case with a contract file in Storage,
 * and one personal registration link (341) made through the real staff command. Nothing here is production data.
 */
export async function provisionLocalMobileRouteFixture({ url, serviceKey, publishableKey, dbUrl }) {
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.equal(new URL(dbUrl).hostname, "127.0.0.1");
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  try {
    // Own organization and staff (the invite fixture's handoff step is stale at this revision and not needed here).
    const organizationId = randomUUID();
    const orgScopeId = randomUUID();
    const staffIdentities = {};
    for (const role of ["admin", "sales", "curator"]) {
      const email = `${role}-${randomUUID()}@mobile.local.test`;
      const password = `${randomUUID()}Aa1!`;
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
      assert.equal(created.error, null, `STAFF_${role.toUpperCase()}_AUTH_FAILED`);
      staffIdentities[role] = { email, password, authUserId: created.data.user.id, profileId: randomUUID(), membershipId: randomUUID() };
    }
    await sql.begin(async (tx) => {
      await tx`INSERT INTO platform.organizations(id,name) VALUES (${organizationId},'Isolated Mobile Routes Proof')`;
      await tx`INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version) VALUES (${orgScopeId},${organizationId},'organization',${organizationId},1)`;
      for (const [role, identity] of Object.entries(staffIdentities)) {
        const [bundle] = await tx`SELECT id FROM platform.role_bundle_versions WHERE role=${role} AND status='published' ORDER BY version DESC LIMIT 1`;
        assert.ok(bundle, `MISSING_${role.toUpperCase()}_BUNDLE`);
        await tx`INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version) VALUES (${identity.profileId},${identity.authUserId},${`Mobile Proof ${role}`},'active',1)`;
        await tx`INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id,is_system_admin)
          VALUES (${identity.membershipId},${organizationId},${identity.profileId},'active',${role},${bundle.id},${role === "admin"})`;
        await tx`INSERT INTO platform.membership_scope_assignments(id,organization_id,membership_id,scope_id,scope_version,assignment_version,granted,actor_kind,actor_profile_id,reason,request_id)
          VALUES (${randomUUID()},${organizationId},${identity.membershipId},${orgScopeId},1,1,TRUE,'system',NULL,'Isolated staff fixture',${randomUUID()})`;
      }
    });
    const memberships = Object.fromEntries(Object.entries(staffIdentities).map(([role, i]) => [role, { id: i.membershipId, auth_user_id: i.authUserId }]));
    const orgScope = { id: orgScopeId };
    const [studentBundle] = await sql`SELECT id FROM platform.role_bundle_versions WHERE role='student' AND status='published' ORDER BY version DESC LIMIT 1`;
    assert.ok(studentBundle, "STUDENT_BUNDLE_MISSING");

    const makeStudent = async (key, { withCase, temporary = false, loginBase }) => {
      const email = `${key}-${randomUUID()}@mobile.local.test`;
      const password = `${randomUUID()}Aa1!`;
      const created = await service.auth.admin.createUser({
        email, password, email_confirm: true,
        ...(temporary ? { app_metadata: { evo_temporary_password: true } } : {}),
      });
      assert.equal(created.error, null, `STUDENT_${key}_AUTH_FAILED`);
      const authUserId = created.data.user.id;
      const ids = { profile: randomUUID(), membership: randomUUID(), caseId: randomUUID(), caseScope: randomUUID(), file: randomUUID() };
      await sql.begin(async (tx) => {
        await tx`INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version) VALUES (${ids.profile},${authUserId},${`Mobile ${key}`},'active',1)`;
        await tx`INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id,is_system_admin)
          VALUES (${ids.membership},${organizationId},${ids.profile},'active','student',${studentBundle.id},FALSE)`;
        await tx`INSERT INTO platform.membership_scope_assignments(id,organization_id,membership_id,scope_id,scope_version,assignment_version,granted,actor_kind,actor_profile_id,reason,request_id)
          VALUES (${randomUUID()},${organizationId},${ids.membership},${orgScope.id},1,1,TRUE,'system',NULL,'Mobile proof student organization scope',${randomUUID()})`;
        if (withCase) {
          await tx`INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version) VALUES (${ids.caseScope},${organizationId},'student_case',${ids.caseId},1)`;
          await tx`INSERT INTO platform.membership_scope_assignments(id,organization_id,membership_id,scope_id,scope_version,assignment_version,granted,actor_kind,actor_profile_id,reason,request_id)
            VALUES (${randomUUID()},${organizationId},${ids.membership},${ids.caseScope},1,1,TRUE,'system',NULL,'Mobile proof student case scope',${randomUUID()})`;
          // Migration 126 constrains runtime creation to pending cases; this fixture models an already finalized handoff.
          await tx`SET LOCAL session_replication_role = replica`;
          await tx`INSERT INTO platform.student_cases(id,organization_id,student_membership_id,responsible_sales_membership_id,current_curator_membership_id,
            source_key,contract_confirmation_ref,contract_confirmed_at,student_display_name,target_country,target_degree,program_direction,intake,
            route_approval_status,operational_stage,state,handoff_at,portal_activated_at,closed_at,next_action,current_scope_id,current_scope_version)
            VALUES (${ids.caseId},${organizationId},${ids.membership},${memberships.sales.id},${memberships.curator.id},${`synthetic:mobile:case:${key}`},${`synthetic:mobile:contract:${key}`},
            '2026-09-01T08:00:00Z',${`Mobile ${key}`},'United Kingdom','Bachelor','Computer Science','2027 Fall','approved','documents','active',
            '2026-09-01T09:00:00Z','2026-09-01T09:00:00Z',NULL,'Synthetic',${ids.caseScope},1)`;
          await tx`SET LOCAL session_replication_role = origin`;
        }
      });
      let login = null;
      if (loginBase) {
        const claimed = await service.schema("platform").rpc("claim_student_login_v1", { p_auth_user_id: authUserId, p_base: loginBase });
        assert.equal(claimed.error, null, "LOGIN_CLAIM_FAILED");
        login = claimed.data;
      }
      let file = null;
      if (withCase) {
        const bytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(randomUUID())]);
        const objectName = `case-contracts/${organizationId}/${ids.caseId}/${randomUUID()}`;
        const uploaded = await service.storage.from(BUCKET).upload(objectName, bytes, { contentType: "application/pdf", upsert: false });
        assert.equal(uploaded.error, null, `STORAGE_UPLOAD_FAILED:${uploaded.error?.message}`);
        const sha = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
        await sql`INSERT INTO platform.case_contract_files(id,organization_id,student_case_id,original_filename,declared_mime_type,byte_size,sha256_hex,storage_object_name,uploaded_by_membership_id)
          VALUES (${ids.file},${organizationId},${ids.caseId},'contract.pdf','application/pdf',${bytes.byteLength},${sha},${objectName},${memberships.curator.id})`;
        file = { id: ids.file, bytes };
      }
      return { key, email, password, authUserId, login, caseId: withCase ? ids.caseId : null, file };
    };

    const students = {
      main: await makeStudent("main", { withCase: true, loginBase: "mobile.alpha" }),
      other: await makeStudent("other", { withCase: true, loginBase: "mobile.beta" }),
      pwd: await makeStudent("pwd", { withCase: false, loginBase: "mobile.gamma" }),
      temp: await makeStudent("temp", { withCase: false, temporary: true, loginBase: "mobile.delta" }),
    };

    // A staff command mints the personal registration link (341); the plain token is shown once, only its hash is stored.
    const { createHash, randomBytes } = await import("node:crypto");
    const salesAuth = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await salesAuth.auth.signInWithPassword({ email: staffIdentities.admin.email, password: staffIdentities.admin.password });
    assert.equal(signed.error, null, "ADMIN_LOGIN_FAILED");
    const clientId = randomUUID();
    const leadId = randomUUID();
    const registrantEmail = `reg-${randomUUID()}@mobile.local.test`;
    await sql.begin(async (tx) => {
      await tx`INSERT INTO platform.clients(id,organization_id,display_name,normalized_name,email,normalized_email)
        VALUES (${clientId},${organizationId},'Mobile Registrant','mobile registrant',${registrantEmail},${registrantEmail})`;
      await tx`INSERT INTO platform.leads(id,organization_id,client_id,current_owner_membership_id,stage_key,source_key,lifecycle_state)
        VALUES (${leadId},${organizationId},${clientId},${memberships.sales.id},'qualified','synthetic_mobile_proof','open')`;
    });
    const token = randomBytes(24).toString("base64url");
    const hash = createHash("sha256").update(token, "utf8").digest("hex");
    const link = await salesAuth.schema("platform").rpc("create_student_registration_link_v1", { p_organization_id: organizationId, p_lead_id: leadId, p_token_hash: hash });
    assert.equal(link.error, null, `REGISTRATION_LINK_FAILED:${link.error?.code}:${link.error?.message}`);
    await salesAuth.auth.signOut();

    return { students, registration: { token, email: registrantEmail }, organizationId, admin: { email: staffIdentities.admin.email, password: staffIdentities.admin.password } };
  } finally {
    await sql.end();
  }
}
