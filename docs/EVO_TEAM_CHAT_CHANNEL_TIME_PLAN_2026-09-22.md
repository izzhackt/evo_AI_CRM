# A15 — время последнего сообщения: принятый контракт

Статус22.09: #1024 смержен вd1568d5840cee85e62947a616bb00f0d2a2ac505.
От этого main начинается первый reader/DTO блок; интерфейс времени — следующий
отдельный блок после его приёмки. ROOT исключительно зарезервировал **239**
для этого additive reader. Миграция пока не применяется; QA остаётся ROOT16,
затем B native. Production apply/release этим этапом не разрешается.

Исходный plan8c0466d5 получил independent APPROVED_PRECODE37f9d5a и ROOT
acceptance9c73157b. Ниже сохранён исходный текст; его историческое отсутствие
номера и ожидание precode заменены текущим статусом выше. Fresh comparison
bab531ae → d1568d58 подтверждает: migration237, platform-team-chat.ts,
team-chat-channel-previews.ts и TeamChat.tsx не менялись. Из chat product
изменились только два copy selectors в уже принятом #1024;238 относится
к другому reader. Совместимость внешнего поля остаётся доказуемой предпосылкой.

## Уточнения принятия и первого source-блока

- 239 повторяет точную функцию237 с двумя projection additions: m.created_at
той же lateral latest строки и внешнее latestPreviewCreatedAt. Nested7,
security/ACL/search_path/STABLE, actor/org/Student guard, channel order,
unread/seen/preferences сохраняются. Нет writes, grants, таблиц или индексов.
- DTO latestPreviewCreatedAt?: string | null. Отсутствие — legacy unknown,
сохраняется отсутствующим; null допустим только при latestPreview=null.
Present undefined/invalid/mismatch отвергается. Прочие outer extras по-прежнему
проецируются прочь, nested preview остаётся строго семипольным.
- Новый pure canonicalizer принимает только ISO date-time с секундами, явным
Z или ±HH:mm, четырёхзначным положительным годом и0–6 дробными цифрами.
Проверяются реальные календарные компоненты и диапазоны offset. Нормализует
в UTC YYYY-MM-DDTHH:mm:ss.ffffffZ, сохраняя микросекунды; не полагается на
Date.parse для дробной точности или отсутствующей зоны. Разные записи одного
момента сравниваются равными; различие даже в1 микросекунду не теряется.
- Preview/time принимаются вместе: retained stale sequence/version/null retains
previous time; same ID known→legacy preserves known, unknown→known adopts
known даже при сохранении более свежей версии preview. Конфликт двух известных
времён одного ID отвергает snapshot до watermark. Новый ID без времени не
наследует прежнее. Отозванные каналы не восстанавливаются.
- Существующий request-ticket guard остаётся первым: запоздалый ответ полностью
игнорируется. Acceptor получает результат strict decoder, как и прежде.
- Meaningful pure tests покрывают wire normalization/invalid/precision,
compatibility с неизменным decoder source snapshot, preview/time merge,
legacy/null/tombstone, stale tickets/version/sequence и channel revocation.
Сохранённый source fixture — только код старого decoder, не runtime data.
Timezone display/day-year/320 density относятся к следующему UI-блоку.
- Разрешённые product files: platform-team-chat.ts, team-chat-channel-previews.ts,
малый pure team-chat-channel-preview-time.ts, migration239; scoped tests/fixtures
и docs. TeamChat.tsx, CSS, handlers/Auth/runtime остаются вне source-блока.
Scoped Node22 tests/lint/typecheck и independent source review/short CI;
никаких runtime replay/SQL apply без отдельного ROOT окна.

Datetime contract сверён22.09 по первичным источникам:
[PostgreSQL17 datetime](https://www.postgresql.org/docs/17/datatype-datetime.html)
указывает микросекундную точность; [MDN Date.parse](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse)
описывает зависимость zone-free даты-времени от локальной зоны и особенности
разбора нестандартных строк. Поэтому strict wire-validation отдельна от display.

## Исходный рассмотренный план

# A15 — настоящее время последнего сообщения каждого канала

## Основание и ограничение совместимости

Исходный план §9 требует время возле preview. #1017/237 вернул latest preview,
#1020 вывел его во всех каналах. `TeamChatChannelPreview` сейчас содержит ровно
7 полей; decoder отвергает дополнительное nested поле. Простое добавление
`createdAt` внутрь JSON latestPreview сломает старый decoder при поэтапной
доставке. При этом внешний channel decoder проверяет обязательные поля и
безопасно игнорирует дополнительные внешние поля.

## Предлагаемый минимальный совместимый контракт

- Новая forward migration с номером от ROOT, без изменения237: существующий
  authorized `platform.team_chat_channels` возвращает дополнительное внешнее
  поле **latestPreviewCreatedAt** из `m.created_at` той же lateral latest строки.
  null только при подтверждённом отсутствии строки. Tombstone сохраняет
  исходное время создания, не время удаления/последнего изменения.
- Nested7-field preview, порядок latest по sequence, body cutoff, permission,
  current actor/org checks, ACL, unread/seen/preferences остаются прежними.
  Read-only projection; без UPDATE истории, новых таблиц/индексов/подписок.
- Старый decoder игнорирует новое внешнее поле: это проверить на неизменном
  старом decoder как pure compatibility case, а не предполагать совместимость.
- Новый decoder понимает отсутствие поля только как legacy timestamp unknown,
  не как пустой канал. Если поле присутствует: nonempty preview требует
  действительную строку datetime с timezone; empty preview требует null.
  Неверное/несогласованное поле означает unavailable, не подставной успех.
  Никаких `Date.now()`/editedAt/выбранной истории вместо серверного времени.
- При сборке нового DTO поле optional ради смешанной доставки; в нормализованном
  результате отсутствующее время явно unknown. Новый серверный контракт всегда
  отдаёт поле. Legacy unknown не выдаётся за проверенный timestamp.
- Acceptor переносит **preview и соответствующее ему время вместе**. Если
  incoming sequence/version устарел и остаётся previous preview, остаётся и
  previous time. Если ID/sequence тот же, legacy response не стирает уже
  подтверждённое время. Новый ID без timestamp не наследует время старого ID.
  Два разных достоверных createdAt для того же ID — несогласованный snapshot,
  который надо отвергнуть. Revoked channel не возвращается из старого cache.

Предложение требует независимого precode review. Если в актуальном main внешний
decoder тоже стал exact-field, остановить этот вариант и спроектировать
версионированный reader; не ослаблять strict guards скрытно.239 не резервируется.

## UI и Impeccable

Сохранить нынешние rail288px, avatar/имя/preview/unread, ссылки и порядок.
Добавить спокойный компактный `<time>` в существующую строку справа от имени,
не отнимать место у текста большой отдельной карточкой и не добавлять анимацию.
На320px имя и preview имеют min-width0/ellipsis, unread и время не перекрываются.
Цель ссылки остаётся>=44px; font не меньше существующей служебной типографики.

Базовый формат — короткая абсолютная дата и время с явно заданным
`PLATFORM_ORGANIZATION_TIMEZONE` (сейчас Asia/Bishkek), одинаковый на сервере и
клиенте. Сначала попробовать `dd.MM HH:mm`: он точен и не требует часов/
midnight timer. Полная дата/год и зона доступны в accessible text и title.
Если плотность фактического320px требует более короткого вида, согласовать
его на actual incumbent до кода; не вводить ошибочное «сегодня» по зоне ОС.
Empty/legacy-unknown не получают выдуманного времени; preview остаётся честным.

`<time dateTime>` задаёт машинное время; Intl.DateTimeFormat позволяет явно
задать локаль/зону. Первичные источники проверены22.09:
[MDN time](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/time),
[MDN Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat).

## Разделение реализации и проверки

1. Контракт/read/DTO/acceptor: новая миграция, platform-team-chat.ts,
   team-chat-channel-previews.ts и meaningful pure tests. Existing denied
   Student/anon/foreign org, same actor/channel source, timestamps canonical
   проверяются через реальные local Auth/RPC в одном окне ROOT. Миграцию
   применять только после exact source review; номер/epoch назначает ROOT.
2. UI после принятого reader-контракта: TeamChat.tsx и scoped chat CSS,
   pure formatter при необходимости. Один actual batch1440/390/320, те же
   existing channels и canonical created_at; keyboard/nav/search/context
   только в минимально нужной глубине. Нет новых сообщений ради новых дат.

Обязательные pure cases: old wire + new wire, missing versus malformed timestamp,
null/empty/tombstone, stale ticket/version/sequence, same ID unknown→known и
known→legacy, inconsistent same ID time, absent/revoked channel, Unicode label,
UTC→Bishkek день/год. Часовой пояс браузера не меняет формат. Это pure контракты,
не принятие бизнес-сценария.

Обычные targeted lint/typecheck, diff, independent exact-head review и protected
CI; без полной E2E-кампании. Actual доказательство требует истинных existing
timestamps, root-bound finite seen, полного сохранения данных и own cleanup.
Недоступные old-year/empty/tombstone/другие роли не создавать: указать gaps.
Доставка/rollback: новый внешний field совместим со старой app; приложение
можно откатить, additive read field остаётся. Managed apply/release отдельно
координирует ROOT; локальная проверка не означает production.
