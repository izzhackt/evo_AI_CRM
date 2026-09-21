import assert from "node:assert/strict";
import test from "node:test";
import { parseStaffUniversityCountries as parse, staffUniversityCountryOptions as options } from "../src/lib/university-staff-countries.ts";

// Pure DTO examples, never published records or actual database/UI evidence.
const org = "11111111-1111-4111-8111-111111111111";
const response = (countries) => ({ organizationId: org, countries });

test("accepts complete ordered facets including an empty successful catalogue", () => {
  assert.deepEqual(parse(response([]), org), response([]));
  assert.deepEqual(parse(response(["AE", "CN", "MY"]), org), response(["AE", "CN", "MY"]));
});

test("rejects a different tenant, malformed tenant and unexpected envelope fields", () => {
  const countries = ["CN"];
  assert.equal(parse(response(countries), "22222222-2222-4222-8222-222222222222"), null);
  assert.equal(parse({ organizationId: "wrong", countries }, "wrong"), null);
  for (const value of [null, [], "CN", { countries }, { organizationId: org }, { ...response(countries), items: [] }]) {
    assert.equal(parse(value, org), null);
  }
});

test("fails closed on malformed, duplicate or unsorted country data", () => {
  for (const countries of [null, "CN", {}, [null], [1], ["cn"], ["CHN"], ["C"], [" CN"], ["CN\n"], ["CN", "CN"], ["MY", "CN"]]) {
    assert.equal(parse(response(countries), org), null);
  }
});

test("retains the publication validator's full two-letter domain without a page limit", () => {
  const codes = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
  const countries = codes.flatMap((a) => codes.map((b) => a + b));
  assert.equal(countries.length, 676);
  assert.deepEqual(parse(response(countries), org), response(countries));
  assert.equal(parse(response([...countries, "ZZ"]), org), null);
  assert.deepEqual(parse(response(["XX"]), org), response(["XX"]));
});

test("copies the accepted array so later input mutation cannot change the facet", () => {
  const value = response(["CN"]), parsed = parse(value, org);
  value.countries.push("MY");
  assert.deepEqual(parsed.countries, ["CN"]);
});

test("keeps the selected absent country explicit without adding unrelated options", () => {
  assert.deepEqual(options(["CN"], "MY"), [{ code: "CN", unavailable: false }, { code: "MY", unavailable: true }]);
  assert.deepEqual(options([], "MY"), [{ code: "MY", unavailable: true }]);
  assert.deepEqual(options([], ""), []);
  assert.deepEqual(options(["CN"], "CN"), [{ code: "CN", unavailable: false }]);
});

test("preserves the complete facet independently of a current page or search result", () => {
  const countries = Object.freeze(["AE", "CN", "MY"]);
  assert.deepEqual(options(countries, "CN").map(({ code }) => code), countries);
  assert.deepEqual(options(countries, "").map(({ code }) => code), countries);
  assert.deepEqual(countries, ["AE", "CN", "MY"]);
});
