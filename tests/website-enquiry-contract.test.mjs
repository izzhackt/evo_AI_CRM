import assert from "node:assert/strict";
import test from "node:test";
import { parseWebsiteEnquiryUniversity, WEBSITE_ENQUIRY_COUNTRIES } from "../src/lib/website-enquiry-contract.ts";

test("undecided has its own accepted country value", () => {
  assert.ok(WEBSITE_ENQUIRY_COUNTRIES.has("Undecided"));
  assert.ok(WEBSITE_ENQUIRY_COUNTRIES.has("Malaysia"));
  assert.equal(WEBSITE_ENQUIRY_COUNTRIES.has("OTHER"), false);
  assert.equal(WEBSITE_ENQUIRY_COUNTRIES.has(""), false);
});

test("optional university context preserves old forms and bounds visitor input", () => {
  assert.equal(parseWebsiteEnquiryUniversity(undefined), null);
  assert.equal(parseWebsiteEnquiryUniversity(null), null);
  assert.deepEqual(parseWebsiteEnquiryUniversity({ slug: "apu", name: "  Asia Pacific University  " }), {
    slug: "apu", name: "Asia Pacific University",
  });
  assert.deepEqual(parseWebsiteEnquiryUniversity({ slug: "apu", name: "Азиатско-Тихоокеанский университет" }), {
    slug: "apu", name: "Азиатско-Тихоокеанский университет",
  });
  for (const invalid of [
    [], "apu", {}, { slug: "apu" }, { slug: "apu", name: "APU", url: "https://apu.edu.my" },
    { slug: "../apu", name: "APU" }, { slug: "a".repeat(121), name: "APU" },
    { slug: "apu", name: " " }, { slug: "apu", name: "A".repeat(301) },
    { slug: "apu", name: "APU\nMalaysia" }, { slug: "apu", name: 7 },
  ]) assert.throws(() => parseWebsiteEnquiryUniversity(invalid), /Invalid website university/);
});
