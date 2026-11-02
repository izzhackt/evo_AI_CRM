# EVO Brand Research

Status: brand-research lane v0, created 2026-06-24.

This document turns public brand, CRM, and study-abroad workflow evidence into
copy, data terms, flow definitions, and UX requirements for later implementation
lanes. It is a research artifact, not a claim that any integration or workflow is
already implemented.

## Scope

User-requested slice: `/goal-brand-research`.

Required sources:

- Public `evoadmissions.com`.
- Public amoCRM documentation.
- Public study-abroad CRM patterns.

Required outputs:

- Product copy.
- Data model terms.
- Realistic countries/program flows.
- Source-backed UX requirements.

## Executive Decision

Build the product language around an education-operations command center for EVO
Admissions, not around a generic "deal CRM".

The product should feel like:

- EVO's internal admissions cockpit.
- A student-file system that starts at inquiry and ends at enrollment/departure.
- A counseling operations layer over WhatsApp, calls, documents, universities,
  scholarships, visa work, payments, and deadlines.

The app may borrow amoCRM mechanics such as pipelines, statuses, sources,
unassigned/incoming lead triage, tasks, notes, contacts, and webhooks, but the UI
terms should use the student journey:

- "student file" instead of "deal" for active clients.
- "inquiry" instead of "lead" in user-facing Russian copy where possible.
- "application" for each university/program attempt.
- "country track" or "destination track" for a student's chosen path.
- "mentor/counselor" for the person owning admissions strategy.
- "case handoff" for moving from sales to mentor, documents, visa, or finance.

## Source-Backed Findings

### EVO Admissions Brand Reality

Facts from public EVO pages:

- EVO positions itself as help with choosing a country and university and
  applying without stress.
  Source: https://evoadmissions.com/
- EVO describes full support from motivation-letter work through visa
  preparation, plus IELTS/SAT preparation and student personal-brand work.
  Source: https://evoadmissions.com/
- EVO's service page says the agency has helped 4,000+ applicants and works with
  60+ countries.
  Source: https://evoadmissions.com/uslugi.htm
- EVO's about page lists 4,000+ successful enrollments, 60+ countries, 200
  partner institutions, 12 languages, and 5,000+ publications.
  Source: https://evoadmissions.com/o-nas.htm
- EVO's public services include higher education, secondary education, language
  courses attached to universities, and language schools.
  Source: https://evoadmissions.com/uslugi.htm
- EVO emphasizes objective country/program choice, scholarship support, visa
  support, document editing, and not forcing students into partner universities.
  Source: https://evoadmissions.com/o-nas.htm
- EVO's public contact path is consultation-first: assess admission chances,
  resolve fears/doubts, and create a personal action plan.
  Source: https://evoadmissions.com/contacts.htm

Implications:

- The CRM must support counseling and delivery after the sale, not only sales.
- The first screen for staff should show who needs a decision/action now:
  upcoming deadlines, missing documents, unanswered inquiries, stale cases,
  visa risks, payment blockers, and application statuses.
- Product copy should avoid overpromising admission or visa outcomes. EVO's
  public copy is confident but framed around support, strategy, transparency,
  and student potential.

### amoCRM Mechanics Worth Reusing

Facts from public amoCRM documentation:

- amoCRM's API model includes leads/deals, contacts, companies, tasks, notes,
  tags, sources, users/roles, products, webhooks, and pipelines/statuses.
  Source: https://www.amocrm.ru/developers/content/crm_platform/api-reference
- Pipelines contain ordered statuses; statuses have IDs, names, sort order,
  editability, pipeline ID, color, type, account ID, and optional descriptions.
  Source: https://www.amocrm.ru/developers/content/crm_platform/leads_pipelines
- Example pipeline statuses include "Unsorted", "Initial contact", "Making a
  decision", "Successfully closed", and "Closed and unrealized".
  Source: https://www.amocrm.ru/developers/content/crm_platform/leads_pipelines
- amoCRM has an "unsorted" intake concept for incoming calls, forms, and chats;
  incoming items can be accepted or linked.
  Source: https://www.amocrm.ru/developers/content/crm_platform/unsorted-api
- amoCRM webhooks can be triggered from pipeline stages to send data to a URL.
  Source: https://www.amocrm.ru/developers/content/digital_pipeline/webhooks

Implications:

- Use an intake inbox for WhatsApp/form/call inquiries before they become owned
  student records.
- Preserve source metadata: channel, form/page, messenger, referrer, campaign,
  created time, and phone/email.
- Statuses need order, color, descriptions, and permissions. A future UI should
  let admins explain what "ready to submit" or "visa risk high" means, not only
  rename a column.
- Do not flatten everything into one pipeline. A sales inquiry, a student file,
  each university application, document checks, and visa work have different
  status semantics.

### Study-Abroad CRM Patterns

Facts from public CRM/study-abroad sources:

- Student recruitment CRM is described as a system for capturing inquiries,
  managing relationships, and tracking interactions from first contact through
  enrollment.
  Source: https://www.leadsquared.com/us/education/student-recruitment-software/
- Higher-ed recruitment tools are differentiated from generic CRMs by student
  journey support: multichannel outreach, application tracking, event capture,
  enrollment analytics, multi-program support, and integrations.
  Source: https://www.leadsquared.com/us/education/student-recruitment-software/
- Study-abroad consultancies differ from short B2B sales cycles: a student
  inquiry may span many months, multiple countries, parents, counselor work,
  document work, tests, applications, visa risk, and intake changes.
  Source: https://erino.io/blog/crm-for-study-abroad-consultancies-india
- Public study-abroad CRM guidance highlights multi-contact records
  student-plus-parent, document checklists, intake-season views, lead leakage,
  counselor assignment, parent communication, and visa risk tracking.
  Source: https://erino.io/blog/crm-for-study-abroad-consultancies-india
- Education-agent CRM patterns emphasize visual pipeline management, lead
  capture, routing, centralized communication history, files, internal updates,
  handoffs, and automations.
  Source: https://monday.com/blog/crm-and-sales/education-agent-crm/
- Student recruitment CRM feature lists commonly include document management,
  communication automation, reporting/analytics, student portals, and
  integrations with existing systems.
  Source: https://www.edvisorly.com/university-insights/best-student-recruitment-crm
- Higher-education CRM is framed as a centralized engagement system for the full
  student lifecycle, not the same as a student information system.
  Source: https://eab.com/higher-education-glossary/higher-education-crm-guide/

Implications:

- A "sleeping" student is not necessarily lost. The CRM needs reactivation dates
  and next-intake reminders.
- Parent/guardian communication is first-class for Central Asia study-abroad
  work and should be logged next to student communication.
- Counselor workload must be visible by active files, urgent deadlines, stale
  follow-ups, and visa/application risk, not only by number of leads.
- Student portal requirements are real: students need status, missing docs,
  deadlines, payment checkpoints, and next step visibility.

## Product Copy

Primary staff-facing positioning:

```text
EVO Admissions OS
Все заявки, студенты, документы, дедлайны и коммуникации в одном рабочем центре.
От первого сообщения в WhatsApp до оффера, визы и вылета.
```

Alternate direct CRM positioning:

```text
CRM для поступления за границу
Контролируйте путь каждого студента: консультация, стратегия, заявки в вузы,
документы, стипендии, виза, оплата и зачисление.
```

Sales/dashboard headline:

```text
Сегодня требует внимания
Новые обращения, просроченные follow-up, дедлайны по заявкам, документы на
проверке и визовые риски.
```

Inquiry inbox copy:

```text
Новые обращения
Заявки из сайта, WhatsApp, Telegram, звонков и рекомендаций ждут разбора.
Назначьте ответственного, уточните цель и переведите обращение в консультацию.
```

Student file empty state:

```text
Пока нет активных действий
Добавьте страну, программу, дедлайн или следующий шаг, чтобы команда видела,
куда движется студент.
```

Application section copy:

```text
Заявки в университеты
Каждая программа живет отдельно: требования, дедлайн, документы, статус,
решение, стипендия и ответ студента.
```

Document section copy:

```text
Документы
Проверяйте готовность, версии, переводы, срок действия и статус отправки по
каждой стране и программе.
```

Visa section copy:

```text
Виза
Отслеживайте запись, финансовые доказательства, письмо о зачислении,
медосмотр/справки, подачу и решение.
```

Client portal copy:

```text
Ваш путь поступления
Здесь видны текущий этап, ближайшие дедлайны, недостающие документы и сообщения
от команды EVO.
```

AI copy guardrail:

```text
AI-черновик
Черновик помогает менеджеру быстрее ответить. Перед отправкой проверьте факты,
стоимость, дедлайны и визовые условия.
```

Do not use in product copy:

- "Гарантируем визу" unless a verified legal/commercial policy explicitly says
  so.
- "100% поступление" as a product promise.
- "Демо-режим отправил сообщение" as success.
- Generic "deal won" language in student-facing or counselor-facing surfaces.

## Data Model Terms

Use these as canonical product terms for later implementation work.

### People and Organizations

| Product term | Russian UI term | Purpose |
| --- | --- | --- |
| Student | Студент | Applicant/client receiving service. |
| Parent or guardian | Родитель/опекун | Decision-maker, payer, or minor guardian contact. |
| Inquiry | Обращение | Pre-consultation inbound request. |
| Student file | Дело студента | Active operational record after qualification/contract. |
| Mentor/Counselor | Ментор/консультант | Owns admissions strategy and student communication. |
| Sales manager | Менеджер продаж | Owns inquiry-to-contract path. |
| Document specialist | Специалист по документам | Owns checklist, versions, translations, verification. |
| Visa specialist | Визовый специалист | Owns visa checklist, appointment, submission, decision. |
| Partner institution | Партнерский вуз/школа | Institution with relationship to EVO. |
| University | Университет | Institution receiving applications. |
| Program | Программа | Specific degree/course target. |

### Core Objects

| Product term | Russian UI term | Notes |
| --- | --- | --- |
| Source event | Источник обращения | Website, WhatsApp, Telegram, call, referral, event, ad, partner. |
| Consultation | Консультация | Discovery call/meeting with outcome and next step. |
| Service package | Услуга | Full support, case review, secondary education, language course, document editing, visa support. |
| Country track | Трек страны | Destination-specific plan with requirements, intake, visa, funding. |
| College list | Список вузов | Dream/target/safety or comparable shortlist categories. |
| Application | Заявка в вуз | One university-program-intake attempt. |
| Intake | Набор | Start term: September/Fall, January/Winter, May/Spring, etc. |
| Document item | Документ | Requirement with status, owner, due date, expiry, version. |
| Scholarship target | Стипендия/грант | Internal or external funding path, deadline, documents. |
| Visa case | Визовое дело | Destination-specific visa process and risk record. |
| Payment | Платеж | Service fee, deposit, university fee, milestone. |
| Interaction | Контакт | WhatsApp, Telegram, call, email, meeting, internal note. |
| Task | Задача | Owner, due date, student/application/visa relation. |
| Risk flag | Риск | Academic, deadline, financial, visa, communication, document quality. |

## Recommended Status Taxonomy

### Inquiry Pipeline

Use for pre-contract sales and intake triage.

1. New inquiry
2. Needs triage
3. Contacted
4. Consultation scheduled
5. Consultation completed
6. Service proposal sent
7. Contract/deposit pending
8. Converted to student file
9. Sleeping or next intake
10. Lost/not fit

### Student File Pipeline

Use for active delivery after conversion.

1. Onboarding
2. Profile audit
3. Country/program strategy
4. College list approved
5. Documents and tests in progress
6. Applications in progress
7. Awaiting decisions
8. Offer/scholarship negotiation
9. Acceptance and deposit
10. Visa preparation
11. Visa submitted
12. Enrolled/departure prep
13. Archived/alumni

### Application Status

Use per university/program.

1. Considering
2. Shortlisted
3. Requirements confirmed
4. Documents drafting
5. Ready to submit
6. Submitted
7. Under review
8. Conditional offer
9. Offer
10. Waitlisted
11. Rejected
12. Accepted
13. Declined
14. Deferred

### Document Status

1. Needed
2. Requested from student
3. Drafting
4. Uploaded
5. In review
6. Revision needed
7. Verified
8. Translated/certified
9. Submitted
10. Expired

### Visa Status

1. Not started
2. Requirements confirmed
3. Financial proof in progress
4. Appointment needed
5. Appointment booked
6. Package ready
7. Submitted
8. Additional documents requested
9. Approved
10. Rejected
11. Reapplication strategy

## Realistic Countries and Program Flows

These flows are implementation templates, not legal advice. Each future country
module must verify the current requirement against official country, institution,
and visa sources before live use.

### United States Undergraduate

Evidence:

- EducationUSA says U.S. requirements vary by institution and students should
  check each international admissions office.
- Typical undergraduate requirements include credentials/transcripts,
  standardized tests if required, recommendation letters, and essay/personal
  statement.
- Typical U.S. undergraduate deadlines for September entry are between November
  and January.
  Source: https://educationusa.state.gov/your-5-steps-us-study/complete-your-application/undergraduate

CRM flow:

1. Profile audit and "spike" discovery.
2. Dream/target/safety college list.
3. Test plan: IELTS/TOEFL, SAT/ACT if required.
4. Essay narrative: personal statement, supplementals, activity list, resume.
5. Recommendation-letter tracker.
6. Financial aid/scholarship checklist.
7. Application submission by institution deadline.
8. Decision tracking: admit, reject, waitlist, scholarship/aid package.
9. Enrollment deposit and visa document path.

Required data:

- Application platform, institution portal, deadline, recommendation owners,
  essay status, test policy, scholarship/aid deadline, decision date.

### United Kingdom Undergraduate

Evidence:

- UCAS application includes personal statement, references, and up to five
  choices.
- For 2026 entry, UCAS notes the personal statement changes from one long text
  to three questions.
  Source: https://www.ucas.com/applying/applying-to-university/filling-in-your-ucas-application

CRM flow:

1. Course-focused strategy, because the UK path is program/course-specific.
2. Up to five UCAS choices with course code, campus, start date, and entry point.
3. Personal statement or 2026 structured-question drafting.
4. Reference request and completion.
5. UCAS submission/payment.
6. Offers: conditional/unconditional, firm/insurance choice.
7. CAS and student visa prep in later lane.

Required data:

- UCAS choice number, course code, campus, start date, entry point, reference
  owner, statement/question status, offer conditions.

### Canada College or University

Evidence:

- Canada study permit documents include letter of acceptance, PAL/TAL in most
  cases, CAQ for Quebec, proof of identity, proof of funds, explanation letter,
  and medical/police documents when required.
  Source: https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents.html

CRM flow:

1. DLI/program shortlist and eligibility check.
2. Application and offer/LOA tracking.
3. Accept offer and payment checkpoint.
4. PAL/TAL request or CAQ track for Quebec.
5. Study permit package: identity, funds, explanation, medical/police if needed.
6. Submission and biometrics/status tracking.

Required data:

- DLI/program, LOA status, PAL/TAL status, CAQ status, tuition payment proof,
  proof-of-funds package, visa-office-specific checklist.

### Germany Bachelor or Master

Evidence:

- DAAD says students need a recognized school leaving qualification or
  equivalence check, may apply directly or via uni-assist, and should check
  institution and program requirements.
- DAAD notes documents must be translated into German or English and certified.
- DAAD describes German visa/residence steps requiring admission, language
  proof where relevant, proof of funding, and health insurance.
  Source: https://www.daad.de/ziel-deutschland/pages/en/ankommen.html

CRM flow:

1. Qualification equivalence check.
2. Direct university vs. uni-assist route.
3. Language proof requirements.
4. Certified translation checklist.
5. Application submission and restricted-course earlier-deadline flag.
6. Admission letter.
7. Visa package: funding proof, health insurance, language proof, admission.
8. Arrival/residence permit tasks.

Required data:

- Route type, uni-assist status, qualification decision, language exam, certified
  translation status, restricted-course flag, funding proof, health insurance.

### Language Course and Partner-Route Programs

Evidence:

- EVO services include language courses at universities and language schools.
  Source: https://evoadmissions.com/uslugi.htm
- EVO public partner examples include institutions in Singapore, Switzerland,
  and Turkey on the homepage partner section.
  Source: https://evoadmissions.com/

CRM flow:

1. Course goal: university pathway, language improvement, conditional admission,
   summer/short-term.
2. Partner/school match.
3. Course dates, level, accommodation, price, refund policy.
4. Application and deposit.
5. Visa check if destination requires one.
6. Arrival and handoff support.

Required data:

- Partner institution, course type, language level, start/end dates, housing,
  invoice/deposit, visa requirement, emergency contact.

### Secondary Education

Evidence:

- EVO services include full support for admission to secondary school abroad.
  Source: https://evoadmissions.com/uslugi.htm

CRM flow:

1. Student age/grade and parent decision-maker record.
2. Boarding/day-school preference and safety requirements.
3. School shortlist.
4. Academic records and language tests.
5. Interview/exam tracking.
6. Guardian/custodian and accommodation workflow where required.
7. Visa/minor travel documents.

Required data:

- Parent/guardian contacts, consent status, grade/year target, accommodation,
  guardian/custodian requirement, school interview date, minor document checklist.

## Source-Backed UX Requirements

### 1. Intake Inbox Before CRM Conversion

Requirement:

- Build an inbox for website forms, WhatsApp, Telegram, calls, events, referrals,
  ads, and partner leads.
- Show source, channel, timestamp, contact info, duplicate hints, and suggested
  owner.
- Allow accept, reject, merge, or convert to inquiry/student file.

Evidence:

- amoCRM has unsorted intake for forms, calls, and chats.
- Study-abroad CRMs need multi-channel lead capture and routing.

### 2. Student File as the Main Workspace

Requirement:

- The student file must show profile, country tracks, applications, documents,
  visa, payments, tasks, interactions, parents/guardians, and risks in one place.
- Every module should answer: "What is blocked, who owns it, and by when?"

Evidence:

- EVO sells full-path support from strategy through visa.
- Public study-abroad CRM guidance identifies multi-stakeholder and multi-stage
  operations as the core gap generic CRMs miss.

### 3. Separate Pipelines for Different Work Types

Requirement:

- Keep separate status systems for inquiry, student file, application, document,
  visa, and payment work.
- Do not force application or visa work into sales-only columns.

Evidence:

- amoCRM supports pipelines/statuses as ordered entities.
- Study-abroad work includes multiple simultaneous country/program/application
  tracks, not a single linear sale.

### 4. Deadline and Intake Control

Requirement:

- Provide calendar views for application deadlines, scholarship deadlines,
  test dates, document expiry, payment due dates, visa appointments, and intake
  start dates.
- Support "sleeping until next intake" as an explicit state.

Evidence:

- EducationUSA and DAAD emphasize institution/program deadlines.
- Study-abroad CRM patterns highlight long nurture windows and intake-season
  views.

### 5. Document Checklist With Version and Expiry

Requirement:

- Each document needs owner, country/program relation, status, version, expiry,
  translation/certification flag, and submission target.
- Staff must be able to see missing or rejected documents without opening every
  student file.

Evidence:

- Canada and Germany official guidance both require specific documents and proof
  packages.
- Study-abroad CRM guidance repeatedly identifies document management as a core
  requirement.

### 6. Communication Timeline and Handoff Safety

Requirement:

- WhatsApp, Telegram, calls, email, meetings, notes, and internal comments must
  be visible in one timeline.
- Handoffs from sales to mentor, mentor to document team, and document team to
  visa team must include a reason, owner, due date, and next action.

Evidence:

- Education-agent CRM patterns emphasize centralized communication history and
  handoffs.
- EVO's work depends on multiple specialists across counseling, documents,
  scholarships, and visas.

### 7. Counselor and Team Dashboards

Requirement:

- Show active caseload, stale follow-ups, urgent deadlines, high-risk visa files,
  applications awaiting decision, and students without next action.
- Report by source, counselor, destination, intake, service package, and stage.

Evidence:

- Student recruitment CRM patterns emphasize analytics tied to enrollment
  outcomes, not only activity counts.

### 8. Student and Parent Portal

Requirement:

- Portal should show current stage, next steps, missing documents, deadlines,
  payment checkpoints, application statuses, and team messages.
- Parent/guardian visibility should be controlled per student file.

Evidence:

- Student recruitment CRM patterns include self-service portals.
- Study-abroad workflows commonly involve parents/guardians and long-running
  decisions.

### 9. AI Must Be Assistive, Not Authoritative

Requirement:

- AI output should be labeled as a draft and require human review.
- Prepared AI responses are allowed only for first presentation, per user
  instruction, and must not be represented as live Anthropic success.
- Live AI success requires real Anthropic configuration and real request/response
  evidence.

Evidence:

- The launch contract bans hidden fake integration success.
- EVO work includes high-risk facts: deadlines, visa rules, costs, and admission
  chances.

### 10. Privacy, Permissions, and Auditability

Requirement:

- Role permissions must protect student documents, payment data, visa records,
  and parent contact details.
- Important changes should record who changed what and when.
- Export/sharing flows must not leak sensitive data into public or demo surfaces.

Evidence:

- Student recruitment sources identify transcripts, test scores, and credentials
  as sensitive records.
- amoCRM's official model includes users/roles, notes, events, and permissions
  as first-class CRM concerns.

## Build Implications for Future Lanes

Do first:

1. Add validation/test infrastructure and fix known dependency/security blockers.
2. Replace demo/fake success wording with explicit presentation-only labels or
   hard blockers.
3. Convert UI/data labels from generic CRM to EVO-specific student operations.
4. Add real input schemas for webhooks, AI routes, and Server Actions.
5. Add real E2E flows for staff login, inquiry triage, student file creation,
   document update, application status change, and client portal visibility.

Do not do first:

- A decorative dashboard redesign without source-backed workflow improvements.
- More AI features before truthfulness and credential gates are fixed.
- A single universal pipeline for every object.
- Fake WhatsApp/AI/telephony success states.
- Country-specific legal/visa advice without official source verification.

## Source Map

EVO brand and services:

- https://evoadmissions.com/
- https://evoadmissions.com/uslugi.htm
- https://evoadmissions.com/o-nas.htm
- https://evoadmissions.com/contacts.htm

amoCRM mechanics:

- https://www.amocrm.ru/developers/content/crm_platform/api-reference
- https://www.amocrm.ru/developers/content/crm_platform/leads_pipelines
- https://www.amocrm.ru/developers/content/crm_platform/unsorted-api
- https://www.amocrm.ru/developers/content/digital_pipeline/webhooks

Study-abroad and education CRM patterns:

- https://www.leadsquared.com/us/education/student-recruitment-software/
- https://erino.io/blog/crm-for-study-abroad-consultancies-india
- https://monday.com/blog/crm-and-sales/education-agent-crm/
- https://www.edvisorly.com/university-insights/best-student-recruitment-crm
- https://eab.com/higher-education-glossary/higher-education-crm-guide/
- https://www.salesforce.com/education/crm/

Country/program flow references:

- https://educationusa.state.gov/your-5-steps-us-study/complete-your-application/undergraduate
- https://www.ucas.com/applying/applying-to-university/filling-in-your-ucas-application
- https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/get-documents.html
- https://www.daad.de/en/studying-in-germany/requirements/
- https://www.daad.de/ziel-deutschland/pages/en/ankommen.html
