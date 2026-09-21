// Dependency-injected transport/protocol tests. No database, Auth or Storage runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStaffApplicationDocumentUploadHandler, createStudentApplicationDocumentUploadHandler, createStudentApplicationDocumentDownloadHandler } from '../src/lib/server/platform-document-storage-route-handlers.ts';
import { encodeApplicationDocumentUploadHeader } from '../src/lib/portal/application-documents-upload.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const target={studentCaseId:id(1),applicationId:id(2),requirementsRevisionId:id(3),requirementItemId:id(4),documentSlotId:id(5)};
const bytes=new TextEncoder().encode('%PDF-1.7\nprotocol fixture');
const file={originalFilename:'документ.pdf',declaredMimeType:'application/pdf',byteSize:String(bytes.length),sha256Hex:createHash('sha256').update(bytes).digest('hex')};
const header={protocolVersion:1,...target,file},requestId=id(6),at='2026-09-21T12:00:00.000Z',later='2026-09-21T12:05:00.000Z';
const saved={...header,requestId,uploadContextId:id(7),documentVersionId:id(8),versionNo:'1',finalizedAt:at,publishedToLegacySlot:false};
const actor={organizationId:id(10),authUserId:id(11)};
const objectName=`aa/${'b'.repeat(62)}`;
function request({content=bytes,mime=file.declaredMimeType,name='upload',extra=false,intent=header}={}){
 const body=new FormData();body.set('file',new File([content],name,{type:mime}));if(extra)body.set('unexpected','x');
 return new Request('https://app.test/api/portal/application-document-uploads',{method:'POST',headers:{'Idempotency-Key':requestId,'X-EVO-Upload-Intent':encodeApplicationDocumentUploadHeader(intent)},body});
}
function setup({terminal=true,denyAfterBody=false,completeFailure=false,definitiveNotSaved=false,verifyChange=null,reservationChange=null,finalizeFailure=false}={}){
 const calls=[];let auth=0;
 const admit={protocolVersion:1,contextId:id(7),requestId,intentSha256:'a'.repeat(64),...target,file,phase:terminal?'finalized':'body_required',bodyDeadline:later,scanLease:{admissionId:id(12),scanAllowed:!terminal},receipt:terminal?saved:null};
 const proof={engine:'ClamAV',engineVersion:'1.5.4',signatureVersion:'27890',protocol:'clamd-zinstream-v1',scannedAt:at,sha256Hex:file.sha256Hex};
 const user={schema(){return this},async rpc(name,args){calls.push([name,args]);if(name==='admit_application_document_upload_v1')return {data:admit,error:null};if(name==='verify_application_document_upload_body_v1')return {data:{...admit,...verifyChange},error:null};throw Error('unexpected ordinary RPC')}};
 const service={schema(){return this},async rpc(name,args){calls.push([name,args]);
  if(name==='complete_application_document_upload_scan_v1')return completeFailure?{data:null,error:{code:'unavailable'}}:{data:{savedReceipt:terminal?saved:null,definitiveNotSaved},error:null};
  if(name==='claim_application_document_upload_scan_v1')return {data:{admission_id:id(12),organization_id:actor.organizationId,request_id:requestId,scan_claimed_at:at,claim_checked_at:at,scan_lease_expires_at:later,scan_claim_replay:false,scan_allowed:true},error:null};
  if(name==='reserve_application_document_upload_after_ingress_scan_v1')return {data:{organization_id:actor.organizationId,student_case_id:target.studentCaseId,document_slot_id:target.documentSlotId,document_version_id:id(8),upload_reservation_id:id(13),bucket_id:'platform-documents',object_name:objectName,expires_at:later,declared_mime_type:file.declaredMimeType,byte_size:bytes.length,sha256_hex:file.sha256Hex,ingress_scan_proof:true,ingress_scan_result:'clean',ingress_scanner_engine:proof.engine,ingress_scanner_engine_version:proof.engineVersion,ingress_scanner_signature_version:proof.signatureVersion,ingress_scanner_protocol:proof.protocol,ingress_scanned_at:at,storage_object_present:false,document_slot_published:false,...reservationChange},error:null};
  if(name==='finalize_application_document_upload_with_scan_v1')return finalizeFailure?{data:null,error:{code:'unavailable'}}:{data:saved,error:null};
  throw Error('unexpected service RPC');},storage:{from(bucket){assert.equal(bucket,'platform-documents');return {async upload(path,data,options){calls.push(['storage.upload',{path,options}]);assert.deepEqual(data,bytes);return {error:null}},async download(path){calls.push(['storage.download',path]);return {data:new Blob([bytes],{type:file.declaredMimeType}),error:null}}}}}};
 const deps={async authorize(){calls.push(['authorize']);auth++;return denyAfterBody&&auth>1?{status:'forbidden',actor:null}:{status:'authorized',actor}},async createUserClient(){return user},createServiceClient(){return service},async scanFile(data){calls.push(['scan']);assert.deepEqual(data,bytes);return proof},now:()=>Date.parse(at),requestId:()=>id(99),backendConfig(){throw Error('unexpected config')},async fetch(){throw Error('unexpected fetch')},supabaseOrigin:()=> 'http://127.0.0.1:54321'};
 return {deps,calls};
}
test('terminal replay still consumes and verifies body and reauthorizes; no scan/storage',async()=>{
 const {deps,calls}=setup();const result=await createStudentApplicationDocumentUploadHandler(deps)(request());assert.equal(result.status,201);assert.deepEqual(await result.json(),{upload:saved});
 assert.deepEqual(calls.map(c=>c[0]),['authorize','admit_application_document_upload_v1','authorize','verify_application_document_upload_body_v1','complete_application_document_upload_scan_v1']);
});
test('terminal changed bytes, MIME, filename or extra field cannot retrieve a saved receipt',async()=>{
 for(const change of [{content:new TextEncoder().encode('%PDF-different')},{mime:'image/png'},{name:'original.pdf'},{extra:true}]){
  const {deps,calls}=setup();const result=await createStaffApplicationDocumentUploadHandler(deps)(request(change));assert.notEqual(result.status,201);assert.equal((await result.json()).error.resolution,'retain');assert.equal(calls.at(-1)[0],'complete_application_document_upload_scan_v1');assert.equal(calls.some(c=>c[0]==='verify_application_document_upload_body_v1'),false);
 }
});
test('revocation after body and changed verify lease fail closed and release owned admission',async()=>{
 for(const options of [{denyAfterBody:true},{verifyChange:{contextId:id(99)}}]){
  const {deps,calls}=setup(options);const result=await createStudentApplicationDocumentUploadHandler(deps)(request());assert.notEqual(result.status,201);assert.equal(calls.at(-1)[0],'complete_application_document_upload_scan_v1');assert.equal(calls.some(c=>c[0]==='scan'),false);
 }
});
test('fresh upload scans bytes and exact stored object then returns unpublished receipt',async()=>{
 const {deps,calls}=setup({terminal:false});const result=await createStaffApplicationDocumentUploadHandler(deps)(request());assert.equal(result.status,201,JSON.stringify(await result.clone().json()));assert.deepEqual(await result.json(),{upload:saved});
 assert.equal(calls.filter(c=>c[0]==='scan').length,2);
 const reserved=calls.find(c=>c[0]==='reserve_application_document_upload_after_ingress_scan_v1')[1];assert.equal(reserved.p_original_filename,file.originalFilename);assert.equal(reserved.p_context_id,id(7));assert.equal(reserved.p_admission_id,id(12));
 const upload=calls.find(c=>c[0]==='storage.upload')[1];assert.equal(upload.options.upsert,false);
 assert.equal(calls.some(c=>['reserve_document_upload_after_ingress_scan','finalize_document_upload_with_scan'].includes(c[0])),false);
});
test('legacy-published reservation and unrelated case cannot be used by new upload',async()=>{
 for(const reservationChange of [{document_slot_published:true},{student_case_id:id(99)}]){const {deps,calls}=setup({terminal:false,reservationChange});const result=await createStaffApplicationDocumentUploadHandler(deps)(request());assert.notEqual(result.status,201);assert.equal(calls.some(c=>c[0]==='storage.upload'),false);}
});
test('only serialized no-reservation proof clears failures; cleanup uncertainty preserves success',async()=>{
 const first=setup({terminal:false,definitiveNotSaved:true});const rejected=await createStaffApplicationDocumentUploadHandler(first.deps)(request({extra:true}));assert.equal((await rejected.json()).error.resolution,'not_written');
 const second=setup({terminal:false,finalizeFailure:true});const uncertain=await createStaffApplicationDocumentUploadHandler(second.deps)(request());assert.equal((await uncertain.json()).error.resolution,'retain');
 const third=setup({completeFailure:true});const success=await createStaffApplicationDocumentUploadHandler(third.deps)(request());assert.equal(success.status,201);
});
test('download rejects duplicate query scope before any grant call',async()=>{
 const {deps,calls}=setup();const query=new URLSearchParams({...target,documentVersionId:id(8)});query.append('applicationId',id(99));
 const result=await createStudentApplicationDocumentDownloadHandler(deps)(new Request(`https://app.test/api/portal/application-document-downloads?${query}`));assert.equal(result.status,400);assert.equal(calls.length,0);
});
test('only exact stale rejection at initial no-context admission releases the intent',async()=>{
 for(const [message,resolution] of [['application_document_stale_requirements','not_written'],['application_document_intent_conflict','retain'],['application_document_upload_busy','retain']]){
  const {deps,calls}=setup();deps.createUserClient=async()=>({schema(){return this},async rpc(){return {data:null,error:{code:'PT409',message}}}});
  const result=await createStudentApplicationDocumentUploadHandler(deps)(request());assert.equal(result.status,409);assert.equal((await result.json()).error.resolution,resolution);
  assert.equal(calls.some(([name])=>name==='scan'||name.startsWith('storage.')),false);
 }
 const {deps}=setup();const original=deps.createUserClient;deps.createUserClient=async()=>{
  const client=await original();return {schema(){return this},async rpc(name,args){return name==='verify_application_document_upload_body_v1'?{data:null,error:{code:'PT409',message:'application_document_stale_requirements'}}:client.rpc(name,args)}};
 };
 const later=await createStudentApplicationDocumentUploadHandler(deps)(request());assert.equal((await later.json()).error.resolution,'retain');
});
test('download grants exact historical context and signs only the one-use canonical object',async()=>{
 for(const wrongSlot of [false,true]){
  const calls=[];const grantId=id(50);const deps={...setup().deps,
   async createUserClient(){return {schema(){return this},async rpc(name,args){calls.push([name,args]);return {data:{document_download_grant_id:grantId,expires_at:later,signed_url:null,storage_api_service_sign_required:true},error:null}}}},
   createServiceClient(){return {schema(){return this},async rpc(name,args){calls.push([name,args]);return {data:{organization_id:actor.organizationId,student_case_id:target.studentCaseId,document_slot_id:wrongSlot?id(90):target.documentSlotId,document_version_id:id(8),document_download_grant_id:grantId,document_download_consumption_id:id(51),document_access_event_id:id(52),bucket_id:'platform-documents',object_name:objectName,max_signed_url_expires_in_seconds:60,grant_expires_at:later,signed_url:null,storage_api_service_sign_required:true},error:null}},storage:{from(){return {async createSignedUrl(path,seconds){calls.push(['sign',path,seconds]);return {data:{signedUrl:`http://127.0.0.1:54321/storage/v1/object/sign/platform-documents/${path}?token=test`},error:null}}}}}}},
  };
  const query=new URLSearchParams({...target,documentVersionId:id(8)});const result=await createStudentApplicationDocumentDownloadHandler(deps)(new Request(`https://app.test/api/portal/application-document-downloads?${query}`));
  assert.equal(result.status,wrongSlot?503:302);assert.equal(calls.some(c=>c[0]==='sign'),!wrongSlot);
  assert.equal(calls[0][0],'grant_application_document_download_v1');assert.equal(calls[0][1].p_requirements_revision_id,target.requirementsRevisionId);assert.equal(calls[0][1].p_requirement_item_id,target.requirementItemId);
  assert.equal(calls[1][1].p_actor_auth_user_id,actor.authUserId);
 }
});
