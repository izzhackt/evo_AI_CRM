# Полоса A: CRM сотрудников и техническая основа

Дата: 20 сентября 2026. База: `3ac6f326c`. Исполнитель A работает отдельно от
полосы B; общий main, миграции и release координирует root. Это план выполнения,
не утверждение готовности. Пункты 37–50 не запускаются.

Статусы пересверены 21 сентября (Asia/Dubai) на main `fdbc7a4d` после #956.
Root принял у A пункты 9, 35 и текущую сверку 36; A продолжает остальные срезы.
Merge исходников, локальное QA и production delivery учитываются отдельно.

## Первый срез A-1 — пункты 4 и 34

PR #847 меняет AnyIO lockfile; текущий classifier считает его unknown и блокирует
Fast checks. Добавить узкую классификацию только `evo-lead-agent/pyproject.toml`
и `evo-lead-agent/uv.lock`, самостоятельную locked-install проверку и реальный
локальный HTTP smoke приложения на Python 3.13. Проверять health, request-id,
ошибку неизвестного route и frozen webhook через HTTPX/AnyIO/Uvicorn/FastAPI.
Worker выключен, dotenv запрещён, SQLite временная, starter knowledge выключена;
никаких provider calls или клиентских записей. Не открывать весь Python source
как автоматически проверенный scope. Unknown/mixed/rename остаются fail-closed.
Изменение CI отдельно от dependency PR; #847 проверяется дополнительно на своём
lockfile. Без merge/deploy до координации и независимого exact-head review.

Официальный контракт uv: `sync --locked` отклоняет устаревший lockfile вместо
перезаписи; https://docs.astral.sh/uv/concepts/projects/sync/ (проверено 20.09).

A-1 принят в main через #938 (`7b0cfc7e`) после независимого exact-head review
и GitHub CI. Локальные результаты и ограничения — в
[квитанции](qa/lead-agent-dependency-ci-2026-09-20.md).

Следом принят #847 (`d2452b68`): AnyIO 4.14.2, locked install, pip check и
настоящий изолированный HTTP smoke прошли локально и в новой обязательной
CI-проверке; независимое review одобрено. GitHub отметил alerts 15/16/17
как `fixed` 20.09.2026 в 16:40:17Z. Это обновление исходников, не сервера.

Пункт 3 / #905 принят в main (`b38c6f16`): три изменённых тестовых файла
прошли 50/50 проверок на HEAD `6d4c0210`, scoped ESLint, CI и независимое
review одобрены. Это unit/source/harness-проверки; полного Node suite и
живого бизнес-пути в этом срезе не запускали. Старые 2179 не новое доказательство.

## Очередь независимых срезов

| Пункты | Срез и приёмка | Зависимость / граница |
|---|---|---|
| 3 | #905 MERGED; три тестовых файла сверены, 50/50 scoped checks | Старый отчёт 2179 не новый прогон; business acceptance не заявляется |
| 1 | #935 MERGED `f5198c37`: Sales Manager, seller и месяц по sale date; reviewed local acceptance сохранена | Managed SQL/release не выполнены; локальная квитанция относится к 001–208 |
| 6, 10 | CRM-01 MERGED #943 `1795bf23`; CRM-05 MERGED #945 `285e784e`; сброс owner-filter исправлен в #953 `498c99bf` и проверен через реальный local UI | Остальная мобильная композиция открыта; case presence не равен handoff; production не заявляется |
| 7 | #956 MERGED `fdbc7a4d`: просмотр записи перед явным исправлением, возврат к строке с фильтрами/offset; actual Sales/Admin UI, включая отказ edit=true, desktop/390px | Server search/filter до pagination и остальной отчёт открыты; валюты не суммировать; [квитанция](qa/sales-record-preview-2026-09-21.md) |
| 8 | Заявки: фильтр до limit, pagination и полный «Все» | Проверка server query и списка |
| 9 | #952 MERGED `f97122e8`: Inbox empty/filter/channel states; actual local read/UI desktop/390px | История выбранного диалога и provider/error-path приёмка этим срезом не доказаны; [квитанция](qa/crm-inbox-states-2026-09-21.md) |
| 11 | #955 MERGED `fe26526c`: поиск Student messages с loading, отдельными empty/error/retry и защитой от устаревшего ответа; actual local read/UI desktop/390px | Очереди остаются у A; диалог не открывали, сообщений и mark-read не отправляли; [квитанция](qa/case-chat-search-2026-09-21.md) |
| 12 | Договор, сумма, транши, платежи/чеки/остаток; после #933 остальной поток открыт | Согласовать profile-source/Profile и общие actions с B |
| 30 | PR #948 открыт: actual UI UPDATE двух блоков, соседний draft, replay/conflict/stale и guarded restore всех26 полей PASS; отдельно B sale-group INSERT PASS; локальная213 reviewed | Финальные exact-head review/CI ожидаются; runtime неизменен. B handoff208/126 defect выделен215; managed/release не выполнены |
| 14 | Staff-каталог: поиск, фильтры, дедлайны, управление | Program IDs/schema принадлежат B |
| 15 | Team chat: хронология, цитаты, поиск, composer, unread | История/read model до UI; не отправлять сообщения |
| 16 | #954 MERGED `aa663b3d`: явный выбор дела в календаре/global task dialog, закрытый/недоступный picker не назначает первое дело; actual local UI/drafts | Server scope «назначено мне» остаётся; задачи не создавали; [квитанция](qa/task-explicit-case-2026-09-21.md) |
| 22 | CRM shell, типографика, навигация | Impeccable вместе с функциональной проверкой; EVO сохраняется |
| 29 | Legacy China/Malaysia optional fields | Проверить валидатор на текущем контракте, сохранить данные |
| 33 | #687: причина изменения срока/приоритета Admin | Аудит/права обязательны, schema через root |
| 35 | Завершён в исходниках: #947/#949 prerequisites, #950 MERGED `3ddb6f41`, #42 CLOSED; пять checks и 842/842 legacy tests, независимый semantic review | Только форматирование legacy Inbox; без revival/deploy/provider proof; [квитанция](qa/inbox-format-baseline-2026-09-21.md) |
| 5, 36 | Root: текущая сверка docs; отдельный delivery packet и дальнейшее обновление статусов остаются | Exact main/image/smoke/rollback; production release отдельно |

Каждый срез: живой source → минимальный diff → точечная реальная проверка →
отдельный PR → независимое exact-head review. Не запускать общий финальный E2E,
контентную волну или App Store. Сохранять историю, tenant/Student boundaries,
пользовательский checkout и работу B. Миграции только после выделения номера root.

## Уточнённая очередь после #943

212/CRM-05 принят через #945. Текущий блок A — пункт30 / открытый #948:
целевая локальная приёмка завершена, остаются финальный exact-head review/CI и merge.
Исходная причина этого блока:
Root подтвердил на main1795bf23: LeadCardFieldsForm обновляет revision, но hidden
sibling values остаются из старого SSR; action отправляет все26 полей, SQL181
заменяет fields целиком. #852 сохраняет несохранённые sibling drafts, но не
доказывает защиту от этого overwrite. Следующий срез требует отдельного контракта
server-authoritative partial update/replay до кода и отдельно разрешённого
existing QA write-пути. CRM-02b следует за сохранностью данных, не перед ней.

Для дальнейших пунктов: #687 уже не включает повторное удаление portal-v1
(оно сделано152); остаётся Admin deadline/priority reason exception с сохранением
11-arg API/coverage locks. #42 — только formatting legacy Inbox. В29 проверить
legacy CN/MY schema137 против четырёх новых snake_case partner fields184, не
ослабляя общий validator. #777/#693 не закрывать по одному техническому deployment:
исторические owner-acceptance исключения остаются. Это выравнивание очереди,
не реализация перечисленных срезов и не разрешение на managed/prod mutations.

### CRM-05 / 212 — локальные доказательства, PR #945

Runtime55581820 независимо одобрен дважды; после интеграции944 UI проверен
на91e30f51. Полная квитанция: `docs/qa/crm-05-operational-handoff-2026-09-20.md`.
Это подготовленный к финальному review срез, не production release. Следующий
пункт30 остаётся первым после merge212. Миграция213 зарезервирована root для A;
B3b получил214, main/local порядок212→213→214.

Находка 212: «Сбросить всё» снимало owner из URL и результата, но select
показывал старый option до reload. Исправлена отдельным #953 `498c99bf`;
реальные reset/search/history и mobile-проверки описаны в
[квитанции](qa/pipeline-owner-filter-reset-2026-09-21.md). Это не завершает
остальную мобильную композицию воронки.

### CRM-30 / 213 — grouped save подготовлен

#945 merged285e784e; следующим реализован пункт30 в isolated
`crm-grouped-card-saves`, contractdfb55be → runtimeeb4502c. Четыре формы
сохраняют только свои9/6/5/6 ключей, сервер берёт соседние значения из текущей
строки; исправлены stale sibling overwrite и финансовая форма12-vs29 keys.
Старые v1/reader/финансовые snapshots сохранены, shared revision монотонна.
См. `docs/qa/crm-30-grouped-card-saves-2026-09-20.md` для реального объёма proof.
TypeScript/lint/source guards/syntax и read-only UI пройдены. Применение213,
положительная QA-запись и final review/CI ещё не завершены. Порядок213→214.
Пункт35/#42 теперь выполняет root, A не дублирует этот срез.

После двух source approvals d3cd9025 local213 применена без business deltas.
Реальная проверка остановлена: custom SalesManager имеет workflow permission,
но старый literal-role predicate213 отказывает42501 при editable UI. Это
блокирует завершение30. Готовится узкая correction только213; старые receipts
и ledger сохранены, положительные QA writes пока не разрешены/не выполнены.

После contract amendmentd5216ab6 и двух независимых approvals exactae83aedd
bounded local candidate correction выполнена: новый213SHA7e7e1fe8, прежние
function ACL/OID/attributes и ledger001–212 сохранены. Original apply history
остаётся, correction записана отдельно. Actual ordinary Auth read/denials10/10
PASS с unchanged business hashes/Auth users count. Literal-role blocker снят.
Positive save/sibling persistence/replay/restore остаются owner-gated HOLD;
пункт30 не завершён и release не заявляется. См. обновлённый CRM-30 QA receipt.

### CRM-30 / 213 — положительная локальная приёмка завершена 21.09

Предыдущие HOLD и отсутствие положительных saves выше — исторические состояния.
Root ac83fc2c исправил избыточную трактовку полномочий A; после завершения окна B
выполнен исходный пакет двух полей/четырёх saves, без нового решения владельца.
Runtime52a00103, local schema001–214. Реальные UI wishes3→4 / education4→5
сохранили соседний несохранённый draft и остальные24 поля. Ordinary Auth exact
replay, conflict и stale прошли; guarded restore5→6→7 вернул все26 исходных полей.
Финансовый snapshot и остальные20-table snapshots без побочных изменений;
ровно4 append-only receipts/audits сохранены. UI reload подтвердил восстановление.
B packet отдельно доказал sale-group INSERT0→1 и replay/conflict/stale; его
handoff208 встретил identity guard126 и полностью откатился. Исправление этой
отдельной зависимости выделено B215. Оно не отменяет acceptance grouped save213.
Подробности, включая сохранённый parser failure, — в CRM-30 QA receipt.
Merge948 ожидает final exact-head review/protected CI;946 следует после948.
Managed DB и production release не выполнялись.
