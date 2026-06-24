# Public Promise Copy Changeset

Status: external website handoff, 2026-06-24.

This repo does not contain the `evoadmissions.com` website source or CMS.
Apply this changeset in the website repo/CMS or provide source datasets that
prove the current claims.

## Sources

- `https://evoadmissions.com/`
- `https://evoadmissions.com/uslugi.htm`
- `https://evoadmissions.com/o-nas.htm`
- `https://evoadmissions.com/contacts.htm`

## Required Changes

### Home Page

Location: `https://evoadmissions.com/`

Current high-risk claim:

> Повышаем шансы почти до 100%

Recommended replacement:

> Повышаем управляемость процесса поступления

Current high-risk support text:

> В итоге ни один студент не остается без приглашения.

Recommended replacement:

> В итоге у каждого студента есть понятная стратегия, список приоритетных
> программ, дедлайны и следующие шаги. Итог поступления зависит от профиля
> студента, требований вузов и конкурсной ситуации.

Current risky grant wording:

> Марафон, охватывающий всё, что нужно для поступления на 100% грант.

Recommended replacement:

> Марафон по подготовке к подаче на гранты и финансовую помощь: стратегия,
> документы, дедлайны и требования программ.

### Services Page

Location: `https://evoadmissions.com/uslugi.htm`

Current metric claims:

> Мы помогли уже 4 тысячам абитуриентов...
> 4 000+ успешных зачислений
> 60+ стран по всему миру

If source datasets are available, keep metrics but add an evidence note:

> По внутренней базе кейсов EVO Admissions на дату `YYYY-MM-DD`.

If source datasets are not available, replace with:

> Мы сопровождаем абитуриентов на разных этапах поступления за рубеж: от выбора
> страны и программы до подготовки документов и коммуникации с университетами.

Replace metric cards with evidence-safe cards:

- `Стратегия поступления`
- `Подбор стран и программ`
- `Документы, дедлайны и коммуникация`

Current risky language-course wording:

> обеспечив максимальные шансы на поступление

Recommended replacement:

> помогая выбрать маршрут с учетом требований программы и текущего профиля
> студента

### About Page

Location: `https://evoadmissions.com/o-nas.htm`

Current metric claims:

- `1 место`
- `4 000+ успешных зачислений`
- `12 иностранных языков`
- `7 лет средний опыт`
- `60+ стран`
- `200 партнерских заведений`
- `5 000+ публикаций`
- `1 700 000+ читателей в месяц`

If metrics are retained, each must have an owner-approved source:

- dataset name or analytics source
- date range
- calculation rule
- owner responsible for updates

If metrics are not immediately provable, replace the section with:

> EVO Admissions сегодня
>
> Мы работаем как образовательное агентство полного сопровождения: помогаем
> студентам разобраться в требованиях программ, подготовить документы, следить
> за дедлайнами и проходить этапы поступления без хаоса.

Recommended evidence-safe cards:

- `Страны и программы`: подбор под цели, бюджет и профиль студента.
- `Документы и дедлайны`: контроль требований, статусов и сроков.
- `Команда менторов`: сопровождение от консультации до финального решения.
- `Финансовая помощь`: поиск грантов и стипендий, когда студент подходит под
  критерии программы.

### Contact Page

Location: `https://evoadmissions.com/contacts.htm`

Current consultation promises are acceptable if framed as consultation scope:

- assess chances
- discuss doubts
- propose next steps

Recommended wording:

> На консультации мы разберем ваш профиль, цели, сроки и ограничения, затем
> предложим реалистичный следующий шаг. Консультация не является гарантией
> поступления, гранта или визы.

## Acceptance Checks

After applying website changes, verify:

- No public page contains `почти до 100%`.
- No public page contains `ни один студент не остается без приглашения`.
- No public page contains `100% грант` unless the phrase is clearly about an
  application target and includes a non-guarantee disclaimer.
- Numeric claims such as `4 000+`, `60+`, `200`, `1 700 000+`, and `5 000+`
  either cite an approved source/date or are removed from customer-facing copy.
- Consultation copy includes a clear non-guarantee boundary for admission,
  grants, scholarships, visas, and deadlines.

## CRM Demo Rule

Until the website changes above are applied or source datasets are supplied, CRM
demos, AI answers, screenshots, and sales decks must not repeat the external
high-risk claims. Use the controlled product policy in `docs/PROMISE_AUDIT.md`
instead.
