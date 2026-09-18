# Public Student onboarding production receipt — 2026-09-18

Accepted release and observed verification scope. No credentials or private account data.

```json
{
  "schemaVersion": 1,
  "recordedAt": "2026-09-18T11:45:06Z",
  "scope": "Managed production release, existing-account Auth smoke and anonymous questionnaire UI. Full new-account signup and approval were exercised on isolated local QA only.",
  "pullRequest": "https://github.com/izzhackt/evo_AI_CRM/pull/830",
  "reviewedHead": "5323f23321505a27d0e70b6ce2fdd3c9aff04555",
  "independentReview": "approved",
  "protectedPrChecksRunId": "35340251635",
  "mergedRevision": "1de14c0ad02b97b5b576060864574ee70e9e8508",
  "reviewedAndMergedTreeMatch": true,
  "migration": {
    "version": "177",
    "path": "supabase/migrations/177_platform_public_student_applications.sql",
    "sourceSha256": "55b821d1f2612d82208991a6f103b5686c1b120324286147b7b9a267967803f6",
    "appliedFromMergedRevision": true,
    "ledgerFirstVersion": "001",
    "ledgerLastVersion": "177",
    "ledgerCount": 177,
    "completeLedgerAndStoredSqlHashVerified": true,
    "operatorCorrection": "The first application attempt failed SQL parsing because JavaScript string replacement interpreted dollar characters in the ledger SQL literal. Readback still showed 176 migrations. A replacement callback preserved the unchanged reviewed SQL, and the subsequent atomic application and ledger/hash readbacks succeeded."
  },
  "auth": {
    "globalSettingsChanged": false,
    "disable_signup": true,
    "mailer_autoconfirm": false,
    "mailer_allow_unverified_email_sign_ins": false,
    "external_email_enabled": true,
    "external_anonymous_users_enabled": false,
    "studentCreation": "Origin-checked server action reserves service-only durable quota, creates a new identity using admin.createUser with email_confirm=true, then establishes an ordinary password session. Existing identities are never updated or adopted.",
    "fullPortalRequiresAdmissionsApproval": true,
    "smtpRequiredForNewSignup": false,
    "mailboxOwnershipClaimed": false
  },
  "release": {
    "releaseId": "v3-r35340641026-a1-1de14c0a",
    "revision": "1de14c0ad02b97b5b576060864574ee70e9e8508",
    "currentMainRevisionAtAcceptance": "1de14c0ad02b97b5b576060864574ee70e9e8508",
    "upstreamCiRunId": "35340610391",
    "upstreamCiRunAttempt": 1,
    "workflowRunId": "35340641026",
    "workflowRunAttempt": 1,
    "conclusion": "success",
    "artifactId": "10545181368",
    "artifactDigest": "sha256:1667b864c20e9164f72862f5bc4d3c3adbe6c997c6eb916e3f67932d87bed250",
    "imageId": "sha256:9f439d25e7056e439dc9ebe7da6801b08632f368123bae3598961b33c883aba0",
    "imageConfigDigest": "sha256:1a9e7bcd01374a514db5e977a32c17fec548699aa2fc86e8ed5f769cfd7ce3f3",
    "archiveSha256": "7368b09b4ce887ded9c872c08b05e9be0bf5f805f0ee368e98c82e487370a5df",
    "acceptanceRecordSha256": "51351307fd9c346675ade226e4f9502a1f2be1ebd46da35745b2f999511577aa",
    "browserReceiptSha256": "0b427a9af59b956b9b504a3213fadb8ffc9e66d276b124b14b19cc674e36cffc",
    "acceptanceHashMatchesServerFile": true,
    "browserHashMatchesServerFile": true,
    "runningRevisionMatchesAcceptedRevision": true,
    "runningImageMatchesAcceptedImage": true,
    "containerHealth": "healthy",
    "containerRestarts": 0,
    "crmPublicHealth": "live",
    "studentPublicHealth": "live",
    "pendingPointerExists": false,
    "releaseArmed": false,
    "rollbackRequired": false
  },
  "productionSmoke": {
    "managedExistingAccountBrowserReceipt": "passed",
    "managedScope": "Existing authorized staff case and Student portal password-login smoke from the release workflow; no new-account registration submission.",
    "manualTool": "Codex in-app browser through cua_repl",
    "anonymousRootRedirect": "https://app.evoadmissions.com/apply",
    "questionnaireStepsVisited": 9,
    "finalScreen": "Создайте аккаунт EVO",
    "admissionsApprovalRequirementVisible": true,
    "reloadRetainedFinalStep": true,
    "mobileViewport": "390x844",
    "mobileFieldsConsentAndSubmitVisible": true,
    "viewportResetAfterCheck": true,
    "registrationSubmitted": false,
    "newProductionStudentCreated": false,
    "productionStaffApprovalSubmitted": false
  },
  "localEvidence": {
    "path": "docs/qa/student-public-onboarding-177-local-2026-09-18.json",
    "currentSecureFlow": "Nine-step real UI, server-only new Auth identity, pending and direct portal denial, existing Admin RPC approval, canonical profile persistence, full portal and ordinary password relogin; eleven additional real security-delta checks.",
    "historicalEvidenceLimit": "Earlier 35 checks and the original local receipt source/hash are retained as historical evidence. The intermediate public-signup/autoconfirm Auth contract was superseded before release.",
    "staffApprovalWasRpcNotBrowserSubmission": true
  },
  "limits": [
    "No new Student signup, approval or relogin journey was submitted in production.",
    "No real-customer acceptance, mailbox ownership or email delivery is claimed.",
    "No new database backup or restore rehearsal was performed under the standing owner waiver.",
    "No provider activation or unrelated workspace changes were performed."
  ]
}
```
