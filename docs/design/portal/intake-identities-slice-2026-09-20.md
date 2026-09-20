# B3a — стабильные ID наборов и техническая публикация

Статус: спецификация зафиксирована до runtime-кода; реализация B3a подготовлена,
реальная запись/публикация не выполнена. Основа main
`6da4f354d1a7af88bfbb19b11c3e2546606ae114` (207–209).
Root выделил миграцию **211**; 210 принадлежит A. Принятый shared contract:
[B-3 в launch plan, commit 8bd96f2d](https://github.com/izzhackt/evo_AI_CRM/blob/8bd96f2dfc23dc7fc574ecee2591383e05ba311c/docs/EVO_LAUNCH_PLAN.md).
A единолично ведёт общие launch/decision docs; B их не изменяет.

## Результат этого блока

Каталог web/iPhone читает прежний content и content со стабильными intake IDs.
Редактор сохраняет ID при изменении сведений, создаёт один UUID для нового
набора и для каждого ещё не идентифицированного набора новой редакции.
Admin может подготовить и проверить техническую редакцию, которая добавляет
только ID: сервер доказывает отсутствие изменения фактов. Это ещё не команда
выбора программы, подготовка документов, отправка пакета или полная B3 acceptance.

## Сохраняемые решения

- Подготовка будущего B3 доступна только CN/MY/AE/TR/IT/CZ. Другие страны
  сохраняются в каталоге/избранном. Не расширять allowlist и не обходить NULL.
- Сопровождаемый Student с active activated authorized case начинает подготовку
  сразу в том же деле; этот блок не меняет authority/tier и не создаёт дело.
- institution UUID + program.id + intake.id — идентичность; immutable
  publication/version — редакция фактов. Нет новой registry/revision сущности.
- ID не определять по имени, дате или позиции. Исправление того же набора
  сохраняет ID; новый набор получает новый. Старые snapshots неизменны.
- `diploma` не подменять другим уровнем; будущий doctorate→phd адаптер сохраняет
  exact catalog level. В этом блоке application degree/selection не меняются.
- Не создавать synthetic/demo datasets, QA identities или подставные проверки.
  Существующие local receipts относятся только к прежним запускам.

## Формат и совместимость

`UniversityIntake.id` необязателен для чтения старых JSON. Если присутствует,
это lowercase UUID длиной 36, версия 1–8 и variant 8/9/a/b;
null/неверный тип/uppercase не являются ID.
TS, SQL и Swift согласованы. Дубли ID внутри публикации отвергаются. Старые
остальные JSON-правила (URL, дата, timezone, фото, уровни) сохраняются.

Новые редакторы заполняют все отсутствующие ID один раз, без смены прежних.
Сохранённый FormData/intent при неопределённом результате повторяется с теми
же ID и request ID. Обычный старый writer/черновик без ID может продолжить
legacy workflow лишь пока его база тоже не идентифицирована: публикация
остаётся невыбираемой. Нельзя опубликовать потерю ID после идентифицированной
базы или смешанную новую редакцию с ID и без них. Это совместимость, не
доказательство завершённого перехода; обычный новый редактор ID не теряет.

## Серверный контракт 211

- Сохранить публичные сигнатуры обычных stage/review. Общую реализацию stage
  при необходимости вынести в закрытый helper; старые normal request digests
  и replay receipts должны оставаться совместимыми.
- Новый `stage_university_intake_identity_publication` принимает те же шесть
  параметров, что обычный stage: organization, institution, base version,
  content, reason, request ID. Для technical path обязательны существующий
  institution и его опубликованная база; создание нового вуза не допускается.
- Publication хранит неизменяемый `review_kind` (`content` по умолчанию,
  `intake_ids` для technical path). Это не новый реестр. Новый guarded reader
  `admin_university_catalog_drafts_with_review_kind` возвращает `reviewKind`.
  Старый RPC сохраняет прежний exact DTO и показывает только `content` drafts:
  иначе schema-first rollout ломает уже опубликованный strict TS parser и может
  показать технический черновик с ложной галочкой проверки источников. Новый
  reader требует новый RPC и валидный `reviewKind`, без fallback/default.
  PGRST202 также означает stale signature/schema cache; неполный legacy список
  нельзя показывать как успешный. Общая поправка до коррекции runtime: `efbd82bb`.
- Technical proof привязан к exact existing base (org/institution/version,
  соответствующие publication UUID и content hash). Сервер сравнивает candidate
  с base после удаления ТОЛЬКО добавленных intake.id. Прежние ID, program IDs,
  порядок массивов и все факты должны совпасть. Должен добавляться хотя бы один
  ID; no-op не объявляется новой технической редакцией.
- Mode входит в технический request digest; один request нельзя повторить
  другим operation/content. Обычный stage digest не переписывать задним числом.
- ID нельзя перенести к другой программе/вузу текущего tenant, включая ID в
  удалённых из latest элементов. Проверять всю published history при stage и
  publish, сериализовать конкурентные identity checks одним порядком locks.
  Institution lock148 не защищает конкуренцию разных вузов сама по себе.
- Review использует существующий authenticated Admin путь и принимает режим
  из server-stored draft, не checkbox клиента. После locks повторно проверяет
  base и technical proof перед publish. Любое изменение факта требует обычного
  content review. Не ослаблять require_bw5_admin_actor, tenant/scope, request
  replay, stale version, source review, append-only guards и ACL.
- Старые published content, verifiedOn и первый reviewed_at из207 не менять.
  Новый reviewed_at означает техническую редакцию, не новую проверку сроков.

## UI и область файлов

Существующий EVO Operate UI сохраняется. Для technical stage/review явно
говорим, что сведения и даты не изменялись; не показываем ту же галочку о новой
проверке официальных источников. Technical mode не может скрыть изменённые
поля. Ошибка и неопределённое сохранение показываются честно, intent сохранён.
Сырые ID студенту показывать не требуется. Отдельный реестр/новый раздел не нужен.

Основные файлы: migration211; `platform-university-catalog.ts` и actions;
`UniversityEditor.tsx`, manage route и существующий admin catalogue reader;
Swift `UniversityIntake`. При необходимости добавить маленькие pure helpers
для сохранения ID/проверки ID-only diff, а не менять всё устройство каталога.

## Реальная проверка и текущие ограничения

Для проверки получить свежие existing published snapshots настоящим
Student catalog RPC с уже имеющимся managed QA identity. Конфиг canonical
`.env.student-portal-qa.json` читается только процессом, значения не копируются
в worktree/Git/логи. Пароль/Auth token в вывод не попадают. Роль/tenant не менять.
Можно проверить реальные decoder/reader пути и количество legacy наборов.
Фактический baseline получен 2026-09-20 18:16:10.777 UTC до изменения TS/editor;
SQL/Swift workers к этому времени уже подготовили код. Пять страниц/143 вуза,
251 программа/145 наборов без ID; поддерживаемые страны — 116 вузов/131 набор.
Подробности и границы — `docs/qa/b3-intake-identities-2026-09-20.md`.

Новый stage/review/save не выполняется в managed до отдельной authority на211
и записи; существующая staff browser session не переносится cookie extraction
в local runtime. Сейчас это конкретный blocker actual command acceptance.
Не создавать новую локальную копию бизнеса или synthetic records ради зелёного
результата. TypeScript/Swift compile, scoped lint и source review — отдельные
технические проверки; не заменяют реальный write/readback/UI путь.

После разрешённой поставки: существующие real snapshots → сохранённый manifest
same facts+IDs → protected stage → честный technical review → Student readback.
Проверить неизменность source facts/verifiedOn/first publication, стабильность
IDs при edit/retry, stale-base отказ, дубли и смену родителя, ordinary review
непохожего content, role/tenant denial на существующих доступных путях. Если
данных/доступа нет, указать непроверенный сценарий без искусственного успеха.

Rollout report: supported total, already identified, transitioned, still legacy,
blocked/stale/error. B3a code/readers не означают, что весь legacy уже выбирается.
Полный B3 завершается только после перехода поддерживаемых наборов и реального
selection/documents пути web/iPhone; финальный продуктовый E2E остаётся отложенным.

Официальные основания: [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
и [transaction/advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html).
Взаимные блокировки проектируются единым порядком, межстрочные доказательства
не помещаются в некорректный CHECK, зависящий от чужих mutable строк.

## Порядок поставки и откат

Release ledger требует211 до нового runtime. Установка211 сама не добавляет
intake.id к published content. Технические публикации выполняются отдельно лишь
после нового reader. Старый strict web parser отвергает intake.id: откат к старому
image после первой ID-publication не считается безопасным; заранее нужен
проверенный совместимый rollback image либо forward recovery, без переписывания
immutable snapshots. Сохранение старого draft DTO не доказывает весь rollout.

[PostgREST PGRST202](https://docs.postgrest.org/en/stable/references/errors.html#group-2-schema-cache)
описывает и устаревшую сигнатуру, и отсутствие функции. Новый reader при любой
такой ошибке честно показывает unavailable.

## Сохранение существующего пакетного пути

Legacy template batch не умеет сохранять intake IDs и не должен предлагать
невыполнимое обновление: карточки с уже закреплёнными наборами идут в обычный
редактор актуальной версии, исключаются из batch candidates и имеют явный статус
и ссылку. Также добавление наборов в существующий вуз без текущих наборов идёт
через редактор: latest пустой список не доказывает отсутствие ID в истории.
Остальные новые/legacy batch записи сохраняют существующее поведение. SQL211
остаётся конечной проверкой, в том числе при изменении версии во время batch;
защиту не ослаблять и ID по старому template не угадывать.

Уточнение классификации: если опубликованные сведения отличаются от template
только наличием intake.id, batch показывает `current`, а не ложную необходимость
обновления. Сравнение facts-only используется только для чтения и статуса:
исходный content/hash/request digest и write payload остаются прежними. Только
реальное различие фактов у identified вуза требует отдельного редактора.
Сравнение не переносит и не восстанавливает идентичности наборов.
