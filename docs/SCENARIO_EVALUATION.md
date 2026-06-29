# Scenario Evaluation

Generated: 2026-06-29T07:53:20.669Z

## Method

Evaluation method: consistent pass/fail checks. Each scenario defines a success
criterion before execution and records concrete evidence after execution.

Conditions:

- Built Next.js production app served through `next start`.
- Fixed `AUTH_SECRET` for signed seeded-session cookies.
- Isolated SQLite copy from `data/edu-admin.db` via `EVO_DB_PATH`.
- Real App Router pages, Server Action form posts, and API route handlers.
- No live WhatsApp, telephony, amoCRM, or Anthropic credentials supplied; missing
  provider credentials must surface as explicit blocked/not-configured states.
- Base URL: `http://127.0.0.1:3130`.
- Temp DB: `/var/folders/p4/c09jb8gd4qngjbkr1cqfh8rh0000gp/T/evo-crm-scenarios-7791-1782719594440/edu-admin.db` (isolated copy; removed after the run unless
  `EVO_KEEP_SCENARIO_DB=1` is set).

## Summary

- Passed: 37
- Failed: 0
- Total: 37

## Results

| ID | Capability | Scenario | Success Criteria | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| S01 | Auth and route protection | Unauthenticated staff request is redirected to login. | GET /dashboard without a session returns a redirect to /login. | PASS | status 307, location /login |
| S02 | Auth and route protection | Staff credentials authenticate to Command Center. | Submitting the real login form with a current seeded staff account sets edu_session and redirects to /dashboard. | PASS | login form accepted sales@demo.kg; set edu_session and redirected to /dashboard |
| S03 | Auth and route protection | Client portal renders while staff routes reject client sessions. | Client session can load /portal and is redirected away from /dashboard to /portal. | PASS | portal 200, dashboard 307 -> /portal |
| S04 | Navigation and admissions copy | Staff shell exposes admissions CRM navigation and metadata copy. | Admin dashboard includes EVO Admissions CRM shell plus applications/documents/finance navigation labels. | PASS | dashboard shell contains EVO Admissions CRM nav links for applications, documents, and finance |
| S05 | Role visibility | Finance role can use finance overview but not admissions document/application queues. | Finance session loads /finance and redirects from /applications and /documents to the finance role home. | PASS | finance 200; applications 307; documents 307 |
| S06 | Command Center | Command Center metrics, charts, and queue links are admissions-specific. | Dashboard renders stats from all CRM queues with links to sales, applications, documents, tasks, finance, and clients. | PASS | dashboard links all core queues; client count evidence 4 |
| S07 | Admissions Pipeline | Admissions Pipeline renders operational columns and existing lead cards. | GET /sales shows lead statuses, pipeline metrics, and at least one seeded lead card link. | PASS | sales page rendered seeded lead 1 Темирлан Касымов |
| S08 | Admissions Pipeline | Add lead Server Action creates an EVO admissions lead. | Submitting the real /sales lead form inserts a lead with source, target country, manager, and amount. | PASS | created lead 8 status processing_mp, Canada, 120000 KGS |
| S09 | Admissions Pipeline | Move lead Server Action updates lead status and activity. | Submitting a lead move form changes status to meeting scheduled and records a status activity. | PASS | lead 1 moved to meeting_scheduled; status activities 1 |
| S08B | Admissions Pipeline | Active pipeline risk views exclude terminal no-request leads. | A terminal no_request lead without tasks does not inflate active no-task drill-downs. | PASS | terminal no_request lead Terminal No Request-1782719596419-jt1x9e excluded; active no-task count 5 |
| S10 | Admissions Pipeline | Convert lead Server Action creates Student 360 client and marks contract signed. | Converting an unconverted lead creates a client, links it to the lead, and sets status contract_signed. | PASS | lead 10 converted to client 5 |
| S11 | Admissions Pipeline | Lead note action persists staff activity. | Submitting note form on lead detail inserts a note activity visible on the lead. | PASS | lead 1 note activity 167 |
| S12 | Student 360 | Student 360 list filters and add-student action create a profile. | Student list stage filter renders and add-student form creates a client plus linked client user. | PASS | created student client 6 with linked client user |
| S13 | Student 360 | Student profile renders profile, applications, documents, visa, finance, updates, deadline, and open work. | GET /clients/:id includes sections/forms for profile, application, document, visa, payment, task, update, and queue links. | PASS | student 1 profile exposes core operating sections |
| S14 | Student 360 | Update student profile persists stage, manager, curator, and study target changes. | Submitting profile form updates the selected client without clearing required profile fields. | PASS | student 1 now documents, United Kingdom, manager 2 |
| S15 | Applications queue | Add application action persists admissions application context. | Submitting application form on Student 360 inserts university, country, program, degree, deadline, and preparing status. | PASS | application 3 created for client 1: Business Analytics, preparing |
| S16 | Applications queue | Applications queue filter and status update flow work. | Filtered queue renders, status form updates application to submitted, and row links back to Student 360. | PASS | application 1 updated to submitted; filtered queue status 200 |
| S17 | Documents queue | Add document action persists admissions document request. | Submitting document form on Student 360 inserts a required document request. | PASS | document 6 created with status required |
| S18 | Documents queue | Documents queue filter and status update flow work. | Filtered queue renders, status form updates document to review, and row links back to Student 360. | PASS | document 1 updated to review; filtered queue status 200 |
| S19 | Visa operations | Visa upsert persists valid case status and dates. | Submitting visa form creates/updates visa case with allowed status and appointment date. | PASS | visa case for client 1: appointment on 2026-11-20 |
| S20 | Tasks | Tasks board metrics/status columns and add-task action are useful. | Tasks page renders metrics/columns, and add-task form persists priority, assignee, student link, and due date. | PASS | task 3 urgent, client 1, status todo |
| S21 | Tasks | Move task action persists status changes. | Submitting a task move form changes status to review. | PASS | task 1 moved to review |
| S22 | Finance | Finance overview shows paid, pending, overdue, and role-safe actions. | Finance page renders payment status logic; sales staff is redirected and finance user sees mutation controls. | PASS | sales finance blocked; finance role mutation form visible |
| S23 | Finance | Add payment rejects invalid amount and accepts positive role-safe payment. | Negative amount does not insert a payment; positive finance submission creates pending payment with currency. | PASS | negative rejected; payment 4 2500 USD pending |
| S24 | Finance | Mark payment paid action persists payment completion. | Submitting mark-paid form updates a pending payment to paid and sets paid_at. | PASS | payment 2 status paid, paid_at 2026-06-29 |
| S25 | Student portal updates | Staff update becomes visible in the client portal. | Posting an update from Student 360 inserts a client update and the seeded client portal renders it. | PASS | portal rendered update for client 1 |
| S31 | Student portal experience | Client portal renders a sectioned, client-scoped admissions dashboard. | The signed-in student sees own stage, target, applications, documents, payments, open tasks, team contacts, and section navigation without another student's data. | PASS | portal rendered scoped dashboard for client 1 with navigation, contacts, and open work |
| S26 | Team chat | Chat renders and channel/message actions persist team communication. | Creating a channel redirects to chat detail, and sending a message inserts it for that channel. | PASS | channel 5 created (303); message 77 inserted |
| S27 | WhatsApp operations | WhatsApp inbox/detail render and missing credentials are visibly blocked. | Conversation creation renders detail, inbox links it, and absent Cloud API credentials show a not-connected state instead of success. | PASS | conversation 5; WhatsApp Cloud credentials absent and inbox shows blocked state |
| S28 | WhatsApp webhook and settings | Settings save integration token, verify endpoint works, and incoming webhook creates lead/conversation. | Admin settings form saves verify token; GET webhook echoes challenge; POST incoming message creates conversation and linked lead. | PASS | verify ok; inbound conversation 6, lead 11 |
| S29 | Calls and telephony | Calls page and telephony webhook enforce key handling and insert calls. | Missing telephony provider or key is explicitly blocked without inserting a call; configured provider/key blocks invalid webhook; valid webhook inserts a call and links by lead phone. | PASS | not_configured copy shown; missing key 503; missing provider 503; invalid key 403; calls 5/6 linked to lead 1 |
| S30 | Reports and prepared AI boundary | Reports render and AI summary endpoint returns not_configured without Anthropic key. | Reports page loads real CRM totals; AI summary API for staff returns explicit not_configured instead of fake success. | PASS | reports 200; AI summary client 1 -> not_configured |
| S32 | amoCRM integration | Settings page shows amoCRM as not_configured and check does not call the provider without credentials. | Admin settings render amoCRM status with exact missing fields, and the real check Server Action records not_configured without credentials. | PASS | amoCRM check returned not_configured:accountBaseUrl,clientId,clientSecret,redirectUri,refreshToken |
| S33 | amoCRM integration | Admin can save sanitized amoCRM settings without leaking secrets in the rendered settings page. | Submitting the real settings form stores a normalized amoCRM URL and secret rows, while the follow-up page omits raw secret values. | PASS | amoCRM settings saved with normalized account URL and masked secrets |
| S34 | amoCRM integration | Invalid amoCRM domains are rejected server-side. | Submitting a Cyrillic or unrelated amoCRM account domain does not replace the saved account URL and records a blocked validation state. | PASS | invalid Cyrillic amoCRM domain rejected and previous account URL preserved |
| S36 | amoCRM integration | Real amoCRM OAuth failure is surfaced as blocked instead of configured. | When required credentials are present but the real OAuth exchange fails, the settings status records and renders blocked without leaking token values. | PASS | amoCRM real OAuth check stored blocked:provider_400 |
| S35 | amoCRM integration | Non-admin staff cannot save amoCRM settings through the real Server Action path. | A sales session posting an admin-rendered settings Server Action is redirected and cannot mutate amoCRM settings. | PASS | sales settings post redirected to /dashboard; amoCRM account unchanged |
