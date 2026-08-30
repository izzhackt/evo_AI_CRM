function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value, message) {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    message,
  );
  return value;
}

function readbackAck(value, label) {
  ensure(
    Number.isInteger(value) && value >= 0 && value <= 4,
    `${label} is invalid`,
  );
  return value;
}

export function validateExistingWahaCheckpoint(existing, expected) {
  const existingRecord = record(
    existing,
    "V2-10D post-WAHA recovery marker is invalid",
  );
  const expectedRecord = record(expected, "Expected checkpoint is invalid");
  const existingRecovery = record(
    existingRecord.recovery,
    "V2-10D post-WAHA recovery metadata is invalid",
  );
  const existingHashes = record(
    existingRecord.hashes,
    "V2-10D post-WAHA hashes are invalid",
  );
  const existingReview = record(
    existingRecord.review,
    "V2-10D post-WAHA review counts are invalid",
  );
  const existingWaha = record(
    existingRecord.waha,
    "V2-10D post-WAHA WAHA counts are invalid",
  );
  const existingAmo = record(
    existingRecord.amocrm,
    "V2-10D post-WAHA amoCRM counts are invalid",
  );
  const existingBoundaries = record(
    existingRecord.boundaries,
    "V2-10D post-WAHA boundaries are invalid",
  );
  const expectedRecovery = record(
    expectedRecord.recovery,
    "Expected recovery is invalid",
  );
  const expectedHashes = record(
    expectedRecord.hashes,
    "Expected hashes are invalid",
  );
  const expectedReview = record(
    expectedRecord.review,
    "Expected review is invalid",
  );
  const expectedWaha = record(
    expectedRecord.waha,
    "Expected WAHA proof is invalid",
  );
  const expectedAmo = record(
    expectedRecord.amocrm,
    "Expected amoCRM proof is invalid",
  );
  const expectedBoundaries = record(
    expectedRecord.boundaries,
    "Expected boundaries are invalid",
  );
  const existingAck = readbackAck(
    existingWaha.readbackAck,
    "Existing post-WAHA readback ACK",
  );
  const expectedAck = readbackAck(
    expectedWaha.readbackAck,
    "Expected post-WAHA readback ACK",
  );

  ensure(
    existingRecord.schemaVersion === expectedRecord.schemaVersion &&
      existingRecord.kind === expectedRecord.kind &&
      existingRecord.status === expectedRecord.status &&
      existingRecord.gitSha === expectedRecord.gitSha &&
      existingRecord.nextAuthorizedStep ===
        expectedRecord.nextAuthorizedStep &&
      existingRecovery.occurred === expectedRecovery.occurred &&
      existingRecovery.stage === expectedRecovery.stage &&
      existingRecovery.codeSha === expectedRecovery.codeSha &&
      existingHashes.proposalSha256 === expectedHashes.proposalSha256 &&
      existingHashes.reviewedTextSha256 ===
        expectedHashes.reviewedTextSha256 &&
      existingHashes.providerMessageIdSha256 ===
        expectedHashes.providerMessageIdSha256 &&
      existingReview.decision === expectedReview.decision &&
      existingReview.proposalCount === expectedReview.proposalCount &&
      existingWaha.status === expectedWaha.status &&
      existingWaha.attemptCount === expectedWaha.attemptCount &&
      existingWaha.outboundMessageCount ===
        expectedWaha.outboundMessageCount &&
      existingWaha.databaseAck === expectedWaha.databaseAck &&
      expectedAck >= existingAck &&
      existingWaha.exactReadback === expectedWaha.exactReadback &&
      existingAmo.attemptCount === expectedAmo.attemptCount &&
      existingAmo.receiptCount === expectedAmo.receiptCount &&
      existingAmo.bindingCount === expectedAmo.bindingCount &&
      JSON.stringify(existingBoundaries) === JSON.stringify(expectedBoundaries),
    "Existing post-WAHA checkpoint differs from the exact preserved result or its ACK regressed",
  );
}

export async function durableCreateOrValidateWahaCheckpoint(
  filePath,
  expected,
  io,
) {
  try {
    await io.create(filePath, expected);
    return;
  } catch (error) {
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code !== "EEXIST") throw error;
  }

  const existing = await io.read(filePath);
  validateExistingWahaCheckpoint(existing, expected);
}
