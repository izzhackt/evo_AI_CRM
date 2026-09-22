import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, isValidElement } from "react";
import ts from "typescript";

import { getPortalStrings } from "../src/lib/portal/i18n.ts";

const source = ts.createSourceFile("AssessmentRunner.tsx", readFileSync(
  new URL("../src/components/portal/tests/AssessmentRunner.tsx", import.meta.url), "utf8",
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function nodes(predicate, root = source) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

function declaration(name) {
  const found = nodes(node => (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node))
    && node.name?.getText(source) === name);
  assert.equal(found.length, 1, `one ${name} declaration`);
  return found[0];
}

// Execute the actual local expression/handler only. Operation counters are
// not RPC replacements, a mounted browser component or Student acceptance.
function evaluate(node, scope = {}) {
  const { outputText } = ts.transpileModule(`const value = (${node.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "createElement" },
  });
  return new Function(...Object.keys(scope), `${outputText}\nreturn value;`)(...Object.values(scope));
}

function elements(element) {
  if (!isValidElement(element)) return [];
  const children = [element.props.children].flat(Infinity);
  return [element, ...children.flatMap(elements)];
}

function notice(error, busy = false) {
  const calls = [];
  const strings = getPortalStrings("tests", "ru");
  const tree = evaluate(declaration("errorNotice").initializer, {
    createElement, error, busy, exitNotice: false, attempt: { status: "draft" }, strings,
    reloadRequired: error?.code === "conflict" || error?.operation === "reload",
    loadLatest: () => calls.push("reload"),
    write: (...args) => calls.push(["write", ...args]),
  });
  return { calls, strings, tree, buttons: elements(tree).filter(element => element.type === "button") };
}

function failureArguments(name) {
  return nodes(node => ts.isCallExpression(node) && node.expression.getText(source) === "setError"
    && node.arguments[0]?.kind !== ts.SyntaxKind.NullKeyword, declaration(name))
    .map(node => node.arguments[0]);
}

test("returned and thrown read failures offer only another confirmed read", () => {
  const failures = failureArguments("loadLatest");
  assert.equal(failures.length, 2);
  for (const failure of failures) {
    const unavailable = { ok: false, code: "unavailable", message: "" };
    const error = evaluate(failure, { response: unavailable, NETWORK_ERROR: unavailable });
    const { calls, buttons, strings } = notice(error);
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].props.children, strings.loadSaved);
    buttons[0].props.onClick();
    assert.deepEqual(calls, ["reload"]);
    assert.equal(error.operation, "reload");
  }
});

test("save retry retains write routing and never supplies a new completion mode", () => {
  const { calls, buttons, strings } = notice({ code: "unavailable", operation: "write" });
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.children, strings.retrySave);
  buttons[0].props.onClick();
  assert.deepEqual(calls, [["write"]]);
  const request = declaration("request").initializer;
  for (const complete of [false, true]) {
    const pendingRequest = { complete, input: { requestId: "retained", expectedRevision: 2, answers: { a: "original" } } };
    assert.equal(evaluate(request, { pending: { current: pendingRequest }, complete: false }), pendingRequest);
  }
});

test("retry has no write fallback for missing or unrelated operation", () => {
  for (const operation of [undefined, null, "start"]) {
    assert.equal(notice({ code: "unavailable", operation }).buttons.length, 0);
  }
  const conflict = notice({ code: "conflict", operation: "write" });
  conflict.buttons[0].props.onClick();
  assert.deepEqual(conflict.calls, ["reload"]);
  assert.equal(notice({ code: "unavailable", operation: "reload" }, true).buttons[0].props.disabled, true);
});

test("busy or cancelled reload does not change local state or issue a read", async () => {
  for (const busy of [false, true]) {
    let confirmations = 0;
    const attempt = { attemptId: "retained-attempt" };
    const busyRef = { current: busy };
    const attemptRef = { current: attempt };
    const load = evaluate(declaration("loadLatest"), {
      busyRef, attemptRef, strings: { confirmReload: "confirm" },
      window: { confirm: () => { confirmations += 1; return false; } },
      // No action or setters are supplied: reaching either is a failure.
    });
    await load();
    assert.equal(confirmations, busy ? 0 : 1);
    assert.equal(busyRef.current, busy);
    assert.equal(attemptRef.current, attempt);
  }
});

test("failed reload keeps answer editing and save-and-exit blocked", async () => {
  const error = { code: "unavailable", operation: "reload" };
  const reloadRequired = evaluate(declaration("reloadRequired").initializer, { error });
  assert.equal(reloadRequired, true);
  assert.equal(evaluate(declaration("reloadRequired").initializer, { error: null }), false);

  const select = evaluate(declaration("select"), { pending: { current: null }, reloadRequired });
  select("answer", "unchanged"); // Missing setters must never be reached.
  const pause = evaluate(declaration("pause"), {
    busyRef: { current: false }, reloadRequired, error,
  });
  await pause(); // Missing write/router must never be reached.

  const question = nodes(node => ts.isJsxSelfClosingElement(node)
    && node.tagName.getText(source) === "AssessmentQuestion")[0];
  const saveExit = nodes(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button"
    && node.children.some(child => ts.isJsxExpression(child) && child.expression?.getText(source) === "strings.saveAndExit"))[0];
  for (const opening of [question, saveExit.openingElement]) {
    const disabled = opening.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.text === "disabled");
    assert.equal(evaluate(disabled.initializer.expression, { busy: false, completing: false, reloadRequired, error }), true);
  }
});

test("start and write failures retain their own operation", () => {
  for (const [name, operation] of [["start", "start"], ["write", "write"]]) {
    const failures = failureArguments(name);
    assert.equal(failures.length, 2);
    for (const failure of failures) {
      const unavailable = { ok: false, code: "unavailable", message: "" };
      assert.equal(evaluate(failure, { response: unavailable, NETWORK_ERROR: unavailable }).operation, operation);
    }
  }
});

test("read failure uses loading-specific RU and KY copy", () => {
  for (const locale of ["ru", "ky"]) {
    const strings = getPortalStrings("tests", locale);
    for (const key of ["reloadUnavailable", "statusLoadingSaved", "reloadBeforeExit"]) {
      assert.equal(typeof strings[key], "string");
      assert.ok(strings[key].trim());
    }
  }
  const { tree, strings } = notice({ code: "unavailable", operation: "reload" });
  const paragraphs = elements(tree).filter(element => element.type === "p");
  assert.equal(paragraphs[0].props.children, strings.reloadUnavailable);
});
