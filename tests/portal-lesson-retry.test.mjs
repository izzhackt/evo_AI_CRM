import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("LessonRunner.tsx", readFileSync(
  new URL("../src/components/portal/english/LessonRunner.tsx", import.meta.url), "utf8",
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

function namedFunction(name) {
  const matches = nodes(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(matches.length, 1, `one ${name} declaration`);
  return matches[0];
}

const retryButtons = nodes(node => ts.isJsxElement(node)
  && node.openingElement.tagName.getText(source) === "button"
  && node.children.some(child => ts.isJsxExpression(child)
    && child.expression?.getText(source) === "strings.retry"));
assert.equal(retryButtons.length, 1);
const retryExpression = retryButtons[0].openingElement.attributes.properties
  .find(attribute => ts.isJsxAttribute(attribute) && attribute.name.text === "onClick")
  ?.initializer?.expression;
assert.ok(retryExpression);
const retryNode = ts.isIdentifier(retryExpression)
  ? namedFunction(retryExpression.text) : retryExpression;

// Execute the actual local event callback only. The operation counters below
// are not RPC/service replacements, a rendered component or Student evidence.
function callback(node, scope) {
  const { outputText } = ts.transpileModule(`const handler = (${node.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  });
  return new Function(...Object.keys(scope), `${outputText}\nreturn handler;`)(...Object.values(scope));
}

function context(currentEntry) {
  const calls = [];
  const scope = {
    failedOperation: { current: "reload" },
    busyRef: { current: false },
    attempt: { revision: 2 },
    current: { type: "choice" },
    currentEntry,
    start: () => calls.push("start"),
    submitAnswer: () => calls.push("answer"),
    complete: () => calls.push("complete"),
    reloadDraft: () => calls.push("reload"),
  };
  return { scope, calls, retry: callback(retryNode, scope) };
}

for (const [name, entry] of [["unanswered", undefined], ["answered", { answer: "retained" }]]) {
  test(`reload retry keeps its operation with an ${name} exercise`, () => {
    const { retry, calls } = context(entry);
    retry();
    assert.deepEqual(calls, ["reload"]);
  });
}

test("retry selects only its recorded operation and has no inferred fallback", () => {
  for (const operation of ["start", "answer", "complete", "reload", null]) {
    const { scope, retry, calls } = context(undefined);
    scope.failedOperation.current = operation;
    retry();
    assert.deepEqual(calls, operation === null ? [] : [operation]);
  }
});

test("retry cannot select another operation while a request is busy", () => {
  const { scope, retry, calls } = context(undefined);
  scope.busyRef.current = true;
  retry();
  assert.deepEqual(calls, []);
});

test("both reload failure branches record reload before showing the error", () => {
  const reload = namedFunction("reloadDraft");
  const reports = nodes(node => ts.isCallExpression(node)
    && node.expression.getText(source) === "reportFailure", reload);
  assert.deepEqual(reports.map(node => node.arguments.map(arg => arg.getText(source))), [
    ["response.code", '"reload"'],
    ['"unavailable"', '"reload"'],
  ]);
  const { scope, retry, calls } = context(undefined);
  scope.failedOperation.current = null;
  const report = callback(namedFunction("reportFailure"), {
    failedOperation: scope.failedOperation,
    setError: code => {
      assert.equal(code, "unavailable");
      assert.equal(scope.failedOperation.current, "reload");
    },
  });
  report("unavailable", "reload");
  retry();
  assert.deepEqual(calls, ["reload"]);
});
