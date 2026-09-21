import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeReceiptUploadTarget as upload, decodeReceiptDownloadTarget as download, receiptTargetErrorStatus } from '../src/lib/payment-receipt-target.ts';
const org='10000000-0000-4000-8000-000000000001', caseId='20000000-0000-4000-8000-000000000002', event='30000000-0000-4000-8000-000000000003', file='40000000-0000-4000-8000-000000000004';
const target={organization_id:org,student_case_id:caseId,payment_event_id:event};
const stored={organization_id:org,student_case_id:caseId,payment_receipt_file_id:file,storage_object_name:`payment-receipts/${org}/${caseId}/${file}`};
test('upload target binds exact current organization and payment, without coercion or extra fields',()=>{
 assert.equal(upload(target,org,event)?.studentCaseId,caseId);
 for(const value of [null,[],true,{...target,extra:1},{...target,organization_id:caseId},{...target,payment_event_id:file},{...target,student_case_id:0},{...target,student_case_id:'00000000-0000-0000-0000-000000000000'},Object.create(target)]) assert.equal(upload(value,org,event),null);
});
test('download target binds receipt and case and accepts only the generated exact object path',()=>{
 assert.equal(download(stored,org,caseId,file)?.storageObjectName,stored.storage_object_name);
 for(const path of ['', '../x', stored.storage_object_name+'/extra',stored.storage_object_name+'\n',stored.storage_object_name+'?token=x',`payment-receipts/${org}/${event}/${file}`,`payment-receipts/${org}/${caseId}/%2e%2e`, 'x'.repeat(513)]) assert.equal(download({...stored,storage_object_name:path},org,caseId,file),null);
 for(const value of [{...stored,student_case_id:event},{...stored,organization_id:caseId},{...stored,payment_receipt_file_id:event},{...stored,extra:1},{...stored,storage_object_name:[]},null]) assert.equal(download(value,org,caseId,file),null);
});
test('only explicit authority rejection maps403; missing RPC and malformed results fail503',()=>{
 assert.equal(receiptTargetErrorStatus({code:'42501'}),403);
 for(const value of [null,{}, {code:'PGRST202'}, {code:'08006'}, {code:'XX000'}]) assert.equal(receiptTargetErrorStatus(value),503);
});
