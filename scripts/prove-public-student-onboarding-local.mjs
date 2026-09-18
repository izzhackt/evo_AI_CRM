import {createClient} from '@supabase/supabase-js';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
// Scope-local real Auth/RPC proof. Requires explicit owner-authorized isolated QA.
// No staff creation, password reset, migration execution, database reset or provider call.
const dir = process.env.EVO_LOCAL_QA_DIR;
if (!dir || !process.argv.includes('--allow-local-qa-student')) throw new Error('Explicit isolated Student QA authorization and private artifact directory required.');
const cfg = JSON.parse(readFileSync(dir + '/qa-config.json', 'utf8'));
for (const endpoint of [cfg.url, cfg.mailpit]) {
  const url = new URL(endpoint);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'loopback_only');
}
assert.match(cfg.dbContainer, /^supabase_db_evo-[a-z0-9-]+$/);
assert.equal(execFileSync('orb', ['status'], {encoding:'utf8'}).trim(), 'Running');
assert.equal(execFileSync('docker', ['context', 'show'], {encoding:'utf8'}).trim(), 'orbstack');
try { readFileSync(dir + '/student-credentials.json'); throw new Error('QA directory already has a Student; reuse recorded evidence or choose an explicitly authorized fresh run.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const saved=(file,data)=>writeFileSync(dir+'/'+file,JSON.stringify(data,null,2),{mode:0o600});
const db=(q)=>JSON.parse(execFileSync('docker',['exec',cfg.dbContainer,'psql','-U','postgres','-d','postgres','-X','-Atc',q],{encoding:'utf8'}).trim());
const client=()=>createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const checks=[];const pass=(s)=>{checks.push(s);console.log('PASS '+s);saved('receipt.json',{scope:'local existing Supabase and real Auth; not production SMTP or customer acceptance',checks})};
async function mail(email){for(let i=0;i<20;i++){const list=await(await fetch(cfg.mailpit+'/api/v1/messages')).json();const m=list.messages.find(m=>m.To?.some(t=>t.Address===email));if(m){const details=await(await fetch(cfg.mailpit+'/api/v1/message/'+m.ID)).json();return details;}await new Promise(r=>setTimeout(r,500));}throw new Error('MAIL_NOT_RECEIVED');}
function hash(m){const html=m.HTML||m.Text||'';const link=html.match(/https?:[^\s"<>]*token(?:_hash)?=[^\s"<>]+/);assert.ok(link,'mail_has_confirmation_link');const u=new URL(link[0].replaceAll('&amp;','&'));return u.searchParams.get('token_hash')||u.searchParams.get('token');}
const rawRpc=async(c,n,args)=>c.schema('platform').rpc(n,args);
async function rpc(c,n,args){let r=await rawRpc(c,n,args);if(r.error){console.error('RPC_ERROR',n,r.error.code,r.error.message);throw new Error('RPC_FAILED_'+n);}return r.data;}
async function otp(role){const staff=db(`SELECT row_to_json(x) FROM (SELECT u.email,m.id AS membership_id,m.organization_id FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id JOIN auth.users u ON u.id=p.auth_user_id WHERE m.current_role='${role}' AND m.status='active' LIMIT 1)x`);const c=client();const r=await c.auth.signInWithOtp({email:staff.email,options:{shouldCreateUser:false}});assert.equal(r.error,null,'existing_staff_otp_requested');const m=await mail(staff.email);const v=await c.auth.verifyOtp({token_hash:hash(m),type:'magiclink'});assert.equal(v.error,null,'existing_staff_otp_verified');saved(role+'-session.json',{...staff,session:v.data.session});return{c,staff};}
const ledger=db("SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations");assert.deepEqual(ledger,Array.from({length:177},(_,i)=>String(i+1).padStart(3,'0')),'canonical_ledger_through_177_required');
const admin=await otp('admin');pass('existing_admin_auth_otp_without_staff_creation');
const sales=await otp('sales');pass('existing_sales_auth_otp_without_staff_creation');
const student=client();const email='public-onboarding-'+randomUUID()+'@student.local.test';const password=randomUUID()+'Aa1!';
const baseline=db("SELECT json_build_object('requests',(SELECT count(*) FROM platform_private.student_applications),'cases',(SELECT count(*) FROM platform.student_cases WHERE public_application_id IS NOT NULL))");
let draft={"schemaVersion": 1, "requestId": randomUUID(), "firstName": "QA", "lastName": "Student", "phone": "+996555000123", "destinationCountries": ["CN", "MY"], "intakeSeason": "autumn", "intakeYear": 2027, "educationLevel": "high_school", "averageGrade": 4.5, "gradeScale": "5", "studyFields": ["Engineering", "Economics"], "studyLevels": ["bachelor", "foundation"], "nationality": "KG", "english": {"mode": "exam", "exam": "toefl", "score": 5.5}, "tuitionBudget": "5000_10000", "fundingSource": "family", "consent": true, "consentVersion": "2026-09-18"};
const signup=await student.auth.signUp({email,password,options:{data:{student_application_draft:draft}}});
if(signup.error){console.error('SIGNUP_ERROR',signup.error.code);throw new Error('SIGNUP_FAILED');}assert.ok(signup.data.session);assert.ok(signup.data.user?.id);saved('student-credentials.json',{email,password,userId:signup.data.user.id,draft});saved('student-session.json',signup.data.session);pass('canonical_signup_returns_session_without_confirmation_email');
const current=await student.auth.getUser();assert.equal(current.error,null);assert.equal(current.data.user?.id,signup.data.user.id);assert.ok(current.data.user?.email_confirmed_at);pass('real_auth_identity_after_signup_auto_confirmed_not_mailbox_verified');
const delivered=await(await fetch(cfg.mailpit+'/api/v1/messages')).json();assert.ok(!delivered.messages.some(m=>m.To?.some(t=>t.Address===email)));pass('signup_does_not_send_confirmation_email');
assert.equal(await rpc(student,'own_student_application_v1'),null);pass('authenticated_account_initially_has_no_application');
const submitted=await rpc(student,'submit_student_application_v1',{p_request_id:draft.requestId,p_questionnaire:draft,p_expected_revision:0});assert.equal(submitted.status,'pending');assert.equal(submitted.revision,1);saved('application-private.json',submitted);pass('account_questionnaire_persisted_pending');
const replay=await rpc(student,'submit_student_application_v1',{p_request_id:draft.requestId,p_questionnaire:draft,p_expected_revision:0});assert.equal(replay.id,submitted.id);assert.equal(replay.revision,1);pass('same_submission_idempotent');
const changed=await rawRpc(student,'submit_student_application_v1',{p_request_id:draft.requestId,p_questionnaire:{...draft,firstName:'Changed'},p_expected_revision:0});assert.ok(changed.error);pass('same_request_changed_payload_denied');
const noMember=db(`SELECT json_build_object('memberships',(SELECT count(*) FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id WHERE p.auth_user_id='${signup.data.user.id}'),'cases',(SELECT count(*) FROM platform.student_cases WHERE public_application_id='${submitted.id}'))`);assert.equal(noMember.memberships,0);assert.equal(noMember.cases,0);pass('pending_application_creates_no_membership_or_case');
const pendingPortal=await rawRpc(student,'student_portal_cases');assert.ok(pendingPortal.error||pendingPortal.data.length===0);pass('pending_user_portal_rpc_denied');
for(const [label,c] of [['pending_student',student],['sales',sales.c]]){const denied=await rawRpc(c,'staff_student_applications_v1');assert.ok(denied.error);pass(label+'_admissions_queue_denied');}
const anonDenied=await rawRpc(client(),'submit_student_application_v1',{p_request_id:randomUUID(),p_questionnaire:draft,p_expected_revision:0});assert.ok(anonDenied.error);pass('anonymous_submission_denied');
const queue=await rpc(admin.c,'staff_student_applications_v1');assert.ok(queue.applications.some(a=>a.id===submitted.id));assert.ok(queue.curators.length);assert.ok(queue.pending_count>=1);saved('queue-private.json',queue);pass('admin_queue_real_count_and_explicit_eligible_curators');
const curator=queue.curators.find(c=>c.directions.includes('MY'));assert.ok(curator);
const badDir=await rawRpc(admin.c,'decide_student_application_v1',{p_application_id:submitted.id,p_expected_revision:1,p_decision:'approve',p_admissions_direction:'AE',p_curator_membership_id:curator.membership_id,p_reason:'Local QA invalid direction',p_request_id:randomUUID()});assert.ok(badDir.error);pass('unselected_direction_approval_denied');
const rejectArgs={p_application_id:submitted.id,p_expected_revision:1,p_decision:'reject',p_admissions_direction:null,p_curator_membership_id:null,p_reason:'Уточните анкету для локальной проверки',p_request_id:randomUUID()};
const rejected=await rpc(admin.c,'decide_student_application_v1',rejectArgs);assert.equal(rejected.status,'rejected');assert.equal(rejected.revision,2);pass('admissions_rejection_persists_without_portal_access');
draft={...draft,requestId:randomUUID(),studyFields:[...draft.studyFields,'Computer science']};const revised=await rpc(student,'submit_student_application_v1',{p_request_id:draft.requestId,p_questionnaire:draft,p_expected_revision:2});assert.equal(revised.id,submitted.id);assert.equal(revised.revision,3);assert.equal(revised.status,'pending');pass('rejected_same_identity_resubmission_reuses_request_with_version');
const approveArgs={p_application_id:submitted.id,p_expected_revision:3,p_decision:'approve',p_admissions_direction:'MY',p_curator_membership_id:curator.membership_id,p_reason:'Локальная проверка публичного поступления',p_request_id:randomUUID()};saved('approval-args-private.json',approveArgs);
const approved=await rpc(admin.c,'decide_student_application_v1',approveArgs);assert.equal(approved.status,'approved');assert.ok(approved.student_case_id);pass('approval_atomic_membership_case_curator_and_profile');saved('application-private.json',approved);
const dup=await rpc(admin.c,'decide_student_application_v1',approveArgs);assert.equal(dup.student_case_id,approved.student_case_id);assert.equal(dup.revision,approved.revision);pass('approval_replay_no_duplicate_case');
const stale=await rawRpc(admin.c,'decide_student_application_v1',{...approveArgs,p_decision:'reject',p_admissions_direction:null,p_curator_membership_id:null,p_request_id:randomUUID()});assert.equal(stale.error?.code,'40001');pass('stale_conflicting_decision_denied');
const refreshed=await student.auth.refreshSession();assert.equal(refreshed.error,null);saved('student-session.json',refreshed.data.session);pass('approved_student_refreshes_canonical_auth_claims');
const portal=await rpc(student,'student_portal_cases');assert.ok(portal.some(c=>c.case_id===approved.student_case_id&&c.case_state==='active'&&c.portal_activated_at));pass('approved_student_real_portal_rpc_visible');
const caseRows=await rpc(admin.c,'staff_student_case_page',{p_limit:50,p_student_case_id:approved.student_case_id});assert.equal(caseRows.length,1);assert.equal(caseRows[0].responsible_sales_display_name,null);pass('approved_ownerless_case_readable_by_staff');
const profile=await rpc(admin.c,'staff_student_application_for_case_v1',{p_student_case_id:approved.student_case_id});assert.deepEqual(profile.questionnaire.destinationCountries,draft.destinationCountries);assert.deepEqual(profile.questionnaire.studyFields,draft.studyFields);pass('approved_profile_preserves_self_reported_multiselect_source');
const facts=db(`SELECT json_build_object('memberships',(SELECT count(*) FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id WHERE p.auth_user_id='${signup.data.user.id}'),'cases',(SELECT count(*) FROM platform.student_cases WHERE public_application_id='${submitted.id}'),'sales_is_null',(SELECT responsible_sales_membership_id IS NULL FROM platform.student_cases WHERE id='${approved.student_case_id}'),'profile_count',(SELECT count(*) FROM platform.student_profiles WHERE student_case_id='${approved.student_case_id}'),'needs_review',(SELECT bool_and(review_state='needs_review') FROM platform.student_profile_fields WHERE student_case_id='${approved.student_case_id}'))`);assert.deepEqual(facts,{memberships:1,cases:1,sales_is_null:true,profile_count:1,needs_review:true});pass('readback_one_membership_one_case_self_reported_profile_needs_review');


{
const app=JSON.parse(readFileSync(dir+'/application-private.json'));const creds=JSON.parse(readFileSync(dir+'/student-credentials.json'));
const profile=await rpc(admin.c,'staff_student_profile_snapshot',{p_student_case_id:app.student_case_id});assert.equal(profile.length,1);saved('canonical-profile-private.json',profile);assert.match(profile[0].current_education_summary,/[^a-z_]/);assert.match(profile[0].budget_band,/[^a-z_]/);pass('canonical_profile_snapshot_displays_human_readable_self_reported_values');
const section=await rpc(admin.c,'staff_case_access_snapshot',{p_organization_id:JSON.parse(readFileSync(dir+'/admin-session.json')).organization_id,p_student_case_id:app.student_case_id});assert.ok(section);pass('approved_case_section_authority_resolves');
const applications=await rpc(admin.c,'staff_application_page',{p_limit:5,p_student_case_id:app.student_case_id});assert.deepEqual(applications,[]);pass('approved_case_empty_application_page_reads_without_nullable_owner_error');
for (const [label,c] of [['approved_student',student],['sales',sales.c]]) {const denied=await rawRpc(c,'staff_student_application_for_case_v1',{p_student_case_id:app.student_case_id});assert.ok(denied.error);pass(label+'_staff_questionnaire_path_denied');}
const existing=db(`SELECT row_to_json(x) FROM (SELECT u.email FROM platform.organization_memberships m JOIN platform.profiles p ON p.id=m.profile_id JOIN auth.users u ON u.id=p.auth_user_id WHERE m.current_role='student' AND u.id<>'${creds.userId}' LIMIT 1)x`);
assert.ok(existing);const other=client();assert.equal((await other.auth.signInWithOtp({email:existing.email,options:{shouldCreateUser:false}})).error,null);const v=await other.auth.verifyOtp({token_hash:hash(await mail(existing.email)),type:'magiclink'});assert.equal(v.error,null);saved('other-student-session.json',v.data.session);assert.equal(await rpc(other,'own_student_application_v1'),null);const otherCases=await rpc(other,'student_portal_cases');assert.ok(!otherCases.some(c=>c.case_id===app.student_case_id));pass('existing_other_student_cannot_read_new_application_or_case');
const forged=await rawRpc(other,'submit_student_application_v1',{p_request_id:creds.draft.requestId,p_questionnaire:creds.draft,p_expected_revision:0});assert.ok(forged.error);pass('other_student_cannot_replay_owner_submission_receipt');
const rawTable=await student.schema('platform_private').from('student_applications').select('*');assert.ok(rawTable.error);pass('raw_private_application_table_unavailable_to_authenticated_client');
const counts=db(`SELECT json_build_object('linked_clients',(SELECT count(*) FROM platform.clients WHERE normalized_email=(SELECT normalized_email FROM platform_private.student_applications WHERE id='${app.id}')),'canonical_lead_null',(SELECT canonical_lead_id IS NULL FROM platform.student_cases WHERE id='${app.student_case_id}'),'public_requests',(SELECT count(*) FROM platform_private.student_applications),'case_links',(SELECT count(*) FROM platform.student_cases WHERE public_application_id IS NOT NULL))`);assert.equal(counts.linked_clients,0);assert.equal(counts.canonical_lead_null,true);assert.equal(counts.public_requests,baseline.requests+1);assert.equal(counts.case_links,baseline.cases+1);pass('public_approval_does_not_create_sales_client_or_lead');
console.log('LOCAL_NARROW_PROOF_COMPLETE '+checks.length);

}
