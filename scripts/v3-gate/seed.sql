-- Сид прототипа V3: воспроизводит ту же картину, что была в исходной базе.
-- Даты считаются от current_date, чтобы «сегодня» и «просрочено» не протухали.
begin;

-- Шина событий защищена триггером «append-only»: это правильно для продукта,
-- но сид должен быть перезапускаемым. Триггер снимается только на время
-- очистки и возвращается сразу же. Это локальная база прототипа.
alter table evo_business_events disable trigger user;

truncate evo_business_events, evo_finance_stop_states, evo_sales_admissions_handoffs,
         evo_sales_gate_evidence, evo_messages, evo_conversations, evo_admissions_tasks,
         evo_visa_milestones, evo_university_applications, evo_student_cases,
         evo_leads, evo_people cascade;

-- ---- люди ----
insert into evo_people (id, full_name, phone_e164, email)
select gen_random_uuid()::text, name, phone, email from (values
  ('Ahmed Bin Khalid Al-Suwaidi','+971501234501','ahmed.suwaidi@example.ae'),
  ('София Игоревна Лебедева','+79161234502','s.lebedeva@example.ru'),
  ('Kwame Osei-Bonsu','+233201234503','k.osei@example.gh'),
  ('Тимур Ержанович Абдрахманов','+77011234504','t.abdrakhmanov@example.kz'),
  ('Chen Wei-Lin','+8613800000505','chen.weilin@example.cn'),
  ('Fatima Al-Mansouri','+971501234506','f.mansouri@example.ae'),
  ('Айгерим Сериковна Нурланова','+77011234507','a.nurlanova@example.kz'),
  ('Дмитрий Валерьевич Кузнецов','+79161234508','d.kuznetsov@example.ru'),
  ('Anastasia Petrova-Vasilyeva','+79161234509','a.petrova@example.ru'),
  ('Mohammed Hassan Abdel-Rahman','+201001234510','m.hassan@example.eg'),
  ('Rustam Abdullayev','+998901234511','r.abdullayev@example.uz'),
  ('Мария Александровна Ковалёва','+79161234512','m.kovaleva@example.ru'),
  ('Ibrahim Yusuf Diallo','+221701234513','i.diallo@example.sn'),
  ('Nguyen Thi Minh Anh','+84901234514','n.minhanh@example.vn'),
  ('Priya Venkataraman','+919812345515','p.venkataraman@example.in'),
  ('Жанара Бекболатовна Аманжолова','+77011234516','zh.amanzholova@example.kz'),
  ('Олег Петрович Сидоренко','+380671234517','o.sidorenko@example.ua'),
  ('Екатерина Дмитриевна Морозова','+79161234518','e.morozova@example.ru')
) as t(name, phone, email);

-- ---- лиды ----
-- owner_role у лида всегда 'sales': это не выбор сида, а CHECK в схеме.
-- Стадии и сроки те же, что были: 5 новых без действия, 4 на квалификации,
-- 5 квалифицированных, 1 готов к передаче, 4 переданы.
-- created_at задаётся явно: по умолчанию он равен now(), и тогда «появился»
-- у каждого лида показывало бы сегодняшний день — человек, пришедший минуту
-- назад и уже дошедший до передачи, выглядит абсурдно.
insert into evo_leads (id, person_id, source, stage, owner_role, next_action, next_action_at, created_at, updated_at)
select gen_random_uuid()::text, p.id, v.source, v.stage, v.owner,
       v.action,
       case when v.due is null then null else current_date + v.due * interval '1 day' + interval '10 hours' end,
       now() - v.age * interval '1 day',
       now() - v.age * interval '1 day'
from (values
  ('Ahmed Bin Khalid Al-Suwaidi','whatsapp','new','sales',null,null,3),
  ('Chen Wei-Lin','whatsapp','new','sales',null,null,3),
  ('Fatima Al-Mansouri','referral','new','sales',null,null,3),
  ('Айгерим Сериковна Нурланова','whatsapp','new','sales',null,null,3),
  ('Дмитрий Валерьевич Кузнецов','website','new','sales',null,null,3),
  ('Rustam Abdullayev','referral','qualifying','sales','Созвониться и уточнить бюджет',0,12),
  ('Anastasia Petrova-Vasilyeva','whatsapp','qualifying','sales','Созвониться и уточнить бюджет',1,12),
  ('Mohammed Hassan Abdel-Rahman','website','qualifying','sales','Созвониться и уточнить бюджет',2,12),
  ('Мария Александровна Ковалёва','website','qualifying','sales','Созвониться и уточнить бюджет',4,12),
  ('Олег Петрович Сидоренко','website','qualified','sales','Собрать пакет документов и подтвердить программу',0,21),
  ('Priya Venkataraman','referral','qualified','sales','Собрать пакет документов и подтвердить программу',1,21),
  ('Ibrahim Yusuf Diallo','whatsapp','qualified','sales','Собрать пакет документов и подтвердить программу',2,21),
  ('Жанара Бекболатовна Аманжолова','referral','qualified','sales','Собрать пакет документов и подтвердить программу',3,21),
  ('Nguyen Thi Minh Anh','whatsapp','qualified','sales','Собрать пакет документов и подтвердить программу',4,21),
  ('Екатерина Дмитриевна Морозова','website','handoff_ready','sales','Собрать пакет документов и подтвердить программу',3,28),
  ('София Игоревна Лебедева','whatsapp','handed_off','sales',null,null,40),
  ('Kwame Osei-Bonsu','website','handed_off','sales',null,null,40),
  ('Тимур Ержанович Абдрахманов','referral','handed_off','sales',null,null,40),
  ('Ahmed Bin Khalid Al-Suwaidi','referral','handed_off','sales',null,null,40)
) as v(person, source, stage, owner, action, due, age)
join evo_people p on p.full_name = v.person;

-- ---- кейсы студентов: по одному на каждый переданный лид ----
insert into evo_student_cases (id, person_id, lead_id, status, owner_role)
select gen_random_uuid()::text, l.person_id, l.id, 'active', 'admissions'
from evo_leads l where l.stage = 'handed_off';

-- ---- заявки в вузы ----
insert into evo_university_applications
  (id, student_case_id, institution_name, program_name, target_intake, status, owner_role, next_action, next_action_at)
select gen_random_uuid()::text, sc.id,
  'Mohamed bin Zayed University of Artificial Intelligence', 'MSc Computer Vision', 'Fall 2026',
  'draft', 'admissions', 'Загрузить рекомендательные письма',
  current_date + (row_number() over (order by sc.id) + 3) * interval '1 day'
from evo_student_cases sc;

-- ---- визовые вехи: шесть на кейс, все ещё не начаты ----
insert into evo_visa_milestones (id, student_case_id, milestone_kind, status, owner_role)
select gen_random_uuid()::text, sc.id, k.kind, 'pending', 'admissions'
from evo_student_cases sc
cross join (values ('document_preparation'),('submission'),('appointment'),
                   ('biometrics'),('interview'),('decision')) as k(kind);

-- ---- задачи приёмной кампании ----
insert into evo_admissions_tasks (id, student_case_id, title, status, assigned_role, due_at, closure_reason)
select gen_random_uuid()::text, sc.id, t.title, t.status, 'admissions',
       case when t.due is null then null else current_date + t.due * interval '1 day' + interval '12 hours' end,
       t.reason
from evo_student_cases sc
cross join (values
  ('Проверить нострификацию аттестата','open',1,null),
  ('Подтвердить IELTS и загрузить сертификат','open',3,null),
  ('Подготовить первичный план запроса документов','open',null,null),
  ('Подтвердить маршрут обучения и недостающие данные','open',null,null),
  ('Проверить унаследованный контекст Sales','open',null,null)
) as t(title, status, due, reason)
where not (sc.id = (select min(id) from evo_student_cases) and t.title = 'Проверить унаследованный контекст Sales');

-- одна отменённая — чтобы фильтр «Закрытые» не был пустым
insert into evo_admissions_tasks (id, student_case_id, title, status, assigned_role, closed_at, closed_by_role, closure_reason)
select gen_random_uuid()::text, min(id), 'Проверить унаследованный контекст Sales', 'cancelled', 'admissions',
       now(), 'admin', 'Дубликат: контекст уже перенесён при передаче'
from evo_student_cases;

-- ---- диалоги и сообщения: только входящие, ответов нет ----
insert into evo_conversations (id, lead_id, channel, status, owning_role)
select gen_random_uuid()::text, l.id, 'whatsapp', 'open',
       case when l.stage = 'handed_off' then 'admissions' else 'sales' end
from evo_leads l
join evo_people p on p.id = l.person_id
where (p.full_name, l.stage) in (
  ('Айгерим Сериковна Нурланова','new'),
  ('Chen Wei-Lin','new'),
  ('Ahmed Bin Khalid Al-Suwaidi','new'),
  ('София Игоревна Лебедева','handed_off'));

-- Входящему сообщению схема требует external_message_id: это идентификатор
-- у WAHA, и без него сообщение не считается пришедшим извне.
insert into evo_messages (id, conversation_id, direction, body, external_message_id, occurred_at, correlation_id, idempotency_key)
select gen_random_uuid()::text, c.id, 'inbound', m.body, 'waha-' || gen_random_uuid()::text,
       current_date - interval '3 days' + m.offset_min * interval '1 minute',
       gen_random_uuid()::text, gen_random_uuid()::text
from evo_conversations c
join evo_leads l on l.id = c.lead_id
join evo_people p on p.id = l.person_id
join (values
  ('Айгерим Сериковна Нурланова','Здравствуйте! Хочу узнать про поступление в MBZUAI',540),
  ('Айгерим Сериковна Нурланова','Какие сроки подачи на осень 2026?',554),
  ('Chen Wei-Lin','Hello, I saw your Instagram. Do you help with UAE student visas?',540),
  ('Ahmed Bin Khalid Al-Suwaidi','Договор подписал, оплату отправил вчера',540),
  ('Ahmed Bin Khalid Al-Suwaidi','Пришлите, пожалуйста, список документов',554),
  ('София Игоревна Лебедева','Good afternoon, when is my application submitted?',540)
) as m(person, body, offset_min) on m.person = p.full_name;

-- ---- передачи в приёмную и основания ----
insert into evo_sales_gate_evidence
  (id, lead_id, evidence_type, decision, evidence_reference, amount_minor, currency,
   recorded_by_role, occurred_at, correlation_id, idempotency_key)
-- Схема требует: у договора нет суммы и валюты, у платежа есть обе.
select gen_random_uuid()::text, sc.lead_id, e.kind, 'confirmed', 'doc-' || left(sc.id, 8),
       e.amount, e.currency, 'sales', now() - interval '2 days', gen_random_uuid()::text, gen_random_uuid()::text
from evo_student_cases sc
cross join (values ('contract', null::integer, null::text),
                   ('first_payment', 1500000, 'AED')) as e(kind, amount, currency);

insert into evo_sales_admissions_handoffs
  (id, lead_id, student_case_id, contract_evidence_id, first_payment_evidence_id,
   is_override, executed_by_role, correlation_id, idempotency_key, executed_at)
select gen_random_uuid()::text, sc.lead_id, sc.id,
       (select id from evo_sales_gate_evidence e where e.lead_id = sc.lead_id and e.evidence_type='contract'),
       (select id from evo_sales_gate_evidence e where e.lead_id = sc.lead_id and e.evidence_type='first_payment'),
       false, 'sales', gen_random_uuid()::text, gen_random_uuid()::text, now() - interval '2 days'
from evo_student_cases sc;

-- ---- финансовый стоп: один настоящий блокер ----
insert into evo_finance_stop_states (id, student_case_id, is_stopped, reason, changed_by_role)
select gen_random_uuid()::text, sc.id, true,
       'Вторая часть оплаты не поступила; удерживаем подачу до подтверждения банка.',
       'admissions'
from evo_student_cases sc
join evo_leads l on l.id = sc.lead_id
join evo_people p on p.id = l.person_id
where p.full_name = 'Ahmed Bin Khalid Al-Suwaidi';

-- ---- шина событий ----
-- Переход, в названии которого есть stop/cancel/reject/override/…, обязан
-- нести причину: схема не даёт записать такое событие молча.
insert into evo_business_events
  (id, actor_role, business_object_type, business_object_id, transition, from_state, to_state,
   reason, correlation_id, idempotency_key, occurred_at)
select gen_random_uuid()::text, r.role, r.otype, r.oid, r.transition, r.from_state, r.to_state,
       case when r.transition ~ '(override|reject|stop|release|close|cancel|disqual)'
            then coalesce(r.reason, 'Причина зафиксирована в карточке') end,
       gen_random_uuid()::text, gen_random_uuid()::text, r.at
from (
  select 'sales' as role, 'lead' as otype, id as oid, 'lead.created' as transition,
         null as from_state, 'new' as to_state, null::text as reason, created_at - interval '5 days' as at from evo_leads
  union all
  select 'admissions','student_case', id, 'student_case.created', null, 'active', null, created_at - interval '2 days' from evo_student_cases
  union all
  select 'admissions','application', id, 'application.created', null, 'draft', null, created_at - interval '2 days' from evo_university_applications
  union all
  select 'admissions','visa_milestone', id, 'visa_milestone.created', null, 'pending', null, created_at - interval '2 days' from evo_visa_milestones
  union all
  select 'admissions','task', id, 'task.created', null, 'open', null, created_at - interval '1 days' from evo_admissions_tasks
  union all
  select 'sales','handoff', student_case_id, 'sales_admissions.handed_off', 'handoff_ready', 'handed_off', null, executed_at from evo_sales_admissions_handoffs
  union all
  select 'admissions','finance_stop', student_case_id, 'finance_stop.asserted', null, 'stopped', reason, changed_at from evo_finance_stop_states
  union all
  select 'sales','message', conversation_id, 'message.received', null, 'received', null, occurred_at from evo_messages
) as r;

alter table evo_business_events enable trigger user;

commit;

-- ---- сводка квалификации: то, что продажи узнали про человека ----
-- Дописывается отдельно: у лида это текущий контекст работы, и без неё блок
-- «Продажа» на профиле пустой.
update evo_leads l set qualification_summary = v.summary
from (values
  ('Rustam Abdullayev','Бюджет до 60k AED, готов к осеннему набору. Нужен разбор требований по IELTS.'),
  ('Anastasia Petrova-Vasilyeva','Ищет магистратуру по CV. Бюджет уточняется, родители участвуют в решении.'),
  ('Mohammed Hassan Abdel-Rahman','Есть бакалавр по CS, спрашивает про стипендию.'),
  ('Мария Александровна Ковалёва','Рассматривает MBZUAI и ещё два вуза, решение к концу месяца.'),
  ('Олег Петрович Сидоренко','Документы почти собраны, ждём подтверждение программы.'),
  ('Priya Venkataraman','Сильный профиль, GRE сдан. Нужен договор.'),
  ('Ibrahim Yusuf Diallo','Требуется нострификация диплома, предупреждён о сроках.'),
  ('Жанара Бекболатовна Аманжолова','Оплату подтвердит после согласования с работодателем.'),
  ('Nguyen Thi Minh Anh','Готова подавать, ждёт список документов.'),
  ('Екатерина Дмитриевна Морозова','Договор подписан, первый платёж прошёл. Готова к передаче в приёмную.'),
  ('София Игоревна Лебедева','Договор и оплата подтверждены, передана в приёмную.'),
  ('Kwame Osei-Bonsu','Договор и оплата подтверждены, передан в приёмную.'),
  ('Тимур Ержанович Абдрахманов','Договор и оплата подтверждены, передан в приёмную.'),
  ('Ahmed Bin Khalid Al-Suwaidi','Договор подписан, первый платёж прошёл. Вторая часть оплаты под вопросом.')
) as v(person, summary)
where l.person_id = (select id from evo_people p where p.full_name = v.person)
  and l.stage <> 'new';
