# Promise Audit

Status: internal audit register, 2026-06-24.

This file is not public/product copy. It records customer-facing promises found in
public EVO marketing, repo documentation, demo flows, UI copy, and AI surfaces,
then compares them with current product behavior and available evidence.

Labels:

- `proven`: current product behavior is directly verified by real checks.
- `partly proven`: product supports part of the promise, but a live provider,
  external service result, or broader coverage is missing.
- `misleading`: wording can imply a stronger result than current behavior.
- `unsupported`: no product behavior or supplied evidence supports the promise.
- `outdated`: claim conflicts with current behavior or current evidence.
- `missing evidence`: claim may be true externally, but the repo has no proof.

## Sources Reviewed

Public marketing:

- `https://evoadmissions.com/`
- `https://evoadmissions.com/uslugi.htm`
- `https://evoadmissions.com/o-nas.htm`
- `https://evoadmissions.com/contacts.htm`

Repo/product artifacts:

- `docs/EVO_BRAND_RESEARCH.md`
- `docs/EVO_LAUNCH_PLAN.md`
- `docs/PUBLIC_PROMISE_COPY_CHANGESET.md`
- `docs/QA_LAUNCH_REPORT.md`
- `docs/SCENARIO_EVALUATION.md`
- `src/lib/i18n.ts`
- `src/lib/prepared-ai.ts`
- `src/lib/ai.ts`
- `src/lib/whatsapp.ts`
- `src/lib/amocrm.ts`
- `src/app/api/webhooks/telephony/route.ts`
- `scripts/scenarios/admissions-crm.mjs`

## Promise Register

| ID | Promise | Source | Current behavior | Evidence | Label | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| P01 | Staff can log in and reach the CRM command center. | App demo, scenario docs. | Staff session routes to `/dashboard`. | S01-S02 in `docs/SCENARIO_EVALUATION.md`. | proven | low |
| P02 | Client/student users are isolated from staff routes and can use a portal. | App demo, launch plan. | Client can load `/portal`; staff route redirects back to portal. | S03 and S31. | proven | low |
| P03 | Staff dashboard covers admissions queues, applications, documents, tasks, finance, and clients. | App UI, launch plan. | Dashboard and navigation render real queue links and counts. | S04-S06. | proven | low |
| P04 | Admissions pipeline can create leads, move statuses, add notes, and convert leads to clients. | App UI, demo flow. | Server Actions persist lead creation, movement, notes, and conversion. | S07-S12. | proven | low |
| P05 | Student 360 stores profile, application, document, visa, finance, update, and task context. | App UI, demo flow. | Student profile renders and mutates these sections. | S13-S25. | proven | low |
| P06 | Student portal shows a scoped admissions dashboard with stage, applications, documents, payments, team contacts, and open work. | App UI, student portal demo. | Client portal renders scoped data without another student's data. | S31. | proven | low |
| P07 | Team chat persists channels and messages. | App UI, scenario docs. | Channel creation and message insertion work in local CRM. | S26. | proven | low |
| P08 | WhatsApp conversations can be tracked in the CRM. | App UI, launch docs. | Staff can create conversations; inbound webhook creates conversation and linked lead. | S27-S28. | proven | medium |
| P09 | WhatsApp outbound sending is live. | UI references WhatsApp reply; launch plan forbids fake success. | Send path calls Meta only with credentials; missing credentials return `not_configured`. No live Meta credentials verified. | `src/lib/whatsapp.ts`, S27, QA named blocker. | partly proven | high until credentials supplied |
| P10 | Telephony webhooks can log calls and link them to leads. | Calls page, launch docs. | Missing `tel_provider` or `tel_api_key` now returns `not_configured`/503 and inserts nothing; valid provider/key webhook inserts and links by phone. | S29 and `src/app/api/webhooks/telephony/route.ts`. | partly proven | medium |
| P11 | Live telephony provider integration is configured. | Calls page copy references PBX providers. | Product copy now says `not_configured`; no live PBX provider credentials or provider callback have been verified. | QA named blocker and `src/lib/i18n.ts`. | missing evidence | high until credentials supplied |
| P12 | amoCRM settings/integration exists. | Settings UI, launch docs. | Admin settings store sanitized amoCRM config; status is `not_configured`, `blocked`, or `configured`; missing credentials do not call network. | S32-S36. | partly proven | medium |
| P13 | Real amoCRM sync succeeds. | Integration ambition in docs. | Real OAuth/API failure is surfaced as `blocked`; no real successful provider sync is verified. | S36 and QA named blocker. | missing evidence | high until credentials supplied |
| P14 | Live Claude/Anthropic AI summary and draft generation are available. | AI UI, API routes, launch docs. | Live endpoints return `not_configured` without key; live AI system instructions now forbid admission, grant, visa, deadline, pricing, and provider-success guarantees without CRM/provider evidence. No live Anthropic call is verified. | S30, QA named blocker, and `src/lib/ai.ts`. | partly proven | high until key supplied |
| P15 | Prepared AI WhatsApp replies are available for first presentation. | Prepared AI drawer and contract. | Prepared bundle is allowed only for explicit first-presentation context and labeled as deterministic prepared content. | `src/lib/contracts/prepared-ai.ts`, `src/lib/prepared-ai.ts`, QA report. | proven | low |
| P16 | Prepared AI is live Anthropic output. | Possible demo misunderstanding. | Contract forbids representing prepared responses as live Anthropic success. | Launch plan and prepared AI contract. | misleading if claimed | high |
| P17 | Three-language UI switch is available. | Login/register and app UI. | RU/KY/EN dictionaries exist; browser QA verified English switching after reload. Exhaustive per-screen RU/KY/EN coverage is not complete. | `src/lib/i18n.ts`, QA report. | partly proven | medium |
| P18 | Role-safe finance controls exist. | Finance UI and scenario docs. | Finance user sees mutation controls; sales staff sees read-only finance page. | S05, S22-S24. | proven | low |
| P19 | Invalid payment amounts are rejected. | Finance flow. | Negative amount does not insert; positive amount inserts pending payment. | S23. | proven | low |
| P20 | Secrets are not leaked in amoCRM settings UI. | Settings UI, launch plan. | Saved secrets are masked/omitted from follow-up page. | S33. | proven | low |
| P21 | App is production-buildable and audit-clean. | QA launch report. | Build, lint, typegen, typecheck, scenarios, and audit pass. | `docs/QA_LAUNCH_REPORT.md`, latest validation. | proven | low |
| P22 | EVO helps choose country/university and apply with less stress. | Public home page. | Product tracks country, target degree, applications, tasks, and documents, but cannot prove service outcome or stress reduction. | Public site plus S04-S25. | partly proven | medium |
| P23 | EVO supports university admission from documents through visa preparation. | Public home/services pages. | Product supports document, application, and visa operations; service delivery remains external. | Public site plus S13-S19. | partly proven | medium |
| P24 | EVO supports IELTS/SAT preparation and personal brand/spike work. | Public home page. | Current CRM has notes/tasks but no dedicated IELTS/SAT or personal-brand module. | Public site; no scenario coverage. | unsupported | medium |
| P25 | EVO helps build college lists, essays, Common App/Coalition, activities, honors, financial aid, CSS Profile, fee waivers. | Public home page. | Current CRM can track documents/tasks/applications, but no dedicated structured modules for these workstreams. | Public site; no scenario coverage. | partly proven | medium |
| P26 | Free consultation assesses chances, addresses fears, and creates a personal action plan. | Public home/services/contact pages. | Product can capture leads and consultation tasks; no free-consultation workflow or outcome proof exists in CRM. | Public site plus S07-S12. | partly proven | medium |
| P27 | Agency has helped 4,000+ applicants / 4,000+ successful enrollments. | Public services/about pages. | Repo has no source dataset or audit artifact proving the metric. | Public site only. | missing evidence | high |
| P28 | Agency works in 60+ countries. | Public home/services/about pages. | Product stores target countries, but repo has no country coverage dataset proving 60+. | Public site only. | missing evidence | high |
| P29 | Agency has 200 partner institutions. | Public about page. | Repo has no partner registry proving 200 institutions. | Public site only. | missing evidence | high |
| P30 | Agency has 12 foreign languages, 7-year average mentor experience, 5,000+ publications, 5 media platforms, 1.7M monthly readers. | Public about page. | Repo has no staffing, publication, analytics, or media evidence. | Public site only. | missing evidence | medium |
| P31 | Agency increases chances almost to 100%; no student remains without invitation. | Public home page. | No supplied outcome dataset proves this. It is an outcome guarantee-style claim and should not be repeated by the CRM demo without evidence. | Public site only. | unsupported | high |
| P32 | Full support includes scholarship applications and savings. | Public home/about pages. | CRM can track finance and documents; no scholarship application module or grant outcome proof exists. | Public site plus S15-S24. | partly proven | medium |
| P33 | Agency does not force partner universities and picks universities by student goals and opportunities. | Public about page. | Product can store targets and notes; no recommendation/audit logic proves unbiased selection. | Public site only. | missing evidence | medium |
| P34 | The website is an encyclopedia and social channels publish regular guides/news/stories. | Public home page. | This CRM repo does not manage website/social publishing. | Public site only. | missing evidence | low |

## Fixes Completed

- Fixed telephony truthfulness. Previously, the telephony webhook could insert a
  call while required provider configuration was absent. It now requires both
  `tel_provider` and `tel_api_key`, returns `not_configured` with status 503
  before any insert, and S29 verifies no call count change for missing-key and
  missing-provider cases.
- Refreshed the QA report and scenario evidence so integration truthfulness now
  includes telephony, not only WhatsApp and amoCRM.
- Changed controlled in-app telephony copy in Russian, Kyrgyz, and English from
  demo-mode language to explicit `not_configured` language.
- Added live AI system guardrails that forbid admission, invitation, visa,
  scholarship/grant, deadline, pricing, and integration-success guarantees
  unless they are explicitly supported by CRM/provider context.
- Added `npm run promise-audit` so the audit structure and prepared-AI
  no-guarantee checks are rerunnable.
- Added `docs/PUBLIC_PROMISE_COPY_CHANGESET.md` with exact external website
  replacement copy and acceptance checks for the public high-risk claims that
  cannot be edited from this CRM repo.

## Controlled Product Policy

Until external evidence is supplied, CRM demos, product docs, and AI answers
must not repeat public outcome-guarantee claims such as "almost 100%", "no
student without invitation", "guaranteed grant", or live integration success.

Professional safe replacements:

- Instead of "almost 100% admission chance": "The CRM tracks each student's
  applications, documents, deadlines, team tasks, and next actions so the team
  can manage the admissions process with visible evidence."
- Instead of "4,000+ enrollments / 60+ countries / 200 partners" inside product
  demos: "These are external EVO brand metrics and must be shown only when the
  source dataset or approved public page is cited."
- Instead of "live WhatsApp/PBX/amoCRM/AI is working" without credentials:
  "This integration is `not_configured`; the system blocks fake success until
  real credentials and provider responses are validated."

## Remaining High-Risk Items

These cannot be fully resolved inside this repo without external website access,
real provider credentials, or authoritative source datasets:

| Item | Current label | Needed decision |
| --- | --- | --- |
| Public “almost 100%” / no student without invitation claim. | unsupported | Apply `docs/PUBLIC_PROMISE_COPY_CHANGESET.md` in the external website/CMS or provide outcome evidence. Controlled CRM demo/AI surfaces must not repeat it. |
| Public 4,000+ enrollments/applicants, 60+ countries, 200 partners. | missing evidence | Apply `docs/PUBLIC_PROMISE_COPY_CHANGESET.md`, provide authoritative datasets, or present them only as externally sourced brand metrics with citations. |
| Live WhatsApp send, live PBX provider, live amoCRM sync, live Anthropic AI. | missing evidence / partly proven | Provide real credentials/provider accounts for validation. Until then, controlled demos must keep these explicit `not_configured`/prepared states. |

## Decisions Needed

1. Should public EVO service/outcome marketing stay in scope for this CRM
   implementation repo, or should external website edits happen in the website
   CMS/repo?
2. If public marketing stays in scope for this repo handoff, provide evidence
   for P27-P31 or update the external website copy outside this repo.
3. Provide real credentials/provider accounts for live WhatsApp send, PBX
   callback, amoCRM sync, and Anthropic validation when those promises should
   move from `not_configured` to proven live integrations.
