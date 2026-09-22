# A15 — компактный след удалённого сообщения без ответов

Статус на 22 сентября 2026: source реализован на `af47d719`, scoped lint/types
и diff check PASS. На `00cba973` независимое source review и protected CI прошли;
обычный Admin UI подтвердил три существующих отрицательных варианта, включая
ширины390/320/1440px. QA-сессия, браузер и свой сервер закрыты; строгая сверка
данных PASS, добавленных seen0. Независимое actual/closure review одобрено;
QA возвращена ROOT. Docs-only main `eed088a` интегрирован после закрытия runtime.
[Квитанция](qa/team-chat-compact-tombstone-source-2026-09-22.md)
сохраняет provenance и пределы. Положительного root0 нет: его compact geometry
остаётся NOT PROVEN. Ниже сохранён согласованный precode-контракт; ограничения
на ресурсы описывают состояние до отдельного разрешённого окна ROOT.
Основа: main `0926399b04898c919a65d2b5ff5b87adfe2d1d00`, после merged #1030/#1031.
Этот срез завершает конкретное требование §9 исходного
[CRM/UX-плана](EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md): компактный вид
удалённого сообщения без ответов. Сохраняется принятый
[service-row](EVO_TEAM_CHAT_SERVICE_ROW_PLAN_2026-09-21.md), EVO/Golos и доступность
действий без hover. Новые бизнес-функции, message-to-task и новый дизайн исключены.

## Достоверная область применения

`team_chat_message_json` (миграция141) считает `replyCount` по
`parent_message_id = message.id`, включая удалённые ответы. `post_v2` (227)
сохраняет root parent и отдельную прямую цитату. Поэтому у бывшего reply ноль
не доказывает отсутствие входящих прямых цитат; клиентский набор страницы
также не является полным реестром связей.

Компактный класс разрешён только при всех четырёх условиях:
`Boolean(message.deletedAt) && message.parentMessageId === null &&
message.replyCount === 0 && quote === null`.
Это удалённый корень с подтверждённым отсутствием потомков на текущем read.
Строгие проверки `null`/`0` сохраняют обычный вид при неизвестных/отсутствующих
metadata; deleted reply, root с любыми replies и строка с quote не меняются.
Ноль нельзя получать через fallback/coercion или выводить из соседей в ленте.
Это сознательный предел существующего wire-контракта, а не обещание уплотнить
каждое удалённое сообщение без прямого ответа. SQL/DTO/count model не меняются.

## Минимальная компоновка

Добавить один класс на существующий article; всё содержимое и DOM-порядок
оставить: автор → «Сообщение удалено» → время → «Ответить» → меню/«Ссылка».
Для подходящей строки уменьшить внешние вертикальные отступы и убрать только
фон/внутреннюю набивку bubble, сохранив явную текстовую отметку. Имя/аватар,
точное время/title, собственное/чужое выравнивание, highlight/focus и controls
не скрываются. Размеры текста и цели 44px сохраняются. На320 и desktop работают
те же переносы; не использовать absolute positioning, фиксированную высоту,
CSS order/display:contents, отрицательные отступы или новую анимацию.

Правило compact bubble должно перекрывать own/mobile bubble padding/background,
но не удалять highlight outline. Не переиспользовать continuation: удалённые
сообщения продолжают отделять авторские группы. No-replies уменьшает именно
визуальный вес, а не число строк в истории и не доступные действия.

## Сохраняемые механизмы

- Тот же article ID/data-chat-row/tabIndex и положение в sequence; дата-разделитель,
  firstUnread, permalink/quote/context target и scroll anchors не меняются.
- Deleted body остаётся только placeholder без data-chat-body; удалённый текст
  не извлекается/не показывается. Цитирование и прежние «Ответить»/«Ссылка» доступны.
- Правка/удаление/модерация остаются запрещены для deleted как раньше; все actions,
  ожидаемые версии, роли, авторизация и request IDs неизменны.
- Search snippets, feed acceptor, wire readers, seen observer, tail/prepend/return,
  composer/drafts, realtime, календарь и остальные сообщения не изменяются.

## Проверки и полномочия

До UI-правки: короткая независимая Impeccable design/detector сверка и precode
review. Исторические service-row PNG1440/390/320 пригодны только как визуальная
основа неизменных строк; не показывают новый compact tombstone и не доказывают
его будущую высоту. Не обещать численную экономию до реального измерения.

Реализация ограничена `TeamChatMessageRow.tsx`, scoped `team-chat.module.css`
и документами этого среза. Проверки: scoped ESLint, typegen/TypeScript, diff check,
independent exact-head source review и protected short CI. Не повторять неизменные
широкие tests/SQL suites; не писать зеркальные tests для CSS-class условия.
Изменение реальной геометрии принимается только обычным UI-путём.

Shared QA принадлежит B; пока разрешён анализ только уже сохранённых snapshots.
Их дата/SHA и отсутствие нужных metadata явно отмечаются. Три deleted в сохранённом
General, два из них latest50, без parent/replyCount ещё не доказывают eligibility.
Saved-only разбор `339a70ae34ff6e975c9d3b0a2d4bcf0d455b4c1ada24e67f46c4452178bd511b`
сопоставил исторический root с count1 и два reply с входящими direct quotes.
Ни один не является доказанным positive root0; это не новый запрос live данных.
Они пригодны только как будущие negative controls после ordinary revalidation.
Источник A1030 `c1fcda9b`, BEFORE SHA `cc827a8c17c530febfe7f99918c4122f544658e73be01db871df76f474ceebaa`;
приватные ID и содержимое переписки в этот документ не переносятся.
Не создавать сообщения, пользователей, fixtures или отметки seen ради изображения.
Будущий минимальный прогон после отдельного окна ROOT: обычный разрешённый actor,
существующий eligible root tombstone в feed/context, одна группа1440/390/320,
visible author/time/label и44px menu/Reply/Link без отправки; nearby unchanged row,
anchor/Back и доступный highlighted target. Reply создаёт только unsent draft,
затем очищается. Положительные replied/own/foreign варианты — только если есть.
Обычный показ соседних body может изменять seen; такой эффект требует отдельного
точного допуска, снимков и закрытия своих ресурсов. Нет подходящего existing
варианта — actual gap, не подменённая приёмка. До окна никаких runtime/Auth/DB/UI.

Production/native/full item15/issue708 этим срезом не закрываются. Merge/release
координирует ROOT; текущая постановка не разрешает shared/provider mutations.
