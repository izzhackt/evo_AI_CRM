# CRM-09b / item12 — понятный основной экран договора и оплаты

Принятый функциональный scope item12, ограниченный pre-code контракт, 2026-09-21.
Исходники проверены по main `44092c575c0bd02b16f46b83795e475ece30cf08`;
пять owned-файлов не изменились в новой базе `d3ceed4078e1fb6967cde2e34161b9138a7537ef`.
Это контракт перед реализацией, не UI-аудит или QA PASS.
Исходное поручение: accepted CRM-09 §7 — стоимость → договор → транши → оплаты и
чеки → остаток; сохранять исправления, историю, реальные статусы и общие данные.
PR968/969 уже объединены. A продолжает TeamChat, B — B3d и существующую
техническую публикацию211. Изменения B в Profile/tabs интегрируются с сохранением
всех admissions-входов; Money — отдельная область владения root.

## Один результат следующего среза

На существующей вкладке «Деньги» сотрудник получает один ясно подписанный основной
путь «Договор и оплата»; детали всех обязательств и специальные финансовые
операции остаются доступными через понятные вторичные разделы. Разные суммы
больше не выглядят как конкурирующие цены договора. Никакой новой финансовой
модели, изменения команд или склейки прав.

**Это часть item12, не его полное завершение.** Полный перенос template/draft/
review/post-contract/report команд и совместимое снятие отдельной вкладки
`?tab=contract` — следующий самостоятельный срез. Здесь добавляется разрешённый
рабочий переход «Подготовка договора и отчёты», а старая вкладка и её redirects,
result/retry/request ID остаются. Такой предел позволяет улучшить реальный
финансовый путь без переноса большого набора независимых команд за один PR.

## Факты текущего интерфейса и принятые решения

| Текущее доказательство в44092c575 | Изменение в этом срезе |
| --- | --- |
| `tabs.tsx:426–510`: CaseAgreementBlock → финансовый стоп → Бюджет → План платежей → finance controls → FinanceEntryWorkspace | Основной CaseAgreementBlock остаётся первым; стоп и его разрешённые controls видимы. Старые сводка/план переезжают в один disclosure «Все обязательства по делу», с пояснением, что это не стоимость услуг EVO. Они не удаляются |
| `profile-source.ts:184–229`: budget = сумма обязательств, не service_cost; null возможен при отсутствии единой валюты | Не писать «Бюджет не указан» о цене договора. В disclosure пустой список = нет обязательств; при непустом списке и отсутствии агрегата показывать отдельные суммы без общего итога/процента |
| `CaseAgreementBlock.tsx:65–94`: три суммы в aside разделены стрелками; секции договора/траншей/платежей почти без названий | Явные подписи «Стоимость услуг EVO», «Оплачено с учётом возвратов», «Остаток»; секции «Договор», «Транши», «Оплаты и чеки». На узком экране подписи и значения становятся строками, не полосой мелких чисел |
| `189:1246–1264`: agreement включает только non-archived evo_service_fee; другой workspace видит иные обязательства | Не удалять расходы третьих сторон или альтернативные разрешённые finance операции. Поместить их в «Дополнительные финансовые операции» рядом с возвратами/историей; сохранить все существующие forms и capabilities |
| `189:1252–1256`: totalPaidMinor — валовые оплаты, outstandingMinor включает возвраты | Для транша показывать сумму, срок и остаток из DTO. Если показываются валовые оплаты — явно подписать «Оплаты до вычета возвратов». Не называть их net-paid и не пересчитывать денежный ledger на клиенте |
| `CaseAgreementForms.tsx:154–156`: редактирование транша скрыто за «⋯» | Читаемое summary «Изменить транш» с привязкой к названию; сохранить mounted form, frozen request и все guards |
| `FinanceEntryWorkspace.tsx`: единственная здесь refund форма, независимые canCreate/canRecord/canReadEvents | Возврат и история остаются явно доступными по тем же flags. Дополнительные obligation/payment формы свернуть, сохранив их целиком; canWrite agreement не подменяет финансовые flags |
| `Profile.tsx:244–255`, `types.ts:363–389`: finance и contract вкладки имеют разную доступность | Передать только разрешённый contract href через существующий hrefFor; не скрывать contract-only пользователя и не менять tabsFor/resolveTab |

Рекомендации Impeccable `shape`/`operate` применены к уже установленному контексту EVO без нового
context run или интервью. Режим Operate: знакомые формы, существующие Golos,
цветовые токены, плотность и компоненты; явная иерархия и progressive disclosure.
Новая гарнитура, декоративные KPI/hero, искусственный progress, новый навбар и
модальная оболочка не нужны. Денежные значения используют существующий financeMoney
и tabular-nums. Все CTA/summary — текущая min-h-11/клавиатурный focus; длинные
названия/имена файлов переносятся или раскрываются доступным способом.

## Точный текущий функциональный путь

- Profile Money получает case из `draft.admissions.studentCaseId ?? sales.handoff.caseId`.
  `readCaseAgreement` → `platform.staff_case_agreement_v1` → parseCaseAgreement.
  Read result сохраняет **ok / forbidden / unavailable**. Forbidden не выдаёт
  пустую «готовую» финансовую карточку; unavailable сохраняет видимый alert.
- Цена живёт в lead_sale_conditions. Уже существующий `overview#sale-conditions`
  открывает LeadSaleConditions с реальной формой (она не details); не создавать
  второй cost editor. Ссылка остаётся условной по предоставленному href и правам.
  При заполненной цене можно показать тот же переход «Условия продажи», а не
  обещать пользователю возможность редактирования, которой его роль не имеет.
- Tranche → saveCaseTrancheAction → save_case_tranche_v1; payment →
  recordCasePaymentAction → record_case_payment_v1. Чек загружается отдельным
  POST только после сохранённого payment; receipt-only retry не повторяет оплату.
- Договор и история файлов остаются существующими case-contract-files endpoints;
  receipt downloads — payment-receipt-files endpoints. Факт загрузки файла не
  становится подтверждением подписи или одобрения сгенерированного draft.
- FinanceEntryWorkspace → staff_finance_entry_workspace; прежние
  create_payment_obligation/record_payment_event, refund source/payment selection,
  refundable amount и audit reason не меняются. Preview сохраняет запрет записи;
  в agreement UI write controls также должны учитывать уже действующий preview
  boundary действий, а не только серверный canWrite для underlying actor.
- Student web PaymentsView/portal-source и iOS AdmissionModels продолжают читать
  тот же ledger. Их код, доступы, документы и строки локализации здесь не меняются;
  новое право Student download для договорных файлов этим не заявляется.

## Owned files будущего изолированного PR

1. `src/components/v3/profile/Profile.tsx` — только разрешённый contract-preparation
   href в Money; не менять другой layout, source, подбор дела или B3d entrypoints.
2. `src/components/v3/profile/tabs.tsx` — только Money composition, разделение
   основной суммы договора и вторичной сводки всех обязательств; другие tabs нет.
3. `src/components/v3/profile/CaseAgreementBlock.tsx` — подписи/секции/состояния,
   responsive layout и existing cost/contract переходы; существующий reader/DTO.
4. `src/components/v3/profile/CaseAgreementForms.tsx` — только текст/доступное имя
   summary редактора транша; handlers, fields, keys, requestId/retry не менять.
5. `src/components/v3/profile/FinanceEntryWorkspace.tsx` — только композиция
   возврата, истории и дополнительных форм. Ошибка чтения видна вне закрытого
   disclosure; закрытие не unmount/reset form. Не изменять FinanceEntryForms.

Root сначала согласует владение Profile/tabs с A/B; не править их параллельно.
Launch/PLAN_CHANGES appendices интегрирует назначенный root владелец до runtime.
Новые SQL/DTO/readers/actions, общие CSS/tokens, ProfileContractWorkspace,
ContractDraftReportWorkspace, types.ts, profile-source.ts и Student/native файлы
в этот срез не входят. Сохранить canonical data-testid и все реальные действия.

## Состояния и ограничения вычислений

- Known0 отображается0; null не превращается в0. Отрицательный server remaining
  не обрезать до0. Нет currency → нет USD fallback. При currencyMismatch нет
  общего paid/remaining; показывать существующие валюты по траншам/событиям.
- Не суммировать разные валюты. costMismatch остаётся отдельным объяснением,
  не «ошибкой сохранения». Общую цену брать только из agreement.costMinor/currency.
- Срокnull = «Срок не задан». Просрочка для непогашенного транша сравнивает dueOn
  с текущим днём Asia/Bishkek через существующий helper; при outstanding0 не
  показывать долг/просрочку. Не выводить ложное «весь договор оплачен» из одного транша.
- Missing contract/empty tranches/empty payments остаются разными состояниями.
  История/чек/возврат не исчезают при наличии другого успешно прочитанного блока.
- Отказ agreement не выключает независимо разрешённый finance workspace или
  contract tab. Ошибка одного reader не становится успехом/пустотой другого.
- Не менять paid-tranche amount/currency/archive guards, nullable due date,
  original source payment для refund, финансовый стоп и его причины.
- Details/вторичные панели лишь скрывают представление: введённые данные,
  выбранный файл и frozen intent остаются. Unknown result не создаёт новыйrequest.

## Реальная проверка и доступные входы

Incumbent baseline выполнен до UI-правок: ordinary existing Local Admin через
Chrome, local33234, case из прежней root222 квитанции. Реальный Money показывает
стоимость1000USD/оплачено0/остаток1000 без подписей, пустые договор/транши/оплаты,
«Бюджет не указан» ниже известной цены. Existing contract tab открывается;
утверждённых templates/versions нет. Собственные tab/server закрыты, весь
сохранённый full snapshot до/после совпал (281business hashes, schema/ledger,
Auth users/identities counts; не proof всех Auth attributes). Financial writes
не выполнялись. Положительные файлы/возвраты/смешанные валюты пока отсутствуют.

Существующая source-проверка currencyMismatch в `tests/v3-case-agreement.test.mjs`
привязана к старому aside. При изменении композиции обновить только эту проверку
так, чтобы она действительно находила новую ветку и сохраняла запрет общего
paid/remaining при разных валютах; пустой substring не считать доказательством.

Эта подготовка не читала БД и не подтверждает наличие подходящих финансовых
строк. Старые217 receipts подтверждали существование ordinary Admin/Admissions/
Sales sessions; их задачи и агрегатные hashes не доказывают наличие договоров,
траншей, оплат, возвратов, чеков или нынешние finance capabilities.

До UI-редактирования root в свободном окне делает ordinary read-only baseline
целевого Money/Contract на текущей owned-local БД. Нужны существующие: дело с
доступом Admin; собственное дело Sales (включая pending, если реально есть);
Admissions/read-only либо finance-only роль с фактическими capabilities;
Student того же дела для ограниченного сравнения существующей проекции, если
данные доступны. Не создавать актёров, роли, финансовые факты и файлы ради картинки.

Readiness фиксирует точные source/runtime/schema, readCaseAgreement status+DTO,
finance workspace flags и доступность contract tab. Для каждого позитивного
сценария нужен уже существующий подходящий вход: known/missing cost; null/dated
tranche; recorded payment; refundable payment; receipt/current/history contract;
mixed currencies/third-party cost. Недостающие варианты помечаются непройденными,
а не заменяются пустым экраном или synthetic fixture. Не требуется весь продукт E2E.

После baseline — craft-floor перед UI-правками. После реализации одна общая
проверка desktop и320/390px: основной порядок, переход к настоящей cost form,
contract-preparation link, доступность всех прежних форм, ввод/закрытие/повторное
открытие disclosure без потери черновика, keyboard/focus и реальные data states.
Сохранения/оплаты/refund/upload не нужны для проверки этой композиции и не
выполняются без отдельного применимого writer packet. Нажатие download — только
разрешённый реальный файл. No provider/customer/production actions.

Scoped lint/typecheck и существующие meaningful v3-case-agreement/sales-finance
checks по прямым рискам; source assertions не заменяют UI. Новые зеркальные
layout-тесты не создавать. Исправить найденное одним пакетом, максимум одна
подтверждающая проверка. QA receipt содержит снимки, роль/данные без PII,
рекомендация Impeccable→решение→результат и непройденные ветки.
После exact-head review/required CI — merge root; delivery отдельно.

Критерий завершения CRM-09b: основной финансовый путь понятен на реальных текущих
данных, денежная семантика не искажена и ни одна прежняя разрешённая операция
не потеряна. Item12 остаётся открытым до последующего переноса contract workflow
и выполнения его остальных приёмочных требований.
