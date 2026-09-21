import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeManageQuery, isManageTimestamp, parseManageCursor, parseManageRoute, parseManageListContext, manageListContext, manageListHref, manageEditorHref, parseManageDraftPage } from '../src/lib/university-manage-contract.ts';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const time = '2026-09-21T10:00:00.123456Z';
const cursor = (q='', n=1, createdAt=time) => JSON.stringify({q,createdAt,id:id(n)});
const route = q => parseManageRoute(new URLSearchParams(q));
// Pure contract inputs use existing reviewed content; these are not database fixtures or Auth evidence.
const content = JSON.parse(readFileSync(new URL('../src/lib/server/university-catalog-reviewed-china.json',import.meta.url),'utf8'))[0].content;
const row = n => ({id:id(n),institutionId:null,baseVersion:0,createdAt:time,content,reason:'Review',status:'draft',reviewKind:'content'});
const page = items => ({organizationId:id(999),query:'',items,nextCursor:null});
test('literal query normalization and invalid control/length boundaries',()=>{
 assert.equal(normalizeManageQuery('  50%_大学  '),'50%_大学');
 for(const q of ['a\nb','a\u0085b','x'.repeat(201),null]) assert.equal(normalizeManageQuery(q),null);
 assert.equal(normalizeManageQuery('x'.repeat(200)).length,200);
});
test('cursor keeps microseconds, validates real calendar and canonical query binding',()=>{
 assert.equal(parseManageCursor(cursor('CN'),'CN').createdAt,time);
 for(const t of ['2026-02-29T10:00:00.123456Z','2026-09-21T24:00:00.123456Z','2026-09-21T10:00:00.123Z','0000-01-01T00:00:00.000000Z']) assert.equal(isManageTimestamp(t),false);
 assert.equal(isManageTimestamp('2024-02-29T00:00:00.000001Z'),true);
 assert.equal(parseManageCursor(cursor('CN'),'MY'),null);
 assert.equal(parseManageCursor(JSON.stringify({q:'',createdAt:time,id:null}),''),null);
 assert.equal(parseManageCursor(' '+cursor(),''),null);
 const v8=JSON.stringify({q:'',createdAt:time,id:'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa'});
 assert.ok(parseManageCursor(v8,''));
 assert.equal(parseManageCursor(v8.toUpperCase(),''),null);
});
test('route rejects duplicate, mixed, unknown and array parameters',()=>{
 for(const q of ['q=a&q=b','new=1&edit='+id(1),'new=1&q=a','q=a&listContext=x','unknown=1','new=2','draft=no','cursor=x']) assert.equal(route(q),null,q);
 assert.equal(parseManageRoute([['q',['a','b']]]),null);
 assert.equal(route('q=CN').index.cursor,null);
 assert.equal(route('new=1').mode,'new');
});
test('closed canonical listContext cannot smuggle a URL or duplicate key',()=>{
 const index={q:'%_ &CN',cursor:cursor('%_ &CN')}, context=manageListContext(index);
 assert.deepEqual(parseManageListContext(context),index);
 for(const bad of ['{"q":"","q":"CN","cursor":null}','{"cursor":null,"q":""}','{"q":"","cursor":null,"href":"https://evil.test"}',JSON.stringify({q:' CN ',cursor:null}),' '.repeat(4097)]) assert.equal(parseManageListContext(bad),null);
 assert.equal(manageListContext({q:'',cursor:null}),null);
 assert.equal(manageEditorHref('new','1','{"q":"","cursor":null}'),'/v3/universities/manage?new=1');
 for(const mode of ['draft','edit','identify','template','new','batch']) {
  const href=manageEditorHref(mode,['new','batch'].includes(mode)?'1':mode==='template'?'apu':id(1),context);
  const parsed=parseManageRoute(new URL(href,'https://local.test').searchParams);
  assert.equal(parsed.listContext,context);
  assert.equal(manageListHref(parseManageListContext(parsed.listContext)),manageListHref(index));
 }
 assert.equal(manageListHref({q:'',cursor:null}),'/v3/universities/manage');
});
test('page validates tenant/query/closed envelope, payload and mixed-key ordering',()=>{
 assert.deepEqual(parseManageDraftPage(page([]),id(999),{q:'',cursor:null}),{items:[],nextCursor:null});
 assert.ok(parseManageDraftPage(page([row(1),row(2)]),id(999),{q:'',cursor:null}));
 for(const value of [{...page([]),organizationId:id(998)},{...page([]),query:'CN'},{...page([]),extra:true},page([row(2),row(1)]),page([row(1),row(1)]),page([{...row(1),reviewKind:'other'}])]) assert.equal(parseManageDraftPage(value,id(999),{q:'',cursor:null}),null);
 assert.equal(parseManageDraftPage(page([row(1)]),id(999),{q:'',cursor:cursor()}),null);
 assert.ok(parseManageDraftPage(page([row(2)]),id(999),{q:'',cursor:cursor()}));
 const older={...row(1),createdAt:'2026-09-21T10:00:00.123455Z'};
 assert.ok(parseManageDraftPage(page([older]),id(999),{q:'',cursor:cursor()}));
});
test('next cursor requires fifty rows and exact last row, no guessed totals',()=>{
 const items=Array.from({length:50},(_,n)=>row(n+1));
 const value={...page(items),nextCursor:{createdAt:time,id:id(50)}};
 assert.equal(parseManageDraftPage(value,id(999),{q:'',cursor:null}).nextCursor,cursor('',50));
 for(const invalid of [{...value,items:items.slice(1)},{...value,nextCursor:{createdAt:time,id:id(49)}},{...value,nextCursor:{createdAt:time,id:id(50),total:51}},page([...items,row(51)])]) assert.equal(parseManageDraftPage(invalid,id(999),{q:'',cursor:null}),null);
});
