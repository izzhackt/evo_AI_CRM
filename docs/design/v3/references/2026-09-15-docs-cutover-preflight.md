# EVO Docs: сверка перед выпуском и переносом, 2026-09-15

Для координатора выпуска и переноса. Это read-only checkpoint, не release/import
receipt. На момент сверки новый выпуск, managed-миграции, импорт и удаление старого
Docs не выполнялись. Авторитетный порядок — [launch-plan](../../../EVO_LAUNCH_PLAN.md)
и [D5/D6](../evo-docs-unification-run-plan.md#перенос-и-точное-выключение).

## Действующий сервер и schema

- Clean Platform source: `f420fe8c42db369742f200f63be521bc1c9d59d6`.
  [Read-only ledger check34893968851](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34893968851)
  SUCCESS: managed001–161, ожидаемый неприменённый хвост source162–167.
- Remote inventory: 2026-09-14 20:30–20:38 UTC (2026-09-15 Asia/Dubai).
  CRM accepted/live `05585020a411111939a72c4121c66369839a066b`, healthy/restarts0;
  pending отсутствует, `arm=false`. Image:
  `sha256:49543bbc8a1c910fcd33b317c3e8f8ca8e92fbee1a5960b4bd62e93221120fc4`.
- Старый `evo-student-docs-app` (`a7c1f33bc9f0`) healthy/restarts0, amd64;
  `evo-student-docs:eadbef1`, image
  `sha256:d02bf43c4720188f5cdbd209e0ad4ced6b4520b6356c212f0b812d51515e2a30`,
  100 896 486 байт. Других контейнеров этого image не найдено. Source-каталог
  без `.git`: tag `eadbef1` не является проверенным source commit.
- Compose project `evo-student-docs`, service `app`, config
  `/opt/evo-student-docs/source/deploy/hermes/docker-compose.yml`.
  Bind `/opt/evo-student-docs/data` → `/data`; только этот контейнер находится
  в `evo_student_docs_private`, также подключён shared `evo_public_web`.
  В активном Caddy нет Docs route. Provider secret примонтирован read-only;
  значение не читалось, его совместное использование не исключено.
- Private buckets для templates/exports отсутствуют. Storage возвращает HTTP400
  с `statusCode:'404'`, `error/message:'Bucket not found'`, `code:'NoSuchBucket'`.
  Это отсутствие buckets, не доказательство доступной ёмкости или разрешение
  обходить проверку. Исправление существующих configurators и точное private
  20MiB PDF/DOCX provisioning/readback ещё предстоят.

SQL164 отзывает два transient161 RPC, которые вызывает live055. Выбранный в
launch-plan forward168 должен временно вернуть только `service_role EXECUTE`
этих неизменных функций: прежние actor/case/revision checks и generation-only audit
сохраняются. Старый `generated` не превращается в stored-artifact `ready`;
новое приложение использует164/167. Не применять хвост без проверенного168 и
контроля экспортов на промежутке164→168. Совместимость удаляется отдельной reviewed
миграцией после перехода действующего и retained rollback app на persisted exports.

## Два разных источника данных

Локальный источник: `evo_student_document_system@6e7cf741aa9c1005021860e509fb7b1294f94e00`,
`runtime/evo-docs.sqlite`. Серверный: `/opt/evo-student-docs/data/evo-docs.sqlite`.

| Домен | Локально | Старый VPS |
|---|---:|---:|
| students / documents / document_versions | 5 / 6 / 7 | 0 / 0 / 0 |
| field_values / field_candidates / event_log | 27 / 46 / 124 | 0 / 0 / 0 |
| package_settings / package_parts / package_reviews | 1 / 1 / 3 | Таблиц нет |
| package_exports | 3:1 draft,2 final | Таблицы нет |
| university_forms / university_form_exports | 9 / 23, все exports draft | Таблиц нет |

Локально `integrity_check=ok`, FK/проверки принадлежности версий чистые. SQLite
читалась `mode=ro`, `query_only`, с системным запретом файловых записей и
существующими WAL/SHM; SHA базы/WAL/SHM до и после совпали. На VPS проверены только
схема/счётчики через `mode=ro` и `query_only`, **не integrity_check**.

Локальные49 ссылок соответствуют43 уникальным файлам, всего67 422 701 байт.
Все SHA совпали; размеры сверены там, где они записаны в БД. В четырёх канонических
каталогах нет отсутствующих, бесхозных или небезопасных файлов. Байты читались
потоково только для SHA, без извлечения текста/изображений. На VPS non-DB files0.
Два локальных `profile.exported` события не имеют сохранённых standalone DOCX:
старый GET генерировал ответ в памяти. Их нельзя восстановить как прежние байты
повторной генерацией. Поля, предложения, decisions и export snapshots сохранять
приватно при переносе; не добавлять их в этот отчёт.

Нет надёжной fixture-классификации пяти student records; пустая запись также
подлежит сохранению. Нужен явный source-student → canonical case mapping владельца,
без сопоставления по имени или чтения паспортов. Отдельные runtime validation
каталоги не являются источником D5. Пустая серверная база не обнуляет локальную.

## Независимый перенос девяти пустых шаблонов

Разрешённые оригиналы:9 PDF,5 060 741 байт,103 mappings. Committed presets описывают
INTI, GDUT×2, UCSI, Tongmyong, City Malaysia×3, USTC. Нужны шесть точных
`catalog_institution_id`, но не student/application IDs. Прежний blank-native proof
9/9 SHA/inspection и31/31 страниц сохранён в основном плане; это не заполнение.

Новых SQL/API для current templates не требуется: existing165 create/reserve →
[166 source upload](../../../../src/lib/server/university-template-ingress-route-handlers.ts) →
save mapping → новое staff review → publish. Ingress проверяет исходные SHA/size,
ClamAV, native inspection и private Storage readback. Прямое копирование старой
inspection/publication или превращение `mappingConfirmed` в новый review запрещено.

Минимальная адаптация source `scripts/import-university-form.ts`: resumable журнал
source/target/request IDs; неизменные bytes/SHA; стабильные legacy UUID slot IDs →
`pdf-N`, координаты старых slots → `mapping.position`, проверка источников/форматов,
manual и фактической геометрии. Новый canonical mapping hash отличается; старые
metadata/JSON/revision сохраняются отдельно как provenance. Слепого D5 importer
или такого журнала сейчас нет; closed registry не хранит всю legacy историю.

## Продолжение после паузы

1. Завершить и независимо проверить forward168 и узкое исправление Storage
   configurators. Применять только reviewed exact source через существующий
   schema workflow; сверить ledger после выполнения/неопределённого сбоя.
   Затем проверить private buckets, точные MIME/20MiB и фактическую capacity.
2. Пройти существующий exact-main CI/release lane: native amd64 app/runtime
   identities, ClamAV, controlled export gap, rollback compatibility, health,
   accepted/pending/arm и post-release readback. До этого live055 остаётся истиной.
   Gemini submission/configuration не включаются фактом миграции или выпуска.
3. Независимо перенести девять blank templates через текущий ingress. Для
   заполнения/сохранения/cold-resume download выбрать согласованное реальное дело;
   PDF move/resize и generated-form acceptance остаются открытыми.
4. Подключить существующий ZIP builder к persisted API/UI и сохранить source
   возможности250MiB+Profile/260MiB download/50 extra parts. HOST64/65MiB/40 items,
   draft eligibility и title/purpose/display names пока не эквивалентны. Изменение
   capacity/тарифа или сознательное ограничение требует отдельного решения.
5. Получить mapping пяти records; реализовать идемпотентный импорт12 доменов с
   provenance/историей, не выдумывая staff/native proofs для старых exports.
   Сверить identities/counts/bytes/SHA/decisions/exports; провести реальный D6.
   Только затем повторно инвентаризировать и точечно остановить/убрать old runtime.

Сохранить `/opt/evo-student-docs/data`, backups, local runtime, `.env`, Git history,
оригиналы/шаблоны/историю и provider secrets. Не затрагивать shared network/Caddy,
CRM/Inbox/WAHA/ClamAV и их volumes. Этот checkpoint не разрешает удалять данные.

## Проверяемые основания

- Local receipts: integrity/counts `01a0a19f2b5a7f62bd7fb01e0cf177d9`, file inventory
  `01a0a1a0d7f37ab189a4fe2bd0c026bc`. Inventory fingerprint:
  `75bfc69abe87990a833fbe1a98edf1083f1981d3c7e6141122f7673d815fba7b`.
  Это SHA256 компактного JSON списка `{relative,bytes,sha256}`, упорядоченного по
  relative path через JS `localeCompare`; file list остаётся приватным.
- Remote read-only receipts: counts chunk `79fae7`, image/network `f7dc88`/`b785b1`,
  accepted/pending `f825ce`, missing buckets `af6c09`; источник — независимый
  `d4_retirement_standards`. Повторных production-вызовов при записи заметки нет.
- Context7 вернул quota exceeded. Проверены официальные
  [SQLite read-only WAL](https://www.sqlite.org/wal.html#read_only_databases) и
  [Supabase bucket configuration](https://supabase.com/docs/guides/storage/buckets/creating-buckets)
  (2026-09-15). Они объясняют механизм, не доказывают наши runtime/data результаты.
