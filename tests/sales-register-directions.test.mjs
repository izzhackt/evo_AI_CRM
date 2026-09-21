import assert from "node:assert/strict";
import test from "node:test";
import { parseSalesRegisterDirection, parseSalesRegisterDirections, salesDirectionControl } from "../src/lib/sales-register-directions.ts";

const org = "11111111-1111-4111-8111-111111111111";
const dto = directions => ({ organization_id: org, directions });

test("direction queries preserve exact stored identity and count Unicode code points", () => {
  for (const value of ["", "  Турция / STEM  ", "unknown", "é", "e\u0301", "😀".repeat(500), "я".repeat(500)]) {
    assert.equal(parseSalesRegisterDirection(value), value);
  }
  assert.equal(parseSalesRegisterDirection(undefined), "");
  assert.equal(parseSalesRegisterDirection(null), "");
  for (const value of ["😀".repeat(501), "я".repeat(501), "a\nb", "a\tb", "a\0b", "a\x7fb", "\ud800", "\udc00", [], {}, 42, false]) {
    assert.equal(parseSalesRegisterDirection(value), null);
  }
});

test("directions DTO is tenant-bound and separate from the existing report", () => {
  assert.deepEqual(parseSalesRegisterDirections(dto([]), org), []);
  for (const value of [null, [], {}, { directions: [] }, { organization_id: org },
    { ...dto([]), total_count: 0 }, { ...dto([]), organization_id: "22222222-2222-4222-8222-222222222222" },
    dto(null), dto("Китай"), dto([null]), dto([1]), dto([{}]), dto([""]), dto(["a\nb"])]) {
    assert.throws(() => parseSalesRegisterDirections(value, org), /unavailable/);
  }
});

test("directions retain case, spacing and composed forms without deduplication or coercion", () => {
  const values = [" Китай", "Китай", "китай", "é", "e\u0301", "unknown", " "];
  assert.deepEqual(parseSalesRegisterDirections(dto(values), org), values);
  assert.throws(() => parseSalesRegisterDirections(dto(["Китай", "Китай"]), org), /unavailable/);
  assert.throws(() => parseSalesRegisterDirections(dto(["😀".repeat(501)]), org), /unavailable/);
});

test("overflow never becomes a silently truncated successful list", () => {
  const values = Array.from({ length: 1000 }, (_, i) => `Направление ${i}`);
  assert.deepEqual(parseSalesRegisterDirections(dto(values), org), values);
  assert.throws(() => parseSalesRegisterDirections(dto([...values, "Последнее"]), org), /unavailable/);
});

test("selected direction stays exact even when absent from the available options", () => {
  const current = "  Из прежней ссылки  ";
  const result = salesDirectionControl(["Китай", "unknown"], current);
  assert.equal(result.kind, "select");
  assert.equal(result.value, current);
  assert.deepEqual(result.options.map(option => option.value), ["", current, "Китай", "unknown"]);
  assert.equal(result.options[1].label, `Из текущего фильтра: ${current}`);
  assert.equal(salesDirectionControl([current], current).options.length, 2);
});

test("ready-empty and failed options have distinct states and retain the filter", () => {
  const empty = salesDirectionControl([], "Китай");
  assert.equal(empty.kind, "select");
  assert.equal(empty.empty, true);
  assert.equal(empty.value, "Китай");
  assert.deepEqual(empty.options.map(option => option.value), ["", "Китай"]);
  assert.deepEqual(salesDirectionControl(null, "Китай"), { kind: "input", value: "Китай", reason: "unavailable" });
  assert.deepEqual(salesDirectionControl([], undefined).options, [{ value: "", label: "Все" }]);
});

test("invalid current URL values remain editable and are never truncated into another query", () => {
  for (const current of ["я".repeat(501), "first\nsecond"]) {
    assert.deepEqual(salesDirectionControl(["Китай"], current), { kind: "input", value: current, reason: "invalid" });
  }
});
