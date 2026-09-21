# Item14 / A14a — компактный каталог сотрудников и опубликованные даты

Статус: независимые precode/source/integration review и CI пройдены.
Source030d7c2e/head3d21b54d, integration/actual b8497ad4.
[Source-проверки и два прежних падения](qa/staff-catalog-compact-source-2026-09-21.md),
[обычный Admin и реальный каталог](qa/staff-catalog-compact-actual-2026-09-21.md).
Actual: поиск/страна/уровень/reset/detail/back, фото/атрибуция,1440/390/320 PASS;
нет следующей страницы/подходящей будущей даты на пяти реальных карточках.
Strict final290/33 пройден, logout204/браузер/сервер закрыты, среда ROOT22.
Docs-only main7be6461d (#1009/#1011) интегрируется с неизменным product patch; финальные
head review/CI/merge #1008 ещё требуются. База29e0fb46 после #1005;
исходная оценка33966da1 и контракт ниже сохранены. Весь item14 не закрыт.

Ниже принят план SHA-256
`8f081b632ca2930bafdcfd77abb93d8c4e1a777f794f31d3346472b2d089467e`.
Независимое precode review SHA-256
`ca49e8fbe712de15c769c4fd0674f30d0013280222ce740b29c74863bf18d428`.
Актуальный [срез1–36](EVO_ITEMS_1_36_STATUS_2026-09-21.md) остаётся частичным.

Source:33966da19b401c88dff92f840a28b22d7a0429c9, ROOT worktree evo-sales-direction-facet. Исходная оценка SHA f8414820d536e9a55c933338b2d42e051b5ed0b7bcce3fbd8c4a0bac6c3fbb81 прочитана. Impeccable Shape/Operate прочитаны; context не повторялся. Это план узкого refinement, не runtime acceptance. Свежего source-matched staff screenshot в переданной оценке нет; iPhone/portal снимки не использовать как baseline.

## Первый исполнимый slice

Задача сотрудника: быстро просмотреть доступные вузы, увидеть конкретную программу/набор с проверенной опубликованной датой и открыть существующую карточку. Не перестраивать весь каталог.

Файлы:
1. src/components/v3/universities/UniversityCatalogue.tsx — только UniversityList staff-ветка. Одноколоночный список компактных записей вместо трехколоночной большой фотосетки. Имя/город/страна, краткий overview, число программ и конкретная дата с программой/набором; существующая ссылка «Программы и сроки». На desktop небольшая фото-колонка рядом с текстом, на320/390 текст переносится без фиксированной ширины;44px ссылка/controls. Не делать всю запись интерактивной поверх вложенных attribution links.
2. UniversityPhoto.tsx — один optional compact=false prop, включённый только staff list. Меняется размер изображения/placeholder, не resolver/источник/alt/ошибка/лицензия. Компактное фото порядка96px по высоте и160–180px desktop-колонка; attribution/caption продолжают переноситься и оставаться достижимыми. Default/large/detail unchanged. Не удалять фото или заменять metadata декоративным asset.
3. Новый небольшой pure src/lib/university-staff-deadline.ts — display-only selection из уже decoded programs/intakes; tests/university-staff-deadline.test.mjs.
4. src/app/(v3)/v3/universities/page.tsx — передать один now=new Date() в staff list, чтобы все строки оценивались в один момент. Никаких дополнительных RPC.

UniversityList имеет union base staff/portal, хотя сейчас найден единственный caller staff-page. Явно ограничить новый compact/deadline rendering base===/v3/universities; не менять потенциальный portal layout и UniversityContentView/Program/Detail. Не трогать program IDs/schema/actions/выбор в деле, формы и permissions.

## Deadline contract — без выдуманного времени

DTO содержит applicationDeadline, deadlineTime|null, timezone|null, status(open/announced/closed/unknown/needs_reconfirmation), sourceUrl, verifiedOn; **confirmed статуса нет**. program.id обязателен; intake.id отсутствует у legacy — не синтезировать новый ID из label/date.

Selector возвращает ссылку/данные конкретных program+intake, не только дату. При filters.level учитывает только программы этого уровня; общий program count подписать «в карточке», не выдавать его за число найденных. Кандидаты только open/announced с applicationDeadline, валидным approvedDTO source/verifiedOn и явным допустимым TZ. closed/unknown/needs_reconfirmation исключить. Будущий verifiedOn не использовать как подтверждение. Не вводить произвольный срок устаревания verification.

Проверка истечения должна совпадать с universityIntakeLabel: локальный day/hour/minute через Intl в **intake.timezone**, исключить дату до локального сегодня и timed deadline<=локального HH:mm. Date-only на текущую дату остаётся датой, без придуманного23:59/00:00. Null/unsupported TZ не заменять UTC/Бишкеком; unknown возвращает отсутствие безопасного результата. UTC допустим только когда буквально указан источником. Существующий helper labels не использовать как строковый predicate; небольшую scoped проверку воспроизвести явно и зафиксировать parity-tests, не менять shared portal/eligibility helpers.

Минимальное честное ранжирование — ближайшая **опубликованная календарная дата**, а не обещание ближайшего абсолютного instant между странами: сортировка applicationDeadline, детерминированные ties program.id/исходный intake index (не новый identity). UI назвать «Дата подачи» и вывести дату, исходное time/TZ если есть, программу и intake label; при необходимости подпись «Ближайшая опубликованная дата по выбранному уровню». Не называть date-only точным моментом закрытия, не сортировать разные TZ по голому HH:mm. Для нескольких наборов на ту же дату допускается краткое «ещё N наборов с этой датой» с existing detail link; не утверждать, что выбранный tie закрывается первым. Если нужен именно глобально самый ранний instant, это отдельный явно согласованный temporal contract, а не UTC fallback в этом slice.

При отсутствии безопасной даты: «Сроки подачи — в карточке» рядом с существующим переходом. Это не «приём закрыт», не ноль и не отсутствие наборов. Не подставлять startDate/startMonth. На найденной дате показать источник срока обычной безопасной ссылкой и verification date по исходным данным; публикация не равна свежей внешней проверке. Не утверждать admission eligibility: это214/действующая серверная authority.

## Сохранить неизменным

parseUniversityFilters: q/country/level/offset, invalid→notFound; readStaffUniversities catalog.read; DB фильтры доLIMIT31/OFFSET, выдача30/name+id/nextOffset. Search/native select/reset/Next href сохраняют параметры. canManage остается !preview+catalog.import.manage; manage/forms paths без расширения. Ошибка reader остается UniversityUnavailable, не empty success. Overview может остаться ограниченным в списке, полный текст и все фото/источники в detail. Не расширять этот slice на back-context redesign/manage search.

## Следующие отдельные срезы

Country facet **не реализовывать из30 rows** и не использовать management batch reader для обычного staff. Потребуется отдельный authorized full published-catalog distinct reader/contract с tenant/visibility/complete result, error state и сохранением текущего selected value. Не резервировать migration здесь. Текущий ISO select пока остается; это открытый item14 gap. Поиск pending drafts/поднятие Add в manage — тоже отдельно; поиск по50 нельзя обозначать полным.

## Проверки и будущая actual UI

Pure tests: level selection; только deadline (start не fallback); статусы и null date/TZ; explicitUTC; неподдержанныйTZ; разные локальные дни у одного now; точная minute boundary; date-only сегодня; future verification; стабильные ties/два timezone без ложного instant-order; legacy intake безid; input immutability. Сохранить существующие platform-university-catalog/photo tests, scope lint/types; без новых mocks/live-response substitutes.

После source review и передачи shared window: fresh ordinary authorized staff читает существующий каталог, определяется реальное наличие подходящего published deadline. Один actual1440/390/320 batch: поиск/страна/уровень/reset, доступная Next, detail→sources, существующие management/forms links по фактическим правам, keyboard/focus/longnames/photo+attribution/overflow. Сравнить показанную дату/program/intake с реальным decoded RPC, не seed. Если future deadline/Next/photo-error/manager не доступны, честный gap; не создавать/публиковать records. Максимум одна confirmation после исправления конкретных дефектов. Никаких business/provider writes.

Перед реализацией A фиксирует компактный precode в Launch/PLAN_CHANGES, читает craft-floor непосредственно перед UI edit. Этот план не закрывает все item14 и не утверждает production/Student/native визуальную приёмку.


## Основание для локальной даты

Проверены MDN [Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat)
и [formatToParts](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts):
явный timeZone выбирает локальную дату/время, formatToParts даёт отдельные
компоненты, hourCycle h23 исключает24:00. Отсутствующий timeZone использовал бы
зону runtime, поэтому selector его отклоняет. Продуктовый контракт дополнительно
ограничивает синтаксис зоны, даже если Intl понимает другой alias/offset.
