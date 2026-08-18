const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SEAMS = Object.freeze([
  "lead_agent_ingress",
  "manual_send_claim",
  "waha_dispatch",
  "audit_reconciliation",
  "operator_state",
]);

function fail() {
  throw new Error("P8V V1 core evidence violates the closed contract.");
}

function exactKeys(value, keys) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) {
    fail();
  }
}

export function validateP8VV1CoreResult(value) {
  exactKeys(value, [
    "version",
    "generated_at",
    "result_code",
    "failed_seam",
    "source",
    "seams",
  ]);
  if (
    value.version !== "p8v-v1-core-result/v1" ||
    !["core_verified", "core_failed", "evidence_failed"].includes(
      value.result_code,
    ) ||
    typeof value.generated_at !== "string" ||
    !UTC_TIMESTAMP.test(value.generated_at) ||
    Number.isNaN(Date.parse(value.generated_at))
  ) {
    fail();
  }
  exactKeys(value.source, ["commit", "tree", "ci_run_id"]);
  if (
    !SHA40.test(value.source.commit) ||
    !SHA40.test(value.source.tree) ||
    !Number.isSafeInteger(value.source.ci_run_id) ||
    value.source.ci_run_id < 1 ||
    !Array.isArray(value.seams) ||
    value.seams.length !== SEAMS.length
  ) {
    fail();
  }

  let failedIndex = -1;
  for (const [index, record] of value.seams.entries()) {
    exactKeys(record, ["name", "status", "evidence_sha256"]);
    if (
      record.name !== SEAMS[index] ||
      !["verified", "failed", "not_run"].includes(record.status) ||
      (record.status === "not_run"
        ? record.evidence_sha256 !== null
        : !SHA64.test(record.evidence_sha256))
    ) {
      fail();
    }
    if (record.status === "failed") {
      if (failedIndex !== -1) fail();
      failedIndex = index;
    }
  }

  if (value.result_code === "core_verified") {
    if (
      value.failed_seam !== null ||
      value.seams.some((record) => record.status !== "verified")
    ) {
      fail();
    }
  } else if (value.result_code === "core_failed") {
    if (
      failedIndex === -1 ||
      value.failed_seam !== SEAMS[failedIndex] ||
      value.seams.some((record, index) =>
        index < failedIndex
          ? record.status !== "verified"
          : index === failedIndex
            ? record.status !== "failed"
            : record.status !== "not_run",
      )
    ) {
      fail();
    }
  } else if (
    value.failed_seam !== "evidence" ||
    value.seams.some((record) => record.status !== "verified")
  ) {
    fail();
  }
  return value;
}
