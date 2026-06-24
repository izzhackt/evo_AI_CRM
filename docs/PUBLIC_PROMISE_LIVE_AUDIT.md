# Public Promise Live Audit

Status: blocked.
Generated: 2026-06-25T04:42:36.186Z.

This is a live network audit of the external `evoadmissions.com` public website.
The CRM repo cannot change those pages directly; use this report to verify the website/CMS copy handoff.

## Pages Checked

- https://evoadmissions.com/
- https://evoadmissions.com/uslugi.htm
- https://evoadmissions.com/o-nas.htm
- https://evoadmissions.com/contacts.htm

## Acceptable Clear Conditions

- Outcome guarantee-style claims clear only after removal or audited outcome evidence with a real date.
- Grant wording clears only when paired with a clear non-guarantee boundary for admission, grants, scholarships, or visas.
- Numeric claims clear only after removal or source/date evidence such as an approved internal case base, registry, analytics source, or dataset date.
- Consultation chance-assessment copy clears only when the page includes `не является гарантией` language.

## Findings

| Risk | Rule | Page | Evidence | Required action |
| --- | --- | --- | --- | --- |
| high | PUBLIC-OUTCOME-100 | Home | почти до 100% | Replace with process-control language from docs/PUBLIC_PROMISE_COPY_CHANGESET.md or provide audited outcome evidence. |
| high | PUBLIC-NO-STUDENT-WITHOUT-INVITATION | Home | ни один студент не остается без приглашения | Remove the guarantee-style sentence or provide audited outcome evidence. |
| high | PUBLIC-100-GRANT | Home | 100% грант | Rewrite as grant and financial-aid preparation with a clear non-guarantee boundary. |
| high | PUBLIC-60-COUNTRIES | Home | 60+ стран | Attach an approved country-coverage dataset/date or remove the metric. |
| high | PUBLIC-CONSULTATION-NO-GUARANTEE | Home | Оценим ваши шансы | Add the non-guarantee wording from docs/PUBLIC_PROMISE_COPY_CHANGESET.md. |
| high | PUBLIC-4000-METRIC | Services | 4 000+ Успешных зачислен | Attach an approved source/date or remove the metric from customer-facing copy. |
| high | PUBLIC-60-COUNTRIES | Services | 60+ Стран | Attach an approved country-coverage dataset/date or remove the metric. |
| high | PUBLIC-MAX-CHANCES | Services | максимальные шансы на поступлен | Rewrite as a route selected against program requirements and current student profile. |
| high | PUBLIC-CONSULTATION-NO-GUARANTEE | Services | Оценим ваши шансы | Add the non-guarantee wording from docs/PUBLIC_PROMISE_COPY_CHANGESET.md. |
| high | PUBLIC-4000-METRIC | About | зачислений Наши студенты учатся в топовых вузах мира — Гарварде, Сорбонне, Мюнхенском техническом и других 4 000+ | Attach an approved source/date or remove the metric from customer-facing copy. |
| high | PUBLIC-60-COUNTRIES | About | 60+ стран | Attach an approved country-coverage dataset/date or remove the metric. |
| high | PUBLIC-200-PARTNERS | About | Партнерских заведений Партнеры EVO Admissions есть по всему миру от США и Великобритании до Сербии и Новой Зеландии 200 | Attach an approved partner registry/date or remove the metric. |
| medium | PUBLIC-1700000-READERS | About | 1 700 000+ | Attach analytics evidence/date or remove the metric. |
| medium | PUBLIC-5000-PUBLICATIONS | About | 5 000+ | Attach publication inventory evidence/date or remove the metric. |
| high | PUBLIC-CONSULTATION-NO-GUARANTEE | About | Оценим ваши шансы | Add the non-guarantee wording from docs/PUBLIC_PROMISE_COPY_CHANGESET.md. |
| high | PUBLIC-CONSULTATION-NO-GUARANTEE | Contacts | Оценим ваши шансы | Add the non-guarantee wording from docs/PUBLIC_PROMISE_COPY_CHANGESET.md. |

## Completion Gate

`npm run public-promise-audit` must pass before the promise-audit goal can be marked complete.

Medium-risk metric claims still require source/date evidence before being presented as proven.
