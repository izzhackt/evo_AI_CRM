import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDENT_SIGNUP_CONFIRMATION_PATH, STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE,
  STUDENT_SIGNUP_CONFIRMATION_MAX_ENVELOPE_LENGTH,
  isStudentSignupConfirmationEnvelope, parseStudentSignupConfirmationFragment,
  studentSignupConfirmationUrl, validateStudentSignupConfirmationPost,
} from "../src/lib/student-signup-confirmation-contract.ts";
import { studentInviteCallbackUrl } from "../src/lib/student-invite-callback-contract.ts";

const cap = `v1.${Buffer.alloc(12, 1).toString("base64url")}.${Buffer.from("opaque").toString("base64url")}.${Buffer.alloc(16, 2).toString("base64url")}`;
const csrf = "76f045de-e194-4ff2-9852-969fadf615b5";
const form = (otp = "12345678") => [["cap", cap], ["otp", otp], ["csrf_token", csrf]];
const input = () => ({ nodeEnv: "development", localCallbackOrigin: "http://127.0.0.1:31457",
  origin: "http://127.0.0.1:31457", host: "127.0.0.1:31457", forwardedHost: null, forwardedProto: null,
  csrfCookie: csrf, form: form(), expectedOtpLength: 8 });

test("canonical envelope syntax is bounded and makes no authentication assertion", () => {
  assert.equal(STUDENT_SIGNUP_CONFIRMATION_MAX_ENVELOPE_LENGTH, 4096);
  assert.ok(isStudentSignupConfirmationEnvelope(cap));
  const [v,n,,t] = cap.split(".");
  for (const bad of [null, {}, "", cap+"\n", cap+"=", cap+".x", cap.replace("v1", "v2"),
    `${v}.${n}.A.${t}`, `${v}.${n}.AB.${t}`, `${v}.${n}.AAB.${t}`, `${v}.${n}.AA.${t.slice(0,-1)}B`,
    `${v}.${n.slice(1)}.AA.${t}`, `${v}.${n}..${t}`, `${v}.${n}.AA+.${t}`, "x".repeat(4097)]) {
    assert.equal(isStudentSignupConfirmationEnvelope(bad), false);
  }
  for (const ciphertext of ["AA", "AAA", "AAAA"]) assert.ok(isStudentSignupConfirmationEnvelope(`${v}.${n}.${ciphertext}.${t}`));
});

test("raw fragment accepts exactly one cap and bounded decimal OTP in either order", () => {
  assert.deepEqual(parseStudentSignupConfirmationFragment(`#cap=${cap}&otp=00000001`), {cap,otp:"00000001"});
  assert.deepEqual(parseStudentSignupConfirmationFragment(`#otp=1&cap=${cap}`), {cap,otp:"1"});
  assert.ok(parseStudentSignupConfirmationFragment(`#cap=${cap}&otp=${"9".repeat(32)}`));
  for (const bad of [null, `cap=${cap}&otp=123`, `#cap=${cap}`, `#cap=${cap}&cap=${cap}`,
    `#cap=${cap}&otp=1&otp=2`, `#cap=${cap}&otp=1&extra=x`, `#cap=${cap}&otp=`,
    `#cap=${cap}&otp=${"1".repeat(33)}`, `#cap=${cap}&otp=１２３`, `#cap=${cap}&otp=1\n`,
    `#cap=${cap}&otp=%31`, `#%63ap=${cap}&otp=1`, `#cap=${cap.replace(".", "%2E")}&otp=1`,
    `#cap=${cap}&otp=+1`, `#cap=${cap}&otp=1=2`, `#cap=${cap}&otp=1#x`]) assert.equal(parseStudentSignupConfirmationFragment(bad), null);
});

test("POST preserves duplicate detection and requires configured OTP length", () => {
  assert.deepEqual(validateStudentSignupConfirmationPost(input()), {cap,otp:"12345678"});
  for (const length of [1,6,8,32]) assert.ok(validateStudentSignupConfirmationPost({...input(),expectedOtpLength:length,form:form("1".repeat(length))}));
  for (const length of [undefined,null,0,33,1.5,NaN,Infinity,"8",6]) assert.equal(validateStudentSignupConfirmationPost({...input(),expectedOtpLength:length}),null);
  for (const fields of [form().slice(1), [...form(),["otp","12345678"]], [...form(),["cap",cap]],
    [...form(),["csrf_token",csrf]], [...form(),["email","x"]], [["cap",{}],...form().slice(1)],
    [...form().slice(0,2),["csrf_token",csrf.toUpperCase()]], [["cap",cap,"extra"],...form().slice(1)]]) {
    assert.equal(validateStudentSignupConfirmationPost({...input(),form:fields}),null);
  }
  const fd = new FormData(); for (const [k,v] of form()) fd.append(k,v);
  assert.ok(validateStudentSignupConfirmationPost({...input(),form:fd.entries()}));
  fd.append("cap",cap); assert.equal(validateStudentSignupConfirmationPost({...input(),form:fd.entries()}),null);
  assert.equal(validateStudentSignupConfirmationPost({...input(),csrfCookie:null}),null);
  assert.equal(validateStudentSignupConfirmationPost({...input(),csrfCookie:"86f045de-e194-4ff2-9852-969fadf615b5"}),null);
});

test("origin and forwarded pairs must match the configured callback authority", () => {
  for (const patch of [{origin:null},{origin:"https://evil.example"},{origin:input().origin+"/"},
    {host:"evil.example"},{host:input().host+",evil.example"},{forwardedHost:input().host},
    {forwardedProto:"http"},{forwardedHost:input().host,forwardedProto:"https"},
    {forwardedHost:"evil.example",forwardedProto:"http"},{forwardedHost:input().host+" ",forwardedProto:"http"},
    {localCallbackOrigin:"http://localhost:31457"}]) assert.equal(validateStudentSignupConfirmationPost({...input(),...patch}),null);
  assert.ok(validateStudentSignupConfirmationPost({...input(),host:"internal:3000",forwardedHost:input().host,forwardedProto:"http"}));
});

test("separate fixed URL inherits the existing invite origin and production override", () => {
  assert.equal(STUDENT_SIGNUP_CONFIRMATION_PATH,"/auth/signup-confirmation");
  assert.notEqual(STUDENT_SIGNUP_CONFIRMATION_CSRF_COOKIE,"evo_student_invite_csrf");
  assert.equal(studentSignupConfirmationUrl("development",input().origin),input().origin+STUDENT_SIGNUP_CONFIRMATION_PATH);
  assert.equal(studentSignupConfirmationUrl("production","https://evil.example"),new URL(studentInviteCallbackUrl("production")).origin+STUDENT_SIGNUP_CONFIRMATION_PATH);
});
