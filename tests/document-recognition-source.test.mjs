import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { loadDocumentRecognitionSource } from "../src/lib/server/document-recognition-source.ts";

// Synthetic byte transport only, not a valid PDF/parser/Storage/provider proof.
const bytes = Buffer.from("%PDF-1.7\nSynthetic source byte transport\n");
const id = digit => `10000000-0000-4000-8000-${String(digit).padStart(12, "0")}`;
const identity = Object.freeze({ attempt_id:id(1), job_id:id(2), organization_id:id(3), student_case_id:id(4),
  document_slot_id:id(5), source_version_id:id(6), source_sha256:createHash("sha256").update(bytes).digest("hex"),
  source_bytes:bytes.byteLength, source_mime:"application/pdf" });
const key = "sb_secret_synthetic_source_test_only_123";
function grant(overrides = {}) {
  return { ...identity, bucket_id:"platform-documents", object_name:`ab/${"c".repeat(62)}`, access_event_id:id(8),
    granted_at:new Date().toISOString(), expires_at:new Date(Date.now()+14_000).toISOString(), ...overrides };
}
function deps(overrides = {}) {
  return { getBackendConfig:() => ({supabaseUrl:"http://127.0.0.1:54321",supabaseSecretKey:key}),
    grantSource:async () => ({data:grant(),error:null}), fetch:async () => new Response(bytes,{headers:{"content-type":"application/pdf"}}),
    now:Date.now, ...overrides };
}
const options = () => ({ signal:new AbortController().signal });

test("real local HTTP serialization streams exact bytes only after the fenced source grant", async () => {
  const order = []; let received;
  const server = createServer((request,response) => {
    order.push("http"); received={url:request.url,key:request.headers.apikey,authorization:request.headers.authorization,encoding:request.headers["accept-encoding"]};
    response.writeHead(200,{"content-type":"application/pdf","content-length":String(bytes.length)});
    response.write(bytes.subarray(0,9)); response.end(bytes.subarray(9));
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  try {
    const result = await loadDocumentRecognitionSource(identity,id(7),options(),deps({
      getBackendConfig:() => ({supabaseUrl:`http://127.0.0.1:${server.address().port}`,supabaseSecretKey:key}), fetch,
      grantSource:async (attempt,token,signal) => { order.push("grant"); assert.equal(attempt,id(1)); assert.equal(token,id(7)); assert.equal(signal.aborted,false); return {data:grant(),error:null}; },
    }));
    assert.deepEqual(Buffer.from(result.bytes),bytes); assert.equal(result.accessEventId,id(8));
    assert.deepEqual(order,["grant","http"]);
    assert.deepEqual(received,{url:`/storage/v1/object/platform-documents/ab/${"c".repeat(62)}`,key,authorization:undefined,encoding:"identity"});
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("each separate read obtains a fresh grant, while its durable event remains the same", async () => {
  let grants=0; const dependencies=deps({grantSource:async () => {grants++;return {data:grant(),error:null};}});
  const first=await loadDocumentRecognitionSource(identity,id(7),options(),dependencies);
  const second=await loadDocumentRecognitionSource(identity,id(7),options(),dependencies);
  assert.equal(grants,2); assert.equal(first.accessEventId,second.accessEventId);
});

test("source change, expired lease and revoked access remain fixed failures before byte retrieval", async () => {
  let calls=0;
  for (const [response,code] of [[{data:grant({source_sha256:"d".repeat(64)}),error:null},"source_changed"],
    [{data:grant({expires_at:new Date(Date.now()-1000).toISOString()}),error:null},"claim_unavailable"],
    [{data:null,error:{code:"42501",message:"unavailable"}},"access_revoked"]]) {
    await assert.rejects(loadDocumentRecognitionSource(identity,id(7),options(),deps({
      grantSource:async () => response,fetch:async () => {calls++;throw new Error("No read expected");},
    })),{name:"DocumentRecognitionSourceError",code,message:"Document source is unavailable"});
  }
  assert.equal(calls,0);
});

test("exact length and digest are enforced while incomplete or oversized streams are cancelled", async () => {
  for (const body of [bytes.subarray(0,bytes.length-1),Buffer.concat([bytes,Buffer.from("extra")]),Buffer.from("x".repeat(bytes.length))]) {
    let cancelled=false;
    const stream=new ReadableStream({start(controller){controller.enqueue(body);},cancel(){cancelled=true;}});
    // For short/equal lengths the stream must end so the final exact check runs.
    const response=body.length>bytes.length ? new Response(stream,{headers:{"content-type":"application/pdf"}})
      : new Response(body,{headers:{"content-type":"application/pdf"}});
    await assert.rejects(loadDocumentRecognitionSource(identity,id(7),options(),deps({fetch:async () => response})),{code:"source_changed"});
    if(body.length>bytes.length) assert.equal(cancelled,true);
  }
});

test("abort and unavailable source never return bytes or leak exception details", async () => {
  const abort=new AbortController();abort.abort();let reads=0;
  await assert.rejects(loadDocumentRecognitionSource(identity,id(7),{signal:abort.signal},deps({grantSource:async () => {reads++;throw new Error("No grant");}})),{code:"source_unavailable"});
  assert.equal(reads,0);
  await assert.rejects(loadDocumentRecognitionSource(identity,id(7),options(),deps({fetch:async () => {throw new Error("Synthetic upstream details are private");}})),
    {message:"Document source is unavailable",code:"source_unavailable"});
});

test("real in-progress HTTP source read ends when its caller aborts", { timeout: 2000 }, async () => {
  const abort = new AbortController();
  let timer;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/pdf" });
    response.write(bytes.subarray(0, 9));
    timer = setTimeout(() => abort.abort(), 25);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(loadDocumentRecognitionSource(identity, id(7), { signal: abort.signal }, deps({
      getBackendConfig: () => ({ supabaseUrl: `http://127.0.0.1:${server.address().port}`, supabaseSecretKey: key }), fetch,
    })), { code: "source_unavailable", message: "Document source is unavailable" });
    assert.equal(abort.signal.aborted, true);
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("a completed byte stream cannot outlive its exact source grant", async () => {
  const started = Date.now();
  let checks = 0;
  await assert.rejects(loadDocumentRecognitionSource(identity, id(7), options(), deps({
    grantSource: async () => ({ data: grant({ granted_at: new Date(started).toISOString(),
      expires_at: new Date(started + 14_000).toISOString() }), error: null }),
    now: () => ++checks <= 2 ? started : started + 15_000,
  })), { code: "claim_unavailable" });
  assert.equal(checks, 3);
});
