// Constructed protocol fixtures only: these tests are not runtime acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applicationDocumentFailure, parseApplicationDocumentUploadReceipt, parseApplicationDocumentReviewIntent,
  parseApplicationDocumentNotification, parseApplicationDocumentFile, parseApplicationDocumentReusableVersionsPage } from '../src/lib/portal/application-documents.ts';
import { encodeApplicationDocumentUploadHeader, decodeApplicationDocumentUploadHeader, freezeApplicationDocumentUploadIntent, applicationDocumentUploadFileMatches } from '../src/lib/portal/application-documents-upload.ts';
import { applicationDocumentPendingKey, readApplicationDocumentPending, persistApplicationDocumentPending, clearApplicationDocumentPending,
  listApplicationDocumentPending, listApplicationDocumentPendingScopes, withApplicationDocumentLock } from '../src/lib/portal/application-documents-pending.ts';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const target = { studentCaseId:id(1), applicationId:id(2), requirementsRevisionId:id(3), requirementItemId:id(4), documentSlotId:id(5) };
const bytes = new TextEncoder().encode('%PDF-1.7\nprotocol fixture');
const metadata = { originalFilename:'справка.pdf', declaredMimeType:'application/pdf', byteSize:String(bytes.length), sha256Hex:createHash('sha256').update(bytes).digest('hex') };
const header = { protocolVersion:1, ...target, file:metadata };
const intent = { ...header, requestId:id(6) };
const file = new File([bytes], metadata.originalFilename, {type:metadata.declaredMimeType});
const receipt = { ...intent, uploadContextId:id(7), documentVersionId:id(8), versionNo:'1', finalizedAt:'2026-09-21T12:00:00Z', publishedToLegacySlot:false };
const scope = { organizationId:id(20), membershipId:id(21), studentCaseId:id(1), applicationId:id(2) };
const summary = { ...metadata, documentVersionId:id(8), versionNo:'1', finalizedAt:receipt.finalizedAt, technicalAvailability:'available', unavailableReasons:[] };
function storage() { const map=new Map(); return { map, get length(){return map.size}, key(i){return [...map.keys()][i]??null}, getItem(k){return map.get(k)??null}, setItem(k,v){map.set(k,v)}, removeItem(k){map.delete(k)} }; }
test('closed upload header uses canonical base64url but permits JSON key order', () => {
 const encoded=encodeApplicationDocumentUploadHeader(header); assert.deepEqual(decodeApplicationDocumentUploadHeader(encoded),header);
 assert.deepEqual(decodeApplicationDocumentUploadHeader(Buffer.from(JSON.stringify({...header,file:{...metadata}})).toString('base64url')),header);
 for(const bad of [encoded+'=', encoded+'\n', 'A', '_w', 'a'.repeat(8193)]) assert.equal(decodeApplicationDocumentUploadHeader(bad),null);
 assert.equal(encodeApplicationDocumentUploadHeader({...header,actor:id(9)}),null);
 for(const name of ['x\0.pdf','x\u0085.pdf','../x.pdf',' x.pdf','x\\y.pdf']) assert.equal(encodeApplicationDocumentUploadHeader({...header,file:{...metadata,originalFilename:name}}),null);
 assert.equal(encodeApplicationDocumentUploadHeader({...header,file:{...metadata,byteSize:'01'}}),null);
});
test('file retry binds exact original name, MIME, size, bytes and retained UUID',async()=>{
 assert.deepEqual(await freezeApplicationDocumentUploadIntent(target,file,id(6)),intent);
 assert.equal(await applicationDocumentUploadFileMatches(intent,file),true);
 for(const f of [new File([bytes],'other.pdf',{type:file.type}),new File([bytes],file.name,{type:'image/png'}),new File(['changed'],file.name,{type:file.type})]) assert.equal(await applicationDocumentUploadFileMatches(intent,f),false);
});
test('saved receipt is strictly scoped and never claims legacy publication',()=>{
 assert.deepEqual(parseApplicationDocumentUploadReceipt(receipt,intent),receipt);
 for(const changed of [{requestId:id(9)},{requirementsRevisionId:id(9)},{publishedToLegacySlot:true},{file:{...metadata,originalFilename:'changed.pdf'}},{extra:true}]) assert.equal(parseApplicationDocumentUploadReceipt({...receipt,...changed},intent),null);
});
test('review preserves paragraph text but rejects unsafe controls',()=>{
 const review={submissionId:id(30),expectedPreviousReviewId:null,decision:'correction_required',reason:'Первая\nВторая\r\n\tстрока',requestId:id(31)};
 assert.deepEqual(parseApplicationDocumentReviewIntent(review),review);
 for(const reason of ['', 'bad\0', 'bad\u0085']) assert.equal(parseApplicationDocumentReviewIntent({...review,reason}),null);
});
test('only exact after-replay command rejections release unknown intent',()=>{
 assert.equal(applicationDocumentFailure({code:'PT409',message:'application_document_stale_requirements'},'submit').resolution,'not_written');
 for(const error of [{code:'42501',message:'application_document_stale_requirements'},{code:'22023',message:'application_document_invalid'},{code:'PT409',message:'application_document_intent_conflict'},{}]) assert.equal(applicationDocumentFailure(error,'submit').resolution,'retain');
 assert.equal(applicationDocumentFailure({code:'PT409',message:'application_document_stale_requirements'}).resolution,'retain');
 assert.equal(applicationDocumentFailure({code:'PT409',message:'application_document_upload_busy'}).reason,'busy');
 assert.equal(applicationDocumentFailure({code:'PT409',message:'application_document_upload_lease_unavailable'}).reason,'lease_expired');
});
test('pending cannot be overwritten or cleared by a different request and survives item replacement',()=>{
 const port=storage();persistApplicationDocumentPending(scope,'upload',id(4),intent,port);
 assert.throws(()=>persistApplicationDocumentPending(scope,'upload',id(4),{...intent,requestId:id(9)},port));
 clearApplicationDocumentPending(scope,'upload',id(4),{...intent,requestId:id(9)},port);
 assert.deepEqual(readApplicationDocumentPending(scope,'upload',id(4),port).intent,intent);
 const reads=[];const get=port.getItem.bind(port);port.getItem=k=>{reads.push(k);return get(k)};
 port.setItem(applicationDocumentPendingKey({...scope,membershipId:id(90)},'upload',id(4)),'private foreign');
 assert.equal(listApplicationDocumentPending(scope,port).length,1);assert.equal(reads.some(k=>k.includes(id(90))),false);
 clearApplicationDocumentPending(scope,'upload',id(4),intent,port);assert.equal(listApplicationDocumentPending(scope,port).length,0);
});
test('malformed pending blocks and unavailable/busy cross-tab locks never send',async()=>{
 const port=storage();port.setItem(applicationDocumentPendingKey(scope,'upload',id(4)),'{}');assert.equal(readApplicationDocumentPending(scope,'upload',id(4),port).blocked,true);
 let calls=0;const fn=async()=>{calls++;return 'done'};
 assert.deepEqual(await withApplicationDocumentLock(scope,'upload',id(4),fn,{storage:port,locks:{}}),{acquired:false,reason:'storage_unavailable'});
 assert.deepEqual(await withApplicationDocumentLock(scope,'upload',id(4),fn,{storage:port,locks:{request:async(_k,_o,cb)=>cb(null)}}),{acquired:false,reason:'busy'});
 assert.equal(calls,0);
 assert.deepEqual(await withApplicationDocumentLock(scope,'upload',id(4),fn,{storage:port,locks:{request:async(_k,o,cb)=>{assert.equal(o.ifAvailable,true);return cb({})}}}),{acquired:true,value:'done'});
});
test('file reasons, version pagination and historical notification reject cross-links',()=>{
 assert.ok(parseApplicationDocumentFile({...summary,originalFilename:' путь/old\\name.pdf '}));
 assert.ok(parseApplicationDocumentFile({...summary,originalFilename:'\u00a0'}));
 assert.ok(parseApplicationDocumentFile({...summary,technicalAvailability:'unavailable',unavailableReasons:['storage_object_unavailable','scan_proof_unavailable']}));
 assert.equal(parseApplicationDocumentFile({...summary,technicalAvailability:'unavailable',unavailableReasons:['malware_error','malware_infected']}),null);
 const candidate={selection:{kind:'existing_version',documentVersionId:id(8)},file:summary};
 const page={protocolVersion:1,studentCaseId:id(1),applicationId:id(2),requirementItemId:id(4),versions:[candidate],nextCursor:{versionNo:'1',documentVersionId:id(8)}};
 assert.ok(parseApplicationDocumentReusableVersionsPage(page,target,id(4)));
 assert.equal(parseApplicationDocumentReusableVersionsPage({...page,nextCursor:{versionNo:'2',documentVersionId:id(8)}},target,id(4)),null);
 const notification={protocolVersion:1,notificationId:id(41),...target,reviewId:id(42),submission:{submissionId:id(43),requirementsRevisionId:id(3),requirementItemId:id(4),documentSlotId:id(5),submittedAt:receipt.finalizedAt,file:summary,review:{reviewId:id(42),decision:'approved',reason:null,reviewedAt:receipt.finalizedAt}}};
 assert.ok(parseApplicationDocumentNotification(notification,id(41),id(1)));
 assert.equal(parseApplicationDocumentNotification({...notification,reviewId:id(44)},id(41),id(1)),null);
 assert.equal(parseApplicationDocumentNotification(notification,id(41),id(99)),null);
});


test('review scope discovery isolates current owner, deduplicates and sorts without reading any values',()=>{
 const port=storage();
 const otherApp={...scope,applicationId:id(3)},otherCase={...scope,studentCaseId:id(2)};
 for(const [s,op,target] of [[otherCase,'review',id(31)],[scope,'review',id(32)],[otherApp,'review',id(33)],[scope,'review',id(34)],
  [{...scope,organizationId:id(90)},'review',id(35)],[{...scope,membershipId:id(91)},'review',id(36)],
  [{...scope,applicationId:id(4)},'submit',id(37)],[{...scope,applicationId:id(5)},'upload',id(38)]]) port.setItem(applicationDocumentPendingKey(s,op,target),'unread private value');
 port.getItem=()=>{throw Error('Scope discovery must not read values')};
 assert.deepEqual(listApplicationDocumentPendingScopes(scope,'review',port),[scope,otherApp,otherCase]);
});
test('review scope discovery rejects malformed key shapes and reports inaccessible storage',()=>{
 const port=storage(),valid=applicationDocumentPendingKey(scope,'review',id(30));
 for(const key of [valid+':extra',valid.slice(0,-1),valid.replace(id(1),'not-a-uuid'),valid.replace(':review:',':unknown:'),valid.replace(id(30),'00000000-0000-4000-7000-000000000030')]) port.setItem(key,'unread');
 assert.deepEqual(listApplicationDocumentPendingScopes(scope,'review',port),[]);
 assert.throws(()=>listApplicationDocumentPendingScopes({...scope,membershipId:'invalid'},'review',port),/scope inventory unavailable/);
 assert.throws(()=>listApplicationDocumentPendingScopes(scope,'submit',port),/scope inventory unavailable/);
 assert.throws(()=>listApplicationDocumentPendingScopes(scope,'review',{...port,key(){throw Error('private access failure')}}),/scope inventory unavailable/);
 assert.throws(()=>listApplicationDocumentPendingScopes(scope,'review',{...port,get length(){throw Error('private access failure')}}),/scope inventory unavailable/);
});
