# Проект схемы: программы каталога и источник «база знаний»

Назначение: зафиксировать проект схемы до написания миграции, как требует
раздел 21 ТЗ. Документ не является миграцией и ничего не применяет.

- Дата: 20 августа 2026 года
- Базовый `origin/main`: `c27a6a84`, миграции `001-077`
- Решение: `docs/adr/0021-source-institution-catalog-from-approved-knowledge-vault.md`
- Измерения: `docs/platform/catalog-source-inventory.md` — поставляется
  PR #317; до его вливания файл существует только в той ветке
- Образец конвенций: `supabase/migrations/056_platform_university_catalog_import_boundary.sql`

## Почему нужны две миграции, а не одна

`platform.workflow_source_kind` получает значение `knowledge_vault`.
PostgreSQL не позволяет использовать только что добавленное значение перечисления
внутри той же транзакции, в которой оно добавлено, а миграции выполняются в
транзакции. Поэтому:

| Миграция | Содержание |
| --- | --- |
| Первая | `ALTER TYPE platform.workflow_source_kind ADD VALUE 'knowledge_vault'` и ничего больше |
| Вторая | Обновление `is_safe_workflow_source_url`, перечень уровней программ, таблицы, политики, функции и права |

В репозитории до сих пор не было ни одного `ALTER TYPE ... ADD VALUE`, поэтому
разделение фиксируется явно, а не подразумевается. Номера берутся
непосредственно перед коммитом после проверки свежего `origin/main` и открытых
PR, как требует раздел 21.

## Форма источника

Существующая проверка `platform_private.is_safe_workflow_source_url` разбирает
`source_url` по виду источника и завершается `ELSE FALSE`. Добавление значения
перечисления без ветви в этой функции сделало бы любой источник нового вида
непроходимым — это корректное поведение по умолчанию, но ветвь обязана
появиться в той же второй миграции.

Предлагаемая ветвь:

```sql
WHEN 'knowledge_vault' THEN
  p_source_url ~ '^evo-knowledge://internal/[a-f0-9]{64}$'
```

Где 64 шестнадцатеричных знака — это SHA-256 исходного документа, который уже
вычисляет `discover_documents` в `build_platform_bundle.py`.

Что этим достигается:

- в базу не попадает ни путь файловой системы, ни домашняя папка, ни имя
  русской папки хранилища;
- значение стабильно: тот же документ даёт тот же идентификатор;
- значение проверяемо: по нему можно найти документ в манифесте пакета знаний.

`source_revision` источника несёт SHA-256 манифеста пакета знаний для
внутренней аудитории. Этот показатель уже производится существующим сборщиком и
уже фигурирует в release-доказательствах P8V, поэтому происхождение каталога и
происхождение выпуска знаний ссылаются на один и тот же артефакт.

## Перечень уровней программ

```sql
CREATE TYPE platform.catalog_programme_level AS ENUM (
  'foundation',
  'certificate',
  'diploma',
  'pre_university',
  'bachelor',
  'master',
  'doctoral',
  'transfer_programme'
);
```

Первые семь измерены инвентаризацией. Восьмое добавлено потому, что пятнадцать
документов INTI об American и Australian Degree Transfer Programme не являются
ни foundation, ни diploma, ни bachelor: студент начинает обучение в Малайзии и
переводится в зарубежный университет. Запись такого маршрута под одним из
существующих уровней исказила бы то, на что студент фактически поступает.

## Таблица одобренных программ

```sql
CREATE TABLE platform.catalog_programmes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL
    REFERENCES platform.organizations(id) ON DELETE RESTRICT,
  catalog_institution_id UUID NOT NULL,
  programme_level platform.catalog_programme_level NOT NULL,
  programme_name TEXT NOT NULL CHECK (
    btrim(programme_name) <> ''
    AND char_length(programme_name) <= 300
    AND programme_name !~ '[[:cntrl:]]'
  ),
  -- Поля ниже необязательны потому, что в источнике они отсутствуют чаще,
  -- чем присутствуют. Пустое значение означает «в источнике факта нет».
  duration_months SMALLINT CHECK (
    duration_months IS NULL OR duration_months BETWEEN 1 AND 120
  ),
  study_language TEXT CHECK (
    study_language IS NULL OR study_language ~ '^[a-z]{2}(-[A-Z]{2})?$'
  ),
  source_registry_id UUID NOT NULL,
  source_revision TEXT NOT NULL CHECK (
    source_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{6,127}$'
  ),
  import_batch_id UUID NOT NULL,
  source_record_key TEXT NOT NULL CHECK (
    source_record_key ~ '^rec_[a-f0-9]{32,64}$'
  ),
  approved_by_membership_id UUID NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT catalog_programmes_institution_fkey
    FOREIGN KEY (organization_id, catalog_institution_id)
    REFERENCES platform.catalog_institutions(organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT catalog_programmes_source_record_key
    UNIQUE (organization_id, source_registry_id, source_record_key)
);

CREATE UNIQUE INDEX catalog_programmes_normalized_key
  ON platform.catalog_programmes (
    organization_id,
    catalog_institution_id,
    programme_level,
    platform_private.normalize_catalog_programme_name(programme_name)
  );
```

Ключевые решения и их причины:

**Ссылка на заведение составная, а не по одному `id`.** Пара
`(organization_id, catalog_institution_id)` не позволяет привязать программу к
заведению другой организации. Тот же приём используется в существующем
`catalog_institutions_exact_batch_provenance_fkey`.

**`ON DELETE RESTRICT`.** Заведение с программами нельзя удалить молча.

**Уникальность включает уровень.** У одного заведения бывают Diploma in Business
и Bachelor of Business одновременно; без уровня в ключе они конфликтовали бы.
Нормализация имени повторяет существующую
`platform_private.normalize_catalog_institution_name`.

**Стоимости в таблице нет.** Инвентаризация показала, что структурированных
данных о стоимости в хранилище нет ни по одному направлению, кроме Китая, где
суммы склеены с названиями. Заводить колонку, которую нечем заполнить, значит
приглашать её заполнить догадкой. Стоимость добавляется отдельным блоком, когда
появится источник.

## Таблица кандидатов

`platform.catalog_programme_candidates` повторяет форму существующей
`platform.catalog_import_candidates`: привязка к пакету импорта, статус
валидации, безопасный перечень ошибок валидации и полное происхождение.
Различия только два:

- добавлено поле `catalog_institution_id`, потому что программа обязана быть
  привязана к уже одобренному заведению; кандидат, ссылающийся на
  неодобренное заведение, не проходит валидацию;
- добавлено `programme_level`.

Одобренная запись создаётся исключительно через существующий путь
`stage_catalog_import_candidate` → `validate_catalog_import_batch` →
`review_catalog_import_batch`. Отдельного пути одобрения для программ не
появляется.

## Функции

По образцу 056 добавляются:

| Функция | Назначение |
| --- | --- |
| `platform_private.normalize_catalog_programme_name` | Нормализация имени для ключа уникальности |
| `platform_private.guard_catalog_programme_candidate_mutation` | Запрет прямой правки кандидата в обход RPC |
| `platform.staff_catalog_programmes` | Чтение одобренных программ сотрудником в пределах его организации |
| `platform.admin_catalog_programme_candidates` | Чтение кандидатов администратором |

Существующие `create_catalog_import_batch`, `validate_catalog_import_batch` и
`review_catalog_import_batch` расширяются видом сущности, а не дублируются:
две параллельные реализации одобрения неизбежно разойдутся.

## Матрица доступа

| Роль | Одобренные программы | Кандидаты | Одобрение |
| --- | --- | --- | --- |
| Admin | чтение | чтение | да |
| Sales | чтение | нет | нет |
| Curator | чтение | нет | нет |
| Finance | нет | нет | нет |
| Student | нет | нет | нет |

FORCE row level security включается на обеих таблицах. Права по умолчанию
отзываются у `PUBLIC`, `anon`, `authenticated`, `service_role` и
`supabase_auth_admin`, как это сделано в миграциях 040 и 056. Сервисный код
обращается только через узкие RPC; обобщённый DML сервисной ролью запрещён.

Finance не получает доступа к каталогу: по матрице раздела 11.2 ТЗ у роли
Finance нет раздела Applications, а каталог обслуживает именно подачу заявок.

## Что должны проверить негативные тесты

1. Программа, ссылающаяся на заведение другой организации, отклоняется.
2. Программа, ссылающаяся на неодобренное заведение, отклоняется.
3. Прямая вставка в обход RPC отклоняется для обеих таблиц.
4. Кандидат не становится одобренной записью без явного решения Admin.
5. Роли Sales и Curator не видят кандидатов; Finance и Student не видят ничего.
6. Повторный импорт того же документа не создаёт вторую запись: ключ
   `(organization_id, source_registry_id, source_record_key)` держит.
7. Две программы одного заведения с одинаковым нормализованным именем, но
   разными уровнями, сосуществуют.
8. Источник вида `knowledge_vault` с URL иной формы, чем
   `evo-knowledge://internal/<64 hex>`, отклоняется проверкой.
9. Источник любого нового вида без ветви в `is_safe_workflow_source_url`
   отклоняется, а не проходит молча.
10. Пустые `duration_months` и `study_language` сохраняются пустыми и не
    заполняются значением по умолчанию.

## Открытые вопросы к владельцу

Проект схемы от них не зависит, но зависит наполнение:

1. Заводить ли пять заведений, у которых в хранилище нет ни одной программы:
   City University Malaysia, Xiamen University Malaysia, Taylor's University,
   UCSI University, Tongmyong University.
2. Пятнадцать документов INTI о программах трансфера — уровень
   `transfer_programme` или вне каталога.
3. Где взять малайзийские таблицы стоимости и наборов, отсутствующие в
   хранилище.
4. Китайские строки со склеенными названием и суммой — только ручное
   подтверждение или допускается автоматическое разделение с последующей
   проверкой.

## Порядок работ

| Шаг | Содержание | Состояние |
| --- | --- | --- |
| 1A | Инвентаризация источников | выполнено, PR #317 |
| 1B | Решение и проект схемы | настоящий документ |
| 1B-2 | Две миграции по проекту | не начато |
| 1C | Извлекатель хранилище → кандидаты | не начато |
| 1D | Негативные тесты и правка FR-107 | частично: FR-107 правится здесь |
