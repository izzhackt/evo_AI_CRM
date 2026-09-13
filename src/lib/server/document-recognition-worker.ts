import "server-only";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import {
  canonicalDocumentRecognitionFingerprint, normalizeDocumentRecognitionReceipt,
  type DocumentRecognitionFailureCode, type DocumentRecognitionFingerprintInput,
} from "../document-recognition.ts";
import {
  buildDocumentRecognitionGenerationRequest, createGeminiDocumentRecognition,
  DocumentRecognitionProviderError, maximumDocumentRecognitionCostMicros, parseDocumentRecognitionProviderConfig,
  type DocumentRecognitionFileBinding, type DocumentRecognitionProviderConfig, type DocumentRecognitionProviderFile,
} from "./gemini-document-recognition.ts";
import {
  DocumentRecognitionSourceError, loadDocumentRecognitionSource,
  type DocumentRecognitionSourceIdentity,
} from "./document-recognition-source.ts";
import { getPlatformSupabaseBackendConfig } from "./platform-supabase-backend-config.ts";
import { createPlatformSupabaseServiceClient } from "./platform-supabase-service-client.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const POLICY = "document-source-v1";
type Provider = ReturnType<typeof createGeminiDocumentRecognition>;
type Identity = Omit<DocumentRecognitionFingerprintInput, "source_pages">;
type Claim = Readonly<{
  job_id:string; attempt_id:string; organization_id:string; claim_token:string; lease_until:string; stage:string;
  request_identity:Identity; request_fingerprint:string; config:DocumentRecognitionProviderConfig; reserved_cost_micros:number;
  source_pages:number|null; processing_fingerprint:string|null; state:string; resource_name:string|null; token_count_receipt:unknown;
  source_preflight_policy_version:string|null;
  provider_file_state:"ACTIVE"|"PROCESSING"|"FAILED"|null; provider_observation_count:number;
}>;
export type DocumentSourceInspector = (
  input:Readonly<{bytes:Uint8Array; mimeType:DocumentRecognitionFileBinding["mime_type"]; expectedSha256:string}>,
  options:Readonly<{signal:AbortSignal}>,
) => Promise<Readonly<
  {status:"verified"; sha256:string; byteLength:number; mimeType:DocumentRecognitionFileBinding["mime_type"]; pageCount:number; policyVersion:string}
  | {status:"rejected"; code:"document_not_eligible"|"source_unavailable"}
>>;
export type DocumentRecognitionWorkerDependencies = Readonly<{
  rpc(name:string, parameters:Record<string,unknown>, signal:AbortSignal):Promise<unknown>;
  loadSource:typeof loadDocumentRecognitionSource;
  inspectSource:DocumentSourceInspector;
  providerFor(config:DocumentRecognitionProviderConfig):Provider;
  pause(milliseconds:number,signal:AbortSignal):Promise<void>;
  now():number;
}>;
type WorkerFailure = DocumentRecognitionFailureCode | "claim_unavailable" | "workflow_unavailable";
class WorkflowError extends Error {
  readonly code:WorkerFailure;
  constructor(code:WorkerFailure="workflow_unavailable") { super("Document recognition workflow unavailable"); this.name="DocumentRecognitionWorkflowError";this.code=code; }
}
export type DocumentRecognitionTickResult = Readonly<{
  outcome:"idle"|"settled"|"deferred"|"unavailable"; job_id:string|null;
  state:string|null; failure_code:WorkerFailure|null;
}>;
function record(value:unknown):value is Record<string,unknown> { return !!value&&typeof value==="object"&&!Array.isArray(value); }
function fail(code:WorkerFailure="workflow_unavailable"):never { throw new WorkflowError(code); }
function sha(value:string):string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value:Record<string,unknown>):string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)));
}
function parseClaim(value:unknown, now:number, previous?:Claim):Claim {
  const keys=["job_id","attempt_id","organization_id","claim_token","lease_until","stage","request_identity","request_fingerprint",
    "config","reserved_cost_micros","source_pages","processing_fingerprint","state","resource_name","token_count_receipt","source_preflight_policy_version",
    "provider_file_state","provider_observation_count"];
  if(!record(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key))
    ||![value.job_id,value.attempt_id,value.organization_id,value.claim_token].every(id=>typeof id==="string"&&UUID.test(id))
    ||typeof value.lease_until!=="string"||Date.parse(value.lease_until)<=now||!Number.isFinite(Date.parse(value.lease_until))
    ||!record(value.request_identity)||typeof value.request_fingerprint!=="string"||!SHA.test(value.request_fingerprint)) fail();
  const config=parseDocumentRecognitionProviderConfig(value.config);
  const identity=value.request_identity as Identity;
  // A temporary page=1 validates the enqueue metadata shape only; it is never
  // persisted or used as the actual source proof. Only the real inspector seals pages.
  const full=canonicalDocumentRecognitionFingerprint({...identity,source_pages:value.source_pages??1});
  const enqueueHash=sha(canonical({...identity,fingerprint_version:"evo-document-recognition-enqueue-v1",config_sha256:sha(canonical({...config}))}));
  if(identity.organization_id!==value.organization_id||identity.model!==config.model||identity.config_version!==config.configVersion
    ||identity.provider_project_id!==config.projectId||enqueueHash!==value.request_fingerprint
    ||value.reserved_cost_micros!==maximumDocumentRecognitionCostMicros(config)
    ||!(value.provider_file_state===null||value.provider_file_state==="ACTIVE"||value.provider_file_state==="PROCESSING"||value.provider_file_state==="FAILED")
    ||!Number.isSafeInteger(value.provider_observation_count)||Number(value.provider_observation_count)<0||Number(value.provider_observation_count)>5
    ||(value.provider_file_state!==null&&(value.resource_name===null||value.source_pages===null||Number(value.provider_observation_count)===0))
    ||(value.source_preflight_policy_version!==POLICY && !(value.source_preflight_policy_version===null && value.state==="preflight"))
    ||(value.source_pages===null ? value.processing_fingerprint!==null : value.processing_fingerprint!==sha(full))
    ||(value.resource_name!==null&&value.resource_name!==`files/evo-${String(value.attempt_id).replaceAll("-","")}`)
    ||typeof value.state!=="string"||!["preflight","uploading","upload_unknown","file_processing","generating","result_saved","failed"].includes(value.state)
    ||typeof value.stage!=="string") fail();
  if(previous&&(value.job_id!==previous.job_id||value.attempt_id!==previous.attempt_id||value.claim_token!==previous.claim_token
    ||value.request_fingerprint!==previous.request_fingerprint)) fail("claim_unavailable");
  return {...value,config} as Claim;
}
function requireSupportedPolicy(claim:Claim):void {
  if(claim.request_identity.registry_version!=="evo-profile-61-v1"||claim.request_identity.schema_version!==1
    ||claim.request_identity.prompt_policy_version!=="extract-v1") fail("provider_not_configured");
}
function sourceIdentity(claim:Claim):DocumentRecognitionSourceIdentity {
  const source=claim.request_identity;
  return {attempt_id:claim.attempt_id,job_id:claim.job_id,organization_id:claim.organization_id,student_case_id:source.student_case_id,
    document_slot_id:source.source_document_slot_id,source_version_id:source.source_version_id,
    source_sha256:source.source_sha256,source_bytes:source.source_bytes,source_mime:source.source_mime};
}
function bindingFor(claim:Claim):DocumentRecognitionFileBinding {
  if(claim.source_pages===null||claim.processing_fingerprint===null) fail();
  return {name:`files/evo-${claim.attempt_id.replaceAll("-","")}`,sha256:claim.request_identity.source_sha256,
    bytes:claim.request_identity.source_bytes,mime_type:claim.request_identity.source_mime,page_count:claim.source_pages};
}
function observation(binding:DocumentRecognitionFileBinding, file?:DocumentRecognitionProviderFile, outcome="unknown") {
  return {outcome:file?"present":outcome,resource_name:binding.name,state:file?.state??null,sha256:file?.sha256??null,
    bytes:file?.bytes??null,mime_type:file?.mimeType??null};
}
function countMatches(receipt:unknown,binding:DocumentRecognitionFileBinding,config:DocumentRecognitionProviderConfig):boolean {
  return record(receipt)&&Object.keys(receipt).length===4&&receipt.model===config.model
    &&receipt.request_sha256===sha(`models/${config.model}\n${JSON.stringify(buildDocumentRecognitionGenerationRequest(binding,config))}`)
    &&receipt.config_sha256===sha(canonical({...config}))&&typeof receipt.input_tokens==="number"
    &&Number.isSafeInteger(receipt.input_tokens)&&receipt.input_tokens>0&&receipt.input_tokens<=config.inputTokenCeiling;
}
function heartbeat(claim:Claim,deps:DocumentRecognitionWorkerDependencies,signal:AbortSignal) {
  const stop=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let active:Promise<void>|undefined;
  const combined=AbortSignal.any([signal,stop.signal,AbortSignal.timeout(240_000)]);
  const schedule=()=>{timer=setTimeout(()=>{
    active=(async()=>{
      try {parseClaim(await deps.rpc("renew_document_recognition_lease",{p_attempt_id:claim.attempt_id,p_claim_token:claim.claim_token},combined),deps.now(),claim);}
      catch {stop.abort();}
      if(!combined.aborted)schedule();
    })();
  },15_000);};
  schedule();
  return {signal:combined,async close(){if(timer)clearTimeout(timer);stop.abort();await active;}};
}
function result(outcome:DocumentRecognitionTickResult["outcome"],claim:Claim|null,state:string|null,code:WorkerFailure|null=null):DocumentRecognitionTickResult {
  return {outcome,job_id:claim?.job_id??null,state,failure_code:code};
}
function settled(receipt:unknown,claim:Claim):DocumentRecognitionTickResult {
  const parsed=normalizeDocumentRecognitionReceipt(receipt);
  if(parsed.job_id!==claim.job_id)fail();
  return result("settled",claim,parsed.state);
}

/** Compose real dependencies only after the separately proven hard inspector is available. No default inspector/stub exists. */
export function createDocumentRecognitionWorkerDependencies(inspectSource:DocumentSourceInspector):DocumentRecognitionWorkerDependencies {
  const key=process.env.EVO_PLATFORM_GEMINI_API_KEY??"";
  if(!key||key.length>512||/\s/.test(key))throw new DocumentRecognitionProviderError("provider_not_configured");
  const client=createPlatformSupabaseServiceClient(getPlatformSupabaseBackendConfig());
  return {
    async rpc(name,parameters,signal){
      const response=await client.schema("platform").rpc(name,parameters).abortSignal(AbortSignal.any([signal,AbortSignal.timeout(15_000)]));
      if(response.error){
        const {code,message}=response.error;
        if(code==="42501")fail("access_revoked");
        if(code==="40001"&&["claim_unavailable","source_changed"].includes(message))fail(message as WorkerFailure);
        if(code==="54000"&&message==="budget_exhausted")fail("budget_exhausted");
        if(code==="22023"&&message==="document_not_eligible")fail("document_not_eligible");
        if(code==="55000"&&message==="provider_not_configured")fail("provider_not_configured");
        fail();
      }
      return response.data;
    },loadSource:loadDocumentRecognitionSource,inspectSource,providerFor:config=>createGeminiDocumentRecognition(key,config),
    pause:async(milliseconds,signal)=>{await pause(milliseconds,undefined,{signal});},now:Date.now,
  };
}

/** One bounded processing claim. Never calls generate twice or treats a lost RPC reply as permission to redispatch. */
export async function runDocumentRecognitionProcessingOnce(
  workerId:string,deps:DocumentRecognitionWorkerDependencies,signal:AbortSignal,
):Promise<DocumentRecognitionTickResult> {
  let claim:Claim|null=null;let lease:ReturnType<typeof heartbeat>|undefined;
  try{
    if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(workerId))fail();
    const raw=await deps.rpc("claim_document_recognition",{p_worker_id:workerId},signal);
    if(raw===null)return result("idle",null,null);
    claim=parseClaim(raw,deps.now());lease=heartbeat(claim,deps,signal);
    const activeSignal=lease.signal;
    const call=(name:string,extra:Record<string,unknown>={})=>deps.rpc(name,{p_attempt_id:claim!.attempt_id,p_claim_token:claim!.claim_token,...extra},activeSignal);
    const finish=async(code:DocumentRecognitionFailureCode)=>settled(await call(
      claim!.state==="preflight"?"finish_document_recognition_preflight":"finish_document_recognition",{p_failure_code:code}),claim!);
    // A durable saved result is published without touching the provider or source bytes.
    if(claim.state==="result_saved")return settled(await call("publish_document_recognition_proposals"),claim);
    requireSupportedPolicy(claim);
    const provider=deps.providerFor(claim.config);
    let activeFile:DocumentRecognitionProviderFile|undefined;
    if(claim.state==="preflight"){
      const loaded=await deps.loadSource(sourceIdentity(claim),claim.claim_token,{signal:activeSignal});
      const inspected=await deps.inspectSource({bytes:loaded.bytes,mimeType:claim.request_identity.source_mime,
        expectedSha256:claim.request_identity.source_sha256},{signal:activeSignal});
      activeSignal.throwIfAborted();
      if(inspected.status==="rejected")return await finish(inspected.code);
      if(inspected.policyVersion!==POLICY||inspected.sha256!==claim.request_identity.source_sha256
        ||inspected.byteLength!==claim.request_identity.source_bytes||inspected.mimeType!==claim.request_identity.source_mime
        ||!Number.isSafeInteger(inspected.pageCount)||inspected.pageCount<1
        ||inspected.pageCount>(inspected.mimeType==="application/pdf"?20:1)) return await finish("document_not_eligible");
      const processing=sha(canonicalDocumentRecognitionFingerprint({...claim.request_identity,source_pages:inspected.pageCount}));
      claim=parseClaim(await call("seal_document_recognition_preflight",{p_source_sha256:inspected.sha256,p_source_bytes:inspected.byteLength,
        p_source_mime:inspected.mimeType,p_source_pages:inspected.pageCount,p_processing_fingerprint:processing,p_preflight_policy_version:POLICY}),deps.now(),claim);
      const binding=bindingFor(claim);
      const intent=await call("begin_document_recognition_upload");
      if(!record(intent)||Object.keys(intent).length!==2||typeof intent.dispatch!=="boolean"||intent.resource_name!==binding.name)fail();
      // Persisted intent could have committed even if its reply was lost. False means GET only.
      claim={...claim,state:"uploading",resource_name:binding.name};
      if(intent.dispatch){
        const uploaded=await provider.upload(binding,loaded.bytes,activeSignal);
        if(uploaded.outcome==="uploaded")activeFile=uploaded.file;
        claim=parseClaim(await call("observe_document_recognition_file",{p_observation:observation(binding,activeFile)}),deps.now(),claim);
      }
    }
    const binding=bindingFor(claim);
    if(!activeFile&&claim.provider_file_state==="ACTIVE"){
      // Reuse the exact metadata already verified and persisted by observe.
      // This is not a fresh GET or an assertion that the provider cannot expire it.
      activeFile={name:binding.name,uri:`https://generativelanguage.googleapis.com/v1beta/${binding.name}`,state:"ACTIVE",
        sha256:binding.sha256,bytes:binding.bytes,mimeType:binding.mime_type,expirationTime:null};
    }
    const pollStart=deps.now();
    const pollSignal=AbortSignal.any([activeSignal,AbortSignal.timeout(60_000)]);
    // SQL also bounds observations across restarts; this loop never resets it.
    for(let count=0;!activeFile||activeFile.state!=="ACTIVE";count++){
      if(claim.state==="failed")return result("settled",claim,"failed");
      if(claim.provider_observation_count>=5||count>=4||deps.now()-pollStart>=60_000||pollSignal.aborted)return result("deferred",claim,claim.state);
      if(count>0)await deps.pause(10_000,pollSignal);
      const checked=await provider.inspect(binding,pollSignal);
      activeFile=checked.outcome==="found"?checked.file:undefined;
      claim=parseClaim(await call("observe_document_recognition_file",{
        p_observation:observation(binding,activeFile,checked.outcome==="not_found"?"not_found":"unknown"),
      }),deps.now(),claim);
    }
    if(claim.state!=="file_processing")return result("deferred",claim,claim.state);
    if(claim.token_count_receipt===null){
      const counted=await provider.countTokens(binding,activeFile,activeSignal);
      if(counted.outcome!=="counted")return await finish(counted.outcome==="input_limit_exceeded"?"document_not_eligible"
        :counted.outcome==="provider_rejected"?"provider_rejected":"provider_unavailable");
      if(!countMatches(counted.receipt,binding,claim.config))return await finish("provider_unavailable");
      claim=parseClaim(await call("record_document_recognition_token_count",{p_receipt:counted.receipt}),deps.now(),claim);
    }
    if(!countMatches(claim.token_count_receipt,binding,claim.config))return await finish("provider_unavailable");
    const intent=await call("begin_document_recognition_generation",{p_receipt:claim.token_count_receipt});
    if(!record(intent)||Object.keys(intent).length!==1||typeof intent.dispatch!=="boolean")fail();
    if(!intent.dispatch)return result("deferred",claim,claim.state);
    claim={...claim,state:"generating"};
    const generated=await provider.generate(binding,activeFile,claim.token_count_receipt,activeSignal);
    if(generated.outcome!=="generated")return await finish(generated.outcome);
    const text=JSON.stringify(generated.result);
    const saved=normalizeDocumentRecognitionReceipt(await call("record_document_recognition_result",{
      p_result_text:text,p_result_sha256:sha(text),p_response_id:generated.responseId,
      p_model_version:generated.modelVersion,p_usage:generated.usage}));
    if(saved.job_id!==claim.job_id||saved.state!=="result_saved")fail();
    claim={...claim,state:"result_saved"};
    return settled(await call("publish_document_recognition_proposals"),claim);
  }catch(error){
    const code=error instanceof WorkflowError||error instanceof DocumentRecognitionSourceError||error instanceof DocumentRecognitionProviderError
      ?error.code:"workflow_unavailable";
    const terminal:DocumentRecognitionFailureCode[]=["access_revoked","source_changed","source_unavailable","document_not_eligible","provider_not_configured","budget_exhausted"];
    if(claim&&terminal.includes(code as DocumentRecognitionFailureCode)&&!lease?.signal.aborted){
      try{return settled(await deps.rpc(claim.state==="preflight"?"finish_document_recognition_preflight":"finish_document_recognition",
        {p_attempt_id:claim.attempt_id,p_claim_token:claim.claim_token,p_failure_code:code},lease?.signal??signal),claim);}catch{/* Uncertain RPC outcome is reconciled by a later fenced claim. */}
    }
    return result(claim?"deferred":"unavailable",claim,claim?.state??null,
      code==="token_count_required"?"workflow_unavailable":code as WorkerFailure);
  }finally{await lease?.close();}
}

type CleanupClaim = Readonly<{
  attempt_id: string; cleanup_token: string; resource_name: string; project_id: string;
  config: DocumentRecognitionProviderConfig; sha256: string; bytes: number;
  mime_type: DocumentRecognitionFileBinding["mime_type"]; source_pages: number; lease_until: string;
}>;
export type DocumentRecognitionCleanupTickResult = Readonly<{
  outcome: "idle" | "settled" | "deferred" | "unavailable";
  attempt_id: string | null;
  cleanup_state: "pending" | "deleting" | "confirmed_absent" | "unknown" | null;
  failure_code: WorkerFailure | null;
}>;
function parseCleanupClaim(value: unknown, now: number): CleanupClaim {
  const keys = ["attempt_id", "cleanup_token", "resource_name", "project_id", "config", "sha256",
    "bytes", "mime_type", "source_pages", "lease_until"];
  if (!record(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))
    || typeof value.attempt_id !== "string" || !UUID.test(value.attempt_id)
    || typeof value.cleanup_token !== "string" || !UUID.test(value.cleanup_token)
    || value.resource_name !== `files/evo-${value.attempt_id.replaceAll("-", "")}`
    || typeof value.sha256 !== "string" || !SHA.test(value.sha256)
    || typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 25 * 1024 * 1024
    || !["application/pdf", "image/jpeg", "image/png"].includes(String(value.mime_type))
    || typeof value.source_pages !== "number" || !Number.isSafeInteger(value.source_pages) || value.source_pages < 1
    || value.source_pages > (value.mime_type === "application/pdf" ? 20 : 1)
    || typeof value.lease_until !== "string" || !Number.isFinite(Date.parse(value.lease_until))
    || Date.parse(value.lease_until) <= now) fail();
  const config = parseDocumentRecognitionProviderConfig(value.config);
  if (value.project_id !== config.projectId) fail();
  return { ...value, config } as CleanupClaim;
}
function parseCleanupReceipt(value: unknown): NonNullable<DocumentRecognitionCleanupTickResult["cleanup_state"]> {
  if (!record(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "cleanup_state")
    || !(value.cleanup_state === "pending" || value.cleanup_state === "deleting"
      || value.cleanup_state === "confirmed_absent" || value.cleanup_state === "unknown")) fail();
  return value.cleanup_state;
}

/** Reconcile one persisted owned name. DELETE acknowledgement is never an absence proof. */
export async function runDocumentRecognitionCleanupOnce(
  workerId: string,
  deps: Pick<DocumentRecognitionWorkerDependencies, "rpc" | "providerFor" | "now">,
  signal: AbortSignal,
): Promise<DocumentRecognitionCleanupTickResult> {
  let claim: CleanupClaim | null = null;
  let state: DocumentRecognitionCleanupTickResult["cleanup_state"] = null;
  const outcome = (failure_code: WorkerFailure | null = null): DocumentRecognitionCleanupTickResult => ({
    outcome: failure_code ? (claim ? "deferred" : "unavailable")
      : state === "confirmed_absent" ? "settled" : claim ? "deferred" : "idle",
    attempt_id: claim?.attempt_id ?? null, cleanup_state: state, failure_code,
  });
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(workerId)) fail();
    const raw = await deps.rpc("claim_document_recognition_cleanup", { p_worker_id: workerId }, signal);
    if (raw === null) return outcome();
    claim = parseCleanupClaim(raw, deps.now());
    state = "pending";
    // Leave ten seconds before the persisted lease expires; no unbounded retry
    // or detached cleanup promise survives this tick.
    const remaining = Math.min(80_000, Date.parse(claim.lease_until) - deps.now() - 10_000);
    if (remaining <= 0) return outcome("claim_unavailable");
    const activeSignal = AbortSignal.any([signal, AbortSignal.timeout(remaining)]);
    const provider = deps.providerFor(claim.config);
    const binding: DocumentRecognitionFileBinding = { name: claim.resource_name, sha256: claim.sha256,
      bytes: claim.bytes, mime_type: claim.mime_type, page_count: claim.source_pages };
    const call = (name: string, extra: Record<string, unknown>) => deps.rpc(name, {
      p_attempt_id: claim!.attempt_id, p_cleanup_token: claim!.cleanup_token, ...extra,
    }, activeSignal);
    const recordObservation = async (file?: DocumentRecognitionProviderFile, observed = "unknown") => {
      state = parseCleanupReceipt(await call("record_document_recognition_cleanup", {
        p_observation: observation(binding, file, observed),
      }));
    };
    const initial = await provider.inspect(binding, activeSignal);
    await recordObservation(initial.outcome === "found" ? initial.file : undefined,
      initial.outcome === "not_found" ? "not_found" : "unknown");
    if (initial.outcome !== "found") return outcome();

    const intent = await call("begin_document_recognition_delete", { p_resource_name: binding.name });
    if (!record(intent) || Object.keys(intent).length !== 1 || typeof intent.dispatch !== "boolean") fail();
    if (intent.dispatch) {
      const removed = await provider.remove(binding, activeSignal);
      // A DELETE404 still requires a separate GET, just like an acknowledgement.
      if (removed.outcome === "acknowledged") await recordObservation(undefined, "delete_acknowledged");
      else if (removed.outcome === "unknown") {
        await recordObservation(undefined, "unknown");
        return outcome();
      }
    }
    const checked = await provider.inspect(binding, activeSignal);
    await recordObservation(checked.outcome === "found" ? checked.file : undefined,
      checked.outcome === "not_found" ? "not_found" : "unknown");
    return outcome();
  } catch (error) {
    const code = error instanceof WorkflowError || error instanceof DocumentRecognitionProviderError
      ? error.code : "workflow_unavailable";
    return outcome(code === "token_count_required" ? "workflow_unavailable" : code);
  }
}
