# CRM-09c: единый договорный рабочий раздел

База `ea3cb758066510490873f42dedbc064c242f1120` после #972. Продолжение
принятого CRM-09 §7 / item12; #971 уже объединил финансовую иерархию,
но подготовка договора и отчёты пока живут в конкурирующей вкладке.

## Сценарий и Impeccable

Operate, refinement: сотрудник открывает стоимость и договор, готовит и
проверяет черновик, затем работает с траншами, оплатами и остатком в одном
разделе. Сохраняем EVO/Golos, нативные формы, существующие возможности и данные.
Основное действие видно по состоянию; управление шаблонами и служебные сведения
раскрываются по необходимости. Подписи объясняют рабочее действие, а не hash,
provider claims или внутренний формат хранения.

Incumbent reuse: actual ordinary Admin Money/Contract в #971, runtime340ad3ca,
`docs/qa/crm-finance-hierarchy-2026-09-21.md` и private evidence
`/private/tmp/evo-finance-hierarchy-qa/`. Contract workspace и шаблоны неизменны;
одна существующая стоимость1000USD, шаблонов/черновиков/траншей/оплат нет.
Это доказательство прежней компоновки, не повторный прогон и не populated proof.
Пока B211 владеет локальным writer-окном — только source changes/checks;
новое чтение UI после release. Перед UI-правками прочитать craft-floor.

## Реализация и неизменяемые границы

1. Видимая вкладка money называется «Договор и оплата», отдельная contract
   удаляется только после переноса всех рабочих функций. Вкладка доступна
   при прежнем финансовом доступе ИЛИ отдельном доступе к договору. Этот OR
   разрешает оболочку, не финансовые readers/формы.
2. Старый `tab=contract` разрешается в money только для student+access.contract.
   Без HTTP redirect: outcome/retry, docs section, requestsReturnTo и hash
   сохраняются в текущем URL. Новый contract action redirect выдаёт tab=money,
   прежние case/result/retry/subject и #contract-workflow. Остальные интеграционные
   старые ссылки обслуживаются alias. Lead/case target остаётся прежним.
3. Profile/page используют согласованный финансовый gate, включая существующий
   Sales finance.event.confirm для связанного дела вне preview. Contract-only
   видит только свой workflow: никаких выдуманных нулей, финансовых controls или
   новых финансовых RPC. Profile-source/access readers/DTO остаются неизменными.
4. Единственный contract slot Profile→Money→CaseAgreementBlock помещается
   после подписанного договора и до траншей. Finance forbidden/no case не скрывает
   разрешённый slot; unavailable сохраняет отдельную финансовую ошибку и slot.
   Один mount/requestIdFactory, прежний retry по operation+subject без подмены.
5. Сохраняются девять actions и пять независимых can* capabilities: create,
   approve/retire template; generate/review draft; seed/update post-contract
   items; generate/review report. Поля, expected versions, reasons, hidden IDs,
   версии, renderedText, provenance и outcome остаются. Preview writes запрещены.
6. Handoff business facts и единственная amoCRM command section сохраняются
   в служебном раскрытии. Provider availability/error/unknown/retry компоненты
   не редактируются и команды не исполняются. UUID/hash можно раскрыть отдельно;
   не подменять их выдуманными именами и не менять сам текст договора/отчёта.

Ownership: root — Profile.tsx, types.ts, tabs.tsx (Money), CaseAgreementBlock.tsx,
profile/page.tsx при согласовании gate, platform-contract-workflow.ts только
redirect destination; отдельный исполнитель — ProfileContractWorkspace.tsx и
ContractDraftReportWorkspace.tsx. Shared entrypoints B сохраняются. SQL, schema,
actions, readers, Auth, providers и данные не меняются.

## Проверки и завершение

- Содержательные pure cases: finance-only/contract-only/both/neither,
  student/lead и старый alias, неизменные outcome/retry URL parameters.
  Существующие source assertions заменить только там, где они закрепляют
  намеренно удалённую вкладку; safeguards девяти actions/identity сохраняются.
- Scoped Node: profile-contract, platform-contract-workflow, scoped-finance-read,
  sales-finance-entry, platform-amocrm-command-action-contract и case-agreement;
  lint/typecheck изменённой области. Не запускать общий тяжёлый suite.
- Actual ordinary Admin read-only: новая вкладка и старый contract URL, стоимость
  и доступные формы/разделы, keyboard/focus и сохранность несохранённого ввода.
  Одна batched visual проверка1280/390/320 с фактической CSS-шириной; при дефектах
  одна общая правка и не более одного подтверждения. Без form submit/upload.
- Полные local business/schema/ledger hashes и Auth counts до/после, только
  в согласованном окне. Никакой подмены local доказательства managed release.
- Положительные template/draft/report/unknown-provider и contract-only actor UI
  не заявлять без существующих разрешённых данных. Не создавать фиктивные
  договоры ради проверки. Source consolidation не закрывает весь item12.
- Независимое exact-head review и protected CI перед merge, результат и пределы
  в QA receipt. Любой обнаруженный новый scope сначала фиксируется в PLAN_CHANGES.
