# Scenario Evaluation

Generated: 2026-07-30T14:26:42.515Z

## Method

Evaluation method: consistent pass/fail checks. Each scenario defines a success
criterion before execution and records concrete evidence after execution.

Conditions:

- Non-production Next.js UI-contract fixture server on loopback. The separate
  `next build` gate validates the production build; these fixture scenarios
  are not production-runtime or provider proof.
- Fixed `AUTH_SECRET` for signed seeded-session cookies.
- Isolated SQLite copy from `data/edu-admin.db` via `EVO_DB_PATH`.
- Real App Router pages, Server Action form posts, and API route handlers.
- No live WhatsApp, telephony, amoCRM, or Anthropic credentials supplied; missing
  provider credentials must surface as explicit blocked/not-configured states.
- Base URL: `http://127.0.0.1:3130`.
- Temp DB: `/var/folders/p4/c09jb8gd4qngjbkr1cqfh8rh0000gp/T/evo-crm-scenarios-66748-1785421589072/edu-admin.db` (isolated copy; removed after the run unless
  `EVO_KEEP_SCENARIO_DB=1` is set).

## Summary

- Passed: 39
- Failed: 0
- Total: 39

## Results

| ID | Capability | Scenario | Success Criteria | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| S01 | Auth and route protection | Unauthenticated staff request is redirected to login. | GET /dashboard without a session returns a redirect to /login. | PASS | status 307, location /login |
| S02 | Auth and route protection | Staff credentials authenticate to the role-specific workspace. | Submitting the real login form with the seeded sales account sets edu_session and redirects to its /sales home. | PASS | login form accepted sales@demo.kg; set edu_session and redirected to /sales |
| S03 | Auth and route protection | Client portal renders while staff routes reject client sessions. | Client session can load /portal and is redirected away from /dashboard to /portal. | PASS | portal 200, dashboard 307 -> /portal |
| S04 | Navigation and admissions copy | Staff shell exposes admissions CRM navigation and metadata copy. | Admin dashboard includes EVO Admissions CRM shell plus applications/documents/finance navigation labels. | PASS | dashboard shell contains EVO Admissions CRM nav links for applications, documents, and finance |
| S05 | Role visibility | Finance role can use finance overview but not admissions document/application queues. | Finance session loads /finance and receives a server-guarded no-access state for /applications and /documents. | PASS | finance 200; applications 307 header no-access; documents 307 header no-access |
| S06 | Command Center | Command Center metrics, charts, and queue links are admissions-specific. | Dashboard renders stats from all CRM queues with links to sales, applications, documents, tasks, finance, and clients. | PASS | dashboard links all core queues; client count evidence 2 |
| S07 | Admissions Pipeline | Admissions Pipeline renders operational columns and existing lead cards. | GET /sales shows lead statuses, pipeline metrics, and at least one seeded lead card link. | PASS | sales page rendered seeded lead 1 Темирлан Касымов |
| S08 | Admissions Pipeline | Add lead Server Action creates an EVO admissions lead. | Submitting the real Sales /sales lead form inserts a lead with source, target country, amount, and the authenticated Sales owner. | PASS | created lead 7 status processing_mp, Canada, 120000 KGS; owner forced to Sales 2 |
| S09 | Admissions Pipeline | Move lead Server Action updates lead status and activity. | Submitting a lead move form changes status to meeting scheduled and records a status activity. | PASS | lead 1 moved to meeting_scheduled; status activities 1 |
| S08B | Admissions Pipeline | Active pipeline risk views exclude terminal no-request leads. | A terminal no_request lead without tasks does not inflate active no-task drill-downs. | PASS | terminal no_request lead Terminal No Request-1785421592895-2fpy7s excluded; active no-task count 3 |
| S10 | Admissions Pipeline | Contract status and Student 360 conversion stay locked until the canonical amoCRM mapping exists. | A forged contract_signed move neither changes the lead nor creates a linked client. | PASS | lead 9 remained meeting_done and unlinked after forged contract_signed |
| S11 | Admissions Pipeline | Lead note action persists staff activity. | Submitting note form on lead detail inserts a note activity visible on the lead. | PASS | lead 1 note activity 4 |
| S12 | Student 360 | Student 360 list filters and add-student action create a profile. | Student list stage filter renders and add-student form creates a client plus linked client user. | PASS | created student client 3 with linked client user |
| S13 | Student 360 | Student profile renders profile, applications, documents, visa, finance, updates, deadline, and open work. | GET /clients/:id includes sections/forms for profile, application, document, visa, payment, task, update, and queue links. | PASS | student 1 profile exposes core operating sections |
| S14 | Student 360 | General profile updates persist allowed fields without changing canonical manager or Curator ownership. | Forged ownership fields are ignored while stage and study-target changes persist. | PASS | student 1 updated allowed fields; manager 2 and Curator 3 stayed unchanged |
| S15 | Applications queue | Add application action persists admissions application context. | Responsible Sales can add an application to their pre-handoff Student 360; the action persists university, country, program, degree, deadline, and preparing status. | PASS | application 3 created for client 2: Business Analytics, preparing |
| S16 | Applications queue | Applications queue filter and status update flow work. | Assigned Curator can use the post-handoff filtered queue, update an application to submitted, and follow its Student 360 link. | PASS | application 2 updated to submitted; filtered queue status 200 |
| S17 | Documents queue | Add document action persists admissions document request. | Responsible Sales can add a required document request to their pre-handoff Student 360. | PASS | document 6 created with status required |
| S18 | Documents queue | Documents queue filter and status update flow work. | Assigned Curator can use the post-handoff filtered queue, reopen an approved document for review with a reason, and follow its Student 360 link. | PASS | document 1 reopened as review; filtered queue status 200 |
| S19 | Visa operations | Visa upsert persists valid case status and dates. | Submitting visa form creates/updates visa case with allowed status and appointment date. | PASS | visa case for client 1: appointment on 2026-11-20 |
| S20 | Tasks | Tasks board metrics/status columns and add-task action are useful. | Sales task board renders metrics/columns, and Sales can add a task linked to their pre-handoff student with priority, assignee, and due date. | PASS | task 5 urgent, client 2, status todo |
| S21 | Tasks | Move task action persists status changes. | Sales can move a task in their own pre-handoff or personal queue to review. | PASS | task 2 moved to review |
| S22 | Finance | Finance overview shows paid, pending, overdue, and role-safe actions. | Finance page renders payment status logic; sales staff receives a no-access state and finance staff sees mutation controls. | PASS | sales finance blocked; finance role mutation form visible |
| S23 | Finance | Add payment rejects invalid amount and accepts positive role-safe payment. | Finance can select a student with no prior payments; negative amount does not insert, while a positive submission creates the first pending payment with currency. | PASS | negative rejected; payment 4 2500 USD pending |
| S24 | Finance | Mark payment paid action persists payment completion. | Submitting mark-paid form updates a pending payment to paid and sets paid_at. | PASS | payment 2 status paid, paid_at 2026-07-30 |
| S25 | Student portal updates | Staff update becomes visible in the client portal. | Posting an update from Student 360 inserts a client update and the seeded client portal renders it. | PASS | portal rendered update for client 1 |
| S31 | Student portal experience | Client portal renders a sectioned, client-scoped admissions dashboard. | The signed-in student sees own stage, target, applications, documents, payments, highest-priority next action, team contacts, and section navigation without another student's data. | PASS | portal rendered scoped dashboard for client 1 with navigation, contacts, and open work |
| S26 | Team chat | Chat renders and channel/message actions persist team communication. | Creating a channel redirects to chat detail, and sending a message inserts it for that channel. | PASS | channel 4 created (303); message 5 inserted |
| S27 | WhatsApp operations | Manual WhatsApp creation is Admin-only and missing credentials are visibly blocked. | Sales has no manual-create form; Admin can create an unlinked conversation and see its detail while Sales cannot see its link; absent Cloud API credentials show a not-connected state instead of success. | PASS | Admin-only conversation 3; Sales create/link denied; WhatsApp Cloud credentials absent and inbox shows blocked state |
| S28 | WhatsApp webhook and settings | Settings save integration token, verify endpoint works, and incoming webhook creates lead/conversation. | Admin settings form saves verify token; GET webhook echoes challenge; POST incoming message creates conversation and linked lead. | PASS | verify ok; inbound conversation 4, lead 10 |
| S28B | WAHA WhatsApp integration | WAHA settings create a session account, signed webhook imports messages, status events update the account, retries are idempotent, and provider errors stay visible. | Admin can save WAHA config; unsigned WAHA webhook is rejected; signed message creates one account-bound conversation; duplicate delivery is ignored; a stored provider failure renders as blocked in the staff shell and settings overview. | PASS | WAHA session crm_1evaty; conversation 5; duplicate message ignored; account WORKING; provider failure rendered blocked in shell and settings |
| S28C | Lead-agent CRM sync | Signed lead-agent sync persists receive-only draft review evidence without creating sent outbound WhatsApp. | Bad signatures are rejected; signed sync stores inbound state, amoCRM identity, agent state, and Gemini draft-review text; Operator UI labels the draft as not sent. | PASS | signed sync accepted conversation 6; rejected bad signature; draft visible with 0 outbound rows |
| S29 | Calls and telephony | Calls page and telephony webhook enforce key handling and insert calls. | Missing telephony provider or key is explicitly blocked without inserting a call; configured provider/key blocks invalid webhook; valid webhook inserts a call and links by lead phone. | PASS | user-facing unavailable state shown; missing key 503; missing provider 503; invalid key 403; calls 4/5 linked to lead 1 |
| S30 | Reports and prepared AI boundary | Reports render and AI summary endpoint returns not_configured without Anthropic key. | Reports page loads real CRM totals; AI summary API for staff returns explicit not_configured instead of fake success. | PASS | reports 200; AI summary client 1 -> not_configured |
| S32 | amoCRM integration | Settings page shows amoCRM as not_configured and check does not call the provider without credentials. | Admin settings render amoCRM status with exact missing fields, and the real check Server Action records not_configured without credentials. | PASS | amoCRM check returned not_configured:accountBaseUrl,clientId,clientSecret,redirectUri,refreshToken |
| S33 | amoCRM integration | Admin can save sanitized amoCRM settings without leaking secrets in the rendered settings page. | Submitting the real settings form stores a normalized amoCRM URL and secret rows, while the follow-up page omits raw secret values. | PASS | amoCRM settings saved with normalized account URL and masked secrets |
| S34 | amoCRM integration | Invalid amoCRM domains are rejected server-side. | Submitting a Cyrillic or unrelated amoCRM account domain does not replace the saved account URL and records a blocked validation state. | PASS | invalid Cyrillic amoCRM domain rejected and previous account URL preserved |
| S36 | amoCRM integration | Real amoCRM OAuth failure is surfaced as blocked instead of configured. | When required credentials are present but the real OAuth exchange fails, the settings status records and renders blocked without leaking token values. | PASS | amoCRM real OAuth check stored blocked:provider_400 |
| S35 | amoCRM integration | Non-admin staff cannot save amoCRM settings through the real Server Action path. | A sales session posting an admin-rendered settings Server Action is redirected and cannot mutate amoCRM settings. | PASS | sales settings post redirected to /dashboard; amoCRM account unchanged |
