// Actual action control flow with synthetic ports; not Auth/SQL acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as codec from '../src/lib/portal/application-documents.ts';
import { universityIntakeId } from '../src/lib/platform-university-catalog.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={organizationId:id(1),membershipId:id(2),studentCaseId:id(3),applicationId:id(4)};
const intent={studentCaseId:id(3),applicationId:id(4),requirementsRevisionId:id(5),requirementItemId:id(6),selection:{kind:'existing_version',documentVersionId:id(7)},expectedPreviousSubmissionId:null,requestId:id(8)};
const receipt={protocolVersion:1,requestId:id(8),submissionId:id(9),studentCaseId:id(3),applicationId:id(4),requirementsRevisionId:id(5),requirementItemId:id(6),documentSlotId:id(10),documentVersionId:id(7),versionNo:'2',submittedAt:'2026-09-21T12:00:00Z',reused:false};
const source=readFileSync(new URL('../src/lib/portal/application-documents-actions.ts',import.meta.url),'utf8');
function actions({actor=scope,permission=true,response={data:receipt,error:null},refresh=()=>{}}={}){
 const calls=[],api={};const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 runInNewContext(output,{exports:api,require(name){
  if(name==='next/cache')return {revalidatePath:refresh};
  if(name.endsWith('student-portal-guards'))return {requireStudentPortalActor:async()=>actor};
  if(name.endsWith('student-portal-auth.ts'))return {resolveStudentPortalActor:async()=>({status:'authenticated',actor})};
  if(name.endsWith('platform-guards'))return {requirePlatformStaffActor:async()=>actor};
  if(name.endsWith('platform-access.ts'))return {isStaffPreview:()=>false,staffHasPermission:()=>permission};
  if(name.endsWith('supabase/server'))return {createSupabaseServerClient:async()=>({schema(){return this},async rpc(name,args){calls.push([name,args]);return response}})};
  if(name.endsWith('platform-university-catalog.ts'))return {universityIntakeId};
  if(name.endsWith('application-documents.ts'))return codec;
  throw Error('Unexpected import');
 }});return {api,calls};
}
test('student and staff commands reject current owner switch before ordinary RPC',async()=>{
 const a=actions({actor:{...scope,membershipId:id(90)}});
 for(const name of ['submitStudentApplicationDocumentAction','submitStaffApplicationDocumentAction'])assert.equal((await a.api[name](scope,intent)).reason,'forbidden');
 assert.equal((await a.api.readStudentApplicationDocumentsAction(scope,{studentCaseId:id(3),applicationId:id(4)})).reason,'forbidden');
 assert.equal(a.calls.length,0);
});
test('valid submission receipt survives cache invalidation failure',async()=>{
 const a=actions({refresh(){throw Error('refresh unavailable')}});const result=await a.api.submitStudentApplicationDocumentAction(scope,intent);
 assert.equal(result.ok,true);assert.deepEqual(result.receipt,receipt);assert.equal(a.calls[0][0],'submit_application_document_v1');assert.equal(a.calls[0][1].p_request_id,intent.requestId);
});
test('command exact conflict/forbidden/malformed retain and after-replay stale releases',async()=>{
 for(const [error,resolution] of [[{code:'PT409',message:'application_document_intent_conflict'},'retain'],[{code:'42501',message:'forbidden'},'retain'],[{code:'PT409',message:'application_document_previous_submission_changed'},'not_written']]){
  const a=actions({response:{data:null,error}});assert.equal((await a.api.submitStaffApplicationDocumentAction(scope,intent)).resolution,resolution);
 }
 const a=actions({response:{data:{...receipt,applicationId:id(90)},error:null}});assert.equal((await a.api.submitStaffApplicationDocumentAction(scope,intent)).resolution,'retain');
});
