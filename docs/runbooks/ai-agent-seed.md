# ИИ-агент: начальное наполнение и папка «ИИ-ассистент»

Обновлено: 2026-10-06. Статус: **процедура, не выполнялась**. План —
[docs/EVO_AI_AGENT_PLAN_2026-10-06.md](../EVO_AI_AGENT_PLAN_2026-10-06.md) §13,
§14 и §18 (вопрос 2). Документ ничего не разрешает: каждый шаг, который пишет в
production (шаги 2, 3, 4 и 6, а также их репетиции), выполняется только после
явного разрешения владельца на этот шаг. Агент (Claude, Codex) эту процедуру
сам не выполняет: её проводит admin EVO — владелец или оператор с его
письменным разрешением, названным поимённо.

Что делается и почему: «ИИ-агент» получает свою базу «Информация для агента» и
«Правила общения» (Q3). Из «Базы знаний» в неё **копируются** только страницы
закрытого списка (§14). Затем папка «ИИ-ассистент» уходит в корзину «Базы
знаний» (Q2 «a») — обратимо. Копирует только admin, потому что «База знаний»
только для admin (решение E, 244); у роли агента нет ни одной функции, которая
читает «Базу знаний».

## Что получится

Числа проверены 06.10 только чтением production (агрегаты, без текстов страниц).

| Шаг | Что | Куда | Страниц |
|---|---|---|---|
| 2 | «Для клиентов»: «ИИ-ассистент → Вопросы и ответы» (3), «Компания → Услуги и условия EVO» (2), «Страны и поступление» (4) — пометка импорта `historically_approved_general_client_knowledge` | «Информация для агента», аудитория «Для клиентов» | 9 |
| 3 | «Внутреннее»: «Компания» (10) и «Страны и поступление» (223) — пометка `historically_approved_internal_knowledge` | «Информация для агента», аудитория «Внутреннее» | 233 |
| 4 | «ИИ-ассистент → Правила ответов → Утверждено для ИИ», затем «ИИ-ассистент → Продажи и ответы → FAQ по обучению и визе» | «Правила общения», версия `seed`, «нужна проверка» | 2 |
| 6 | Папка «ИИ-ассистент» целиком: 16 узлов — 10 папок (сама папка и 9 подпапок), 6 страниц, файлов нет | корзина «Базы знаний» | — |

Не копируются никогда: README «Правила базы» (страница «Клиентская база знаний
ЭВО» — описание самой базы), 122 рабочих материала «Компании» и «Стран и
поступления», любые файлы KB (`kind = file`), области `raw`, `secrets` и
`clients`, «Панель управления», «Служебные файлы локальной базы». Это
проверяет сама `platform.ai_agent_seed_from_kb_v1`: узел вне закрытого списка
отклоняет весь вызов (`ai_seed_node_not_allowed`).

Отличие от плана: §14 называет страницы «Вопросы и ответы» одним документом
«FAQ (из базы знаний 19.09)». Функция копирует постранично, поэтому
получится 3 клиентских документа с названиями страниц. Переименовать их можно
позже в «Информации для агента» (`ai_agent_document_update_v1`). Примерами
ответов они становятся только после подтверждения в Лаборатории (P2).

## Перед началом

1. **Ledger.** В production применены миграции 267–269 (ИИ-агент P1). Проверка —
   только чтение: `gh workflow run evo-schema-ledger.yml --repo izzhackt/evo_AI_CRM -f mode=check`.
2. **Агент включён.** Выпуск с профилем `ai-agent`: службы `ai-agent-api` и
   `ai-agent-worker` здоровы (`/v1/ready`), ключ Gemini лежит в
   `.env.ai-agent` на hermes, у роли `evo_ai_agent` есть пароль
   (ADR 0032, план §4). Без работающего worker документы останутся в очереди.
3. **Согласие на Gemini записано admin** (Q4, §13):
   `platform.ai_agent_consent_record_v1(<организация>, 'grant', <версия текста>, <request id>)` —
   кнопка в «ИИ-агент → Настройки», когда появится оболочка раздела. Без
   согласия worker не может зарезервировать бюджет на эмбеддинги
   (`consent_required`), документы закончатся статусом `failed`.
4. **Выпущен этот PR** (срез 6): перенос «Базы знаний» больше не создаёт
   «ИИ-ассистент». Старый код папку тоже не пересоздаст молча: найдя её в
   корзине, он останавливает перенос с ошибкой «Папка переноса находится в
   архиве или корзине».
5. **Координация.** По AGENTS «Astra owns the knowledge scope»: о шаге 6
   сообщить текущему координатору знаний.
6. **Что подставить.** `<ORGANIZATION_ID>` — организация EVO (`EVO_PLATFORM_ORGANIZATION_ID`).
   `<ADMIN_AUTH_USER_ID>` — id своей учётной записи admin из Supabase Dashboard →
   Authentication → Users (своя строка; чужой id не подставлять). `<REQUEST_ID>` —
   новый UUID на каждый шаг (`uuidgen | tr A-Z a-z`); записать его: повтор
   шага 2 или 3 с тем же id возвращает сохранённую квитанцию и ничего не
   копирует второй раз (повтор шага 4 останавливает охрана — см. шаг 4).
   `<EXPECTED_COUNT>` — число страниц шага из шага 1.

## Как admin вызывает функцию

Кнопки начального наполнения в CRM нет: по плану (§14, п. 5) оболочка
«ИИ-агента» даст admin только «Обновить из базы знаний» у уже скопированного
документа.
Поэтому шаги 2–4 выполняются в Supabase Dashboard → SQL Editor одним
блоком `BEGIN … COMMIT`:

- блок получает claims своей учётной записи admin той же функцией, что и вход
  (`platform_private.custom_access_token_hook`), и переходит в роль
  `authenticated`. Дальше всё проверяет сама `ai_agent_seed_from_kb_v1`:
  admin (`kb_require_admin`), закрытый список, идемпотентность по
  `<REQUEST_ID>`, запись в `platform.audit_events` от имени этого admin;
- список страниц выбирается до смены роли тем же закрытым списком, что в
  функции. Если число не совпало с `<EXPECTED_COUNT>` или claims не admin
  (а в шаге 4 — и если «Правила общения» уже не пусты), блок
  останавливается до вызова и ничего не пишет;
- **репетиция:** тот же блок с `ROLLBACK;` вместо `COMMIT;` показывает
  квитанцию и ничего не сохраняет — ни документов, ни очереди, ни аудита.

Никогда не править `platform_private.ai_*` и `platform_private.kb_*` прямыми
`INSERT`/`UPDATE`/`DELETE`: без функции нет проверки списка и аудита.

## Шаг 1. Предпросмотр (только чтение)

```sql
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = '<ORGANIZATION_ID>' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = '<ORGANIZATION_ID>' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT CASE
    WHEN classification = 'historically_approved_general_client_knowledge'
      AND (root <> 'ИИ-ассистент' OR sub = 'Вопросы и ответы') THEN '2. Для клиентов'
    WHEN classification = 'historically_approved_internal_knowledge'
      AND root <> 'ИИ-ассистент' THEN '3. Внутреннее'
    WHEN root = 'ИИ-ассистент' AND sub IN ('Правила ответов', 'Продажи и ответы') THEN '4. Правила общения'
    ELSE '-. не копируется' END AS step,
  count(*) AS pages
FROM allow GROUP BY 1 ORDER BY 1;
```

Ожидается (06.10): `2. Для клиентов` — 9, `3. Внутреннее` — 233,
`4. Правила общения` — 2, `-. не копируется` — 1 (README «Правила базы»).
Другое число — остановиться и выяснить, что изменилось в «Базе знаний». Если
шаг 3 больше 300 страниц, его надо разбить по корневой папке (функция берёт
до 300 узлов за вызов).

Состав папки «ИИ-ассистент» до шага 6 (только чтение, названия, без текстов):

```sql
WITH RECURSIVE folder AS (
  SELECT n.id, n.kind, n.title::TEXT AS path, n.deleted_at, n.delete_batch
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = '<ORGANIZATION_ID>' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.title = 'ИИ-ассистент'
  UNION ALL
  SELECT c.id, c.kind, f.path || ' / ' || c.title, c.deleted_at, c.delete_batch
  FROM platform_private.kb_nodes c JOIN folder f ON c.parent_id = f.id
  WHERE c.organization_id = '<ORGANIZATION_ID>'
)
SELECT count(*) AS nodes, count(*) FILTER (WHERE kind = 'folder') AS folders,
  count(*) FILTER (WHERE kind = 'page') AS pages, count(*) FILTER (WHERE kind = 'file') AS files,
  count(*) FILTER (WHERE deleted_at IS NOT NULL) AS in_trash, count(DISTINCT delete_batch) AS trash_batches
FROM folder;
```

Ожидается до шага 6: 16 узлов, 10 папок (`folders` считает и саму папку, и 9
подпапок), 6 страниц, 0 файлов, 0 в корзине.

## Шаг 2. «Для клиентов» → документы (запись в production)

```sql
BEGIN;
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', '<ADMIN_AUTH_USER_ID>'::UUID,
  'claims', jsonb_build_object('sub', '<ADMIN_AUTH_USER_ID>', 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SELECT set_config('evo.seed_nodes', (
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = '<ORGANIZATION_ID>' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = '<ORGANIZATION_ID>' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT COALESCE(array_agg(id ORDER BY root, sub, title, id), '{}')::TEXT FROM allow
WHERE classification = 'historically_approved_general_client_knowledge'
  AND (root <> 'ИИ-ассистент' OR sub = 'Вопросы и ответы')
), TRUE);
SELECT set_config('evo.seed_expected', '<EXPECTED_COUNT>', TRUE);
DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
END
$guard$;
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_seed_from_kb_v1('<ORGANIZATION_ID>'::UUID,
  current_setting('evo.seed_nodes')::UUID[], 'document', '<REQUEST_ID>'::UUID) AS receipt;
COMMIT;
```

Квитанция: `status` `applied`, в `created` — 9 пар «документ — узел» с
`audience` `client`, `unchangedNodeIds` пуст. Тексты страниц в квитанцию не
попадают. Повтор с тем же `<REQUEST_ID>` вернёт ту же квитанцию с
`replayed: true`; новый `<REQUEST_ID>` на неизменных страницах ничего не
создаст и перечислит их в `unchangedNodeIds`.

## Шаг 3. «Внутреннее» → документы (запись в production)

```sql
BEGIN;
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', '<ADMIN_AUTH_USER_ID>'::UUID,
  'claims', jsonb_build_object('sub', '<ADMIN_AUTH_USER_ID>', 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SELECT set_config('evo.seed_nodes', (
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = '<ORGANIZATION_ID>' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = '<ORGANIZATION_ID>' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT COALESCE(array_agg(id ORDER BY root, sub, title, id), '{}')::TEXT FROM allow
WHERE classification = 'historically_approved_internal_knowledge'
  AND root <> 'ИИ-ассистент'
), TRUE);
SELECT set_config('evo.seed_expected', '<EXPECTED_COUNT>', TRUE);
DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
END
$guard$;
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_seed_from_kb_v1('<ORGANIZATION_ID>'::UUID,
  current_setting('evo.seed_nodes')::UUID[], 'document', '<REQUEST_ID>'::UUID) AS receipt;
COMMIT;
```

Квитанция: 233 документа с `audience` `internal`. Внутренние документы
помогают черновику и объясняются сотруднику, но клиенту не цитируются
(§6.5). Перевод страницы в «Для клиентов» — отдельное решение владельца или
директора (§18, вопрос 2), этой процедурой не делается.

## Шаг 4. «Правила общения» (запись в production)

```sql
BEGIN;
SELECT set_config('request.jwt.claims', (platform_private.custom_access_token_hook(jsonb_build_object(
  'user_id', '<ADMIN_AUTH_USER_ID>'::UUID,
  'claims', jsonb_build_object('sub', '<ADMIN_AUTH_USER_ID>', 'role', 'authenticated'))) -> 'claims')::TEXT, TRUE);
SELECT set_config('evo.seed_nodes', (
WITH RECURSIVE tree AS (
  SELECT n.id, n.title AS root, NULL::TEXT AS sub
  FROM platform_private.kb_nodes n
  WHERE n.organization_id = '<ORGANIZATION_ID>' AND n.area = 'internal' AND n.kind = 'folder'
    AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.archived_at IS NULL
    AND n.title IN ('ИИ-ассистент', 'Компания', 'Страны и поступление')
  UNION ALL
  SELECT c.id, t.root, COALESCE(t.sub, c.title)
  FROM platform_private.kb_nodes c JOIN tree t ON c.parent_id = t.id
  WHERE c.organization_id = '<ORGANIZATION_ID>' AND c.area = 'internal'
    AND c.deleted_at IS NULL AND c.archived_at IS NULL
), allow AS (
  SELECT n.id, n.title, t.root, t.sub, n.source ->> 'classification' AS classification
  FROM tree t JOIN platform_private.kb_nodes n ON n.id = t.id
  WHERE n.kind = 'page' AND btrim(n.body) <> ''
    AND n.source ->> 'classification' IN ('historically_approved_general_client_knowledge',
      'historically_approved_internal_knowledge')
)
SELECT COALESCE(array_agg(id ORDER BY CASE sub WHEN 'Правила ответов' THEN 1 ELSE 2 END, title, id), '{}')::TEXT
FROM allow
WHERE root = 'ИИ-ассистент' AND sub IN ('Правила ответов', 'Продажи и ответы')
), TRUE);
SELECT set_config('evo.seed_expected', '<EXPECTED_COUNT>', TRUE);
SELECT set_config('evo.seed_rules_versions', (SELECT count(*) FROM platform_private.ai_rules_versions r
  WHERE r.organization_id = '<ORGANIZATION_ID>')::TEXT, TRUE);
DO $guard$
BEGIN
  IF (current_setting('request.jwt.claims')::JSONB ->> 'platform_role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'seed stopped: the claims are not an EVO admin';
  END IF;
  IF cardinality(current_setting('evo.seed_nodes')::UUID[]) IS DISTINCT FROM current_setting('evo.seed_expected')::INTEGER THEN
    RAISE EXCEPTION 'seed stopped: % pages selected, % expected',
      cardinality(current_setting('evo.seed_nodes')::UUID[]), current_setting('evo.seed_expected');
  END IF;
  IF current_setting('evo.seed_rules_versions')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'seed stopped: % rules versions already exist, the seed would replace the current rules',
      current_setting('evo.seed_rules_versions');
  END IF;
END
$guard$;
SET LOCAL ROLE authenticated;
SELECT platform.ai_agent_seed_from_kb_v1('<ORGANIZATION_ID>'::UUID,
  current_setting('evo.seed_nodes')::UUID[], 'rules', '<REQUEST_ID>'::UUID) AS receipt;
COMMIT;
```

Квитанция: `target` `rules`, `nodeCount` 2, новая версия. Она сразу текущая и
помечена «нужна проверка»: `confirmed_at` пуст. Текст правил — заголовок
страницы и её текст, в порядке «Правила ответов», затем «Продажи и ответы».
Вторая страница внутренняя, поэтому текст правил входит в проверку утечки
(§6.5). «Проверено» (`ai_agent_rules_confirm_v1`) нажимает человек в
«ИИ-агент → Правила общения» только после чтения; процедура этого не делает.

Шаг 4 записывает только в пустые «Правила общения». Функция всегда делает
свою версию текущей, а сохранять правила может любой сотрудник
(`ai.agent.manage`, Q9). Поэтому охрана блока считает версии организации и
останавливается (`seed stopped: N rules versions already exist`), если хоть
одна уже есть: значит, правила сохранили раньше, и начальное наполнение их
не заменяет. Тогда — остановиться и спросить владельца; при его решении
текст переносится вручную новой версией в «Правилах общения». По той же
причине повтор шага 4 после `COMMIT` (даже с тем же `<REQUEST_ID>`)
останавливается охраной: результат смотреть в шаге 5. Репетиция
(`ROLLBACK`) версий не оставляет и настоящему запуску не мешает.

## Шаг 5. Проверка (только чтение)

```sql
SELECT d.audience, d.status, count(*) AS documents
FROM platform_private.ai_documents d
WHERE d.organization_id = '<ORGANIZATION_ID>' AND d.source = 'seed_kb'
GROUP BY 1, 2 ORDER BY 1, 2;
```

Сразу после шагов 2–3: `client` / `queued` — 9, `internal` / `queued` — 233.
Когда worker отработает: `ready` (или `review`). Документ в `failed` —
«Повторить» в «Информации для агента» (`ai_agent_document_retry_v1`) после
устранения причины (`error_code`, без текстов):

```sql
SELECT d.error_code, count(*) AS documents
FROM platform_private.ai_documents d
WHERE d.organization_id = '<ORGANIZATION_ID>' AND d.source = 'seed_kb' AND d.status = 'failed'
GROUP BY 1 ORDER BY 1;
```

```sql
SELECT r.version, r.source, r.confirmed_at IS NOT NULL AS confirmed, octet_length(r.body) AS bytes,
  r.id = s.rules_version_id AS current
FROM platform_private.ai_rules_versions r
JOIN platform_private.ai_settings s ON s.organization_id = r.organization_id
WHERE r.organization_id = '<ORGANIZATION_ID>'
ORDER BY r.version;
```

Ожидается: одна версия `seed`, `confirmed` false, `current` true.

```sql
SELECT queue_length FROM pgmq.metrics('ai_agent_work_v1');
```

Очередь пустеет по мере работы worker; в ней только указатели
`{v, kind, ref_id}`, без текстов. Стоимость эмбеддингов видна в
«ИИ-агент → Расходы» (назначение `embed_document`).

## Шаг 6. Папка «ИИ-ассистент» в корзину (запись в production, отдельное разрешение)

Только после того, как шаг 5 показал документы и правила. Копии в «Информации
для агента» живут сами по себе: корзина их не трогает.

1. CRM → «База знаний» (только admin) → область «Внутренняя база EVO», корень.
2. Отметить строку «ИИ-ассистент» (флажок «Выбрать: ИИ-ассистент»). Проверить,
   что выбран ровно один материал: «Выбрано: 1».
3. «В корзину». Это команда `trash` в `platform.kb_command_v1` с
   `expectedVersion` папки: папка и все её 15 потомков получают `deleted_at`
   и один общий `delete_batch` (идентификатор запроса). Узлы и версии не
   удаляются.
4. Проверка — второй запрос шага 1: 16 узлов, `in_trash` 16,
   `trash_batches` 1.

После этого `ai_agent_seed_from_kb_v1` отклоняет любой узел папки
«ИИ-ассистент» (`ai_seed_node_not_allowed`: узел в корзине) — так задумано;
уже сделанные копии остаются.

## Откат

- **Папка.** «База знаний» → «Корзина» → отметить «ИИ-ассистент» →
  «Восстановить» (команда `restore`): возвращается весь `delete_batch`, все 16
  узлов, с теми же версиями.
- **Документ.** «Информация для агента» → «Удалить»
  (`ai_agent_document_delete_v1`, право `ai.agent.manage`). Удаляет копию и её
  фрагменты, оригинал в «Базе знаний» не меняется. Скопировать заново —
  шаг 2 или 3 с новым `<REQUEST_ID>`.
- **Правила.** Версии только добавляются: исправление — новая версия в
  «Правилах общения» (`ai_agent_rules_save_v1`).
- Ни один откат не делается прямым `UPDATE`/`DELETE` по таблицам.

## После

- **Перенос «Базы знаний».** После выпуска этого PR перенос локальной базы не
  создаёт «ИИ-ассистент». Уже перенесённые страницы находятся по ключу
  источника и остаются там, где лежат (в том числе в корзине). Новые файлы
  локальной папки «FAQ и шаблоны ответов» попадают в «Компания → Вопросы и
  ответы», «О базе и правила ответов» — в «Процессы и инструкции → Правила
  ответов», корневой README клиентской базы — в «Процессы и инструкции →
  Устройство базы знаний». Страница с «FAQ» в заголовке идёт в «Компанию».
- **Квитанция.** Дата, четыре `<REQUEST_ID>`, числа из квитанций и шага 5 —
  в release receipt и `docs/PLAN_CHANGES.md`. Без текстов страниц и правил.
