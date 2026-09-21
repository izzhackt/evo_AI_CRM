# A15: время и действия сообщения в одной строке — precode

Статус: принят до реализации. Независимое APPROVED_PRECODE `eeceef77074e6a9450d2803128f5e2d85f4ed4dc13d374212f8039017ab30a5b` для исходного плана SHA256 `83cf121791c7967d5d3eedb0b2835727d9137bb9e9c03bc6df51fb847fbb6964`; ROOT разрешил только ограниченную реализацию, draft PR и source checks. Runtime/actual требуют отдельного окна. Продуктовый код на момент записи контракта не изменён. Срез после PR #1012, merged main `7faa4748c899b58e25d630f6c3942a6dd21ff663`. Exact reviewed head #1012: `88f0479c909c8021f9aa8ff8f59e68af10da336c`; CI35631741403 SUCCESS (5 PASS, 3 ожидаемых scope SKIP); final review0036d57d. Source-папка team-chat и grouping helper у frozen head и merged main идентичны. Канонический dirty checkout не затронут.

Это только чтение исходников и уже сохранённых метрик. Нового браузера, login, сервера, БД, screenshot или повторного visual pass нет. После закрытия B offlineflow общим QA владеет ROOT22G; A/B остаются только в files/source precode/docs. Impeccable: сохраняем EVO, режим Operate, типографику и знакомые действия; context уже был загружен в этой сессии и повторно не запускался. Новая визуальная концепция не нужна.

Текущее выполнение: после precode commit `be254e6f` реализован product source `30f8fa3fbd400ac42bcdcfcb18080995b75ebbbd`; scope ESLint и typecheck PASS. [Source-квитанция](qa/team-chat-service-row-source-2026-09-21.md). Реального UI-прохода новой раскладки пока нет; source review и actual окно ожидаются.

## Подтверждённая проблема и границы вывода

В `TeamChatMessageRow.tsx:28–51` время находится в messageHeader над bubble, а «Ответить» и menu — в messageActions под bubble. После #1012 имя продолжения становится srOnly, но содержащая время верхняя строка по-прежнему занимает высоту. Каждое короткое продолжение поэтому сохраняет два отдельных служебных ряда.

CSS подтверждает причину: messageHeader flex с собственным line box (строки50–51), messageActions содержит минимум44px controls (строки3,53,58). Предыдущее уплотнение сократило padding и повтор автора, сохранив эти два ряда. Высота footer нужна для удобства на телефоне; уменьшать touch targets ради плотности не предлагаем.

Существующий actual #1012 (`6e401f9c31def66963ca63c4bc5e89900e23e627`, product bytes равны merged main) даёт исходные метрики для новой гипотезы:

| Viewport | Высота каждой строки пары | Полностью видимых строк |
|---|---:|---:|
|1440×1000|112.1875px|6|
|390×1000|136.984375px|4|
|320×1000|161.78125px|4|

Источник: `docs/qa/team-chat-message-grouping-actual-2026-09-21.md` и сохранённый `/private/tmp/evo-team-chat1012-local-20260921/ui-proof/batch-result.json`, SHA256 `c27160e74dacf972f4b74cb5a3416716b4950fcf239b161ab61a53f5ec315ea9`. Пара состоит из сохранённых QA сообщений, не из реальных клиентских переписок. Метрики высоты отдельного header не собирались; точную экономию пикселей и процент улучшения не обещаем. DOM/CSS показывают устранимый ряд, но окончательный выигрыш зависит от переноса footer на узкой ширине и intrinsic width bubble.

## Решение

Перенести единственный существующий `<time>` и условную метку «изменено» в видимый footer вместе с прежними «Ответить» и details menu. Над bubble оставить имя автора. У continuation весь авторский header выводится существующим srOnly: имя читается перед body, но пустой визуальный header не занимает высоту. У полной строки имя видно как сейчас. Итого последовательность DOM: автор → цитата/body/mentions → время/изменено → Ответить → menu. Не применять CSS order, дублирование time или aria-hidden к полезной метаинформации.

Полные строки, deleted, highlighted и firstUnread по-прежнему определяются текущим grouping helper. Его правила и prop не меняются. Новая раскладка одинакова по смыслу для всех строк; выигрыш ожидается прежде всего на продолжениях, где отдельный авторский ряд уже визуально не нужен.

Footer — обычный flex-wrap, не новая toolbar с особой клавиатурной моделью. Метаданные допускают перенос между time и edited marker, само HH:mm не разрывается. Сохраняются timezone, dateTime, полный title времени, label «изменено», font-size12/13px. «Ответить» остаётся текстовой кнопкой, menu44×44, все действия доступны без hover. Открытый details сохраняет существующее flex-basis100% и inline expansion: menu не становится абсолютным/popover и не обрезается history overflow. На тесной ширине перенос footer лучше скрытого времени или уменьшенных controls; результат на320 проверяется отдельно.

Собственные сообщения сохраняют правое выравнивание, чужие — левое и текущую колонку аватара. Основной текст16px, размеры touch44px, цвета, Golos, padding bubble, composer, shell и channel rail остаются прежними. Не добавлять новый min-width, который шире доступной колонки; messageContent min-width0/max-width сохраняются. Возможное расширение очень короткой bubble из-за общей intrinsic ширины footer — прямой риск, который проверяется в принятом UI batch, а не замалчивается как гарантированная экономия.

## Точное владение и сохранение функций

Будущий A меняет только:

1. `src/components/v3/team-chat/TeamChatMessageRow.tsx` — авторский header, перенос существующих time/edited nodes, добавление локального footer class. Только первая функция Row; DeleteConfirmation не трогать.
2. `src/components/v3/team-chat/team-chat.module.css` — новый scoped messageFooter/metadata selector и точечный перенос time styling из header в footer. Не изменять общий `.messageActions`/`.textButton`: они используются также delete confirmation, composer и retry/navigation UI. Дополнять row footer отдельным классом.

Все article id/data-chat-row/data-chat-body/tabIndex, parent React keys, menu ref и details type, callbacks, условия edit/delete/moderate и permalink сохраняются. Details и footer остаются на стабильном месте дерева между full/continuation: смена grouping при prepend не должна размонтировать открытое меню. Не создавать две условные копии actions. Внутренний click closeMenu сохраняется. Quote, mentions и удалённый body не меняются.

Не менять TeamChat.tsx, helper/tests алгоритма, async handlers, store/range, retries, realtime, seen, composer/drafts, DTO/readers/SQL/миграции. Изменение геометрии влияет на фактически видимую область: seen остаётся основанным на существующем body и реальных visibility thresholds, без искусственной поправки unread. Author continuation остаётся доступным скринридеру. Проверка DOM/AX не является доказательством VoiceOver.

## Порядок после принятия

1. Создать новый изолированный worktree от свежего main. Проверить изменения этих двух файлов и зависимости с момента7faa; при существенной чужой дельте пересмотреть план. Зафиксировать принятые scope/риски в Launch и PLAN_CHANGES до кода. Старый frozen worktree #1012 и чужие работы не менять.
2. Прочитать Impeccable craft-floor непосредственно перед UI edits. Сделать одну целостную правку двух файлов; diff review прав/идентичности DOM и handlers, scope lint/typecheck. Не добавлять JSX string snapshots или новый бессодержательный unit test: бизнес-алгоритм не меняется. Имеющиеся39/39 могут быть явно сосланы как прежняя проверка неизменённой логики, не как новый run или доказательство новой UI раскладки.
3. Независимое exact-head source review через ROOT. Никакого самостоятельного QA admission: сейчас ресурс у ROOT22G. Перед будущим actual согласовать с ROOT новый ограниченный window и fresh scope; старые Auth/session binding нельзя переиспользовать как текущие разрешения.
4. Один actual batch на существующих разрешённых данных: desktop1440 и mobile390/320 вместе. Не создавать сообщения/actors только ради визуального покрытия. По найденным проблемам максимум один пакет исправлений и один confirmation batch; не продолжать текущий #1012 visual цикл третьим проходом.

## Что должно доказать будущее actual

- На той же сохранённой паре, viewport и scroll context измерить row height/fully-visible count и сравнить с указанной базой. Должна уменьшиться высота короткого continuation как минимум на desktop; не выдать перенос footer на320 за улучшение, если фактическая высота выросла. Если выигрыш не подтверждён или за него платим переполнением/утратой действий — вернуть решение на рассмотрение, не запускать бесконечную полировку.
- На1440/390/320 видно время каждой строки; duplicate time отсутствует; «изменено», если доступен сохранённый пример, видно; автор и body читаются в правильном DOM/AX порядке. Полная первая fetched строка/highlighted/deleted сохраняют видимого автора. Нет document/footer overflow, body16px, controls>=44px, один composer. Высота/положение оценены при закрытом и открытом menu.
- Сохранённые «Ответить», menu, «Ссылка» доступны Tab/Enter и touch. Reply создаёт прежнюю composer quote; её снятие сохраняет unsent draft. Не запускать edit/delete/send только ради проверки layout; наличие/условия этих controls проверить исходниками и на уже разрешённых строках.
- Один prepend и search→context→Back сохраняют existing anchor по messageId и несохранённый draft; открытое details/focus не теряются при изменении presentation flag. Не добавлять новый scroll manager. Permalink по-прежнему открывает полный target.
- Если существующий разрешённый набор содержит foreign avatar, quote/mentions, edited или actual firstUnread — проверить их в том же batch; иначе перечислить точные gaps. Авторские и firstUnread helper tests не подменяют отсутствующий actual пример.
- Fresh before/after/final сверка и закрытие собственных login/browser/server по отдельно принятому window. Для чужих сообщений возможны законные seen effects: bind точные allowed IDs заранее; не объявлять zero-write по привычке. Не затрагивать сессии/серверы B или пользователя.

## Что остаётся вне этого предложения

Превью всех разрешённых каналов — отдельный reader/DTO/ACL scope. Превью выбранного канала уже существует из latestMessageId/store и не нуждается в повторной реализации. Сейчас TeamChatChannel не содержит latest-message preview для остальных каналов: не использовать N запросов, первую строку поиска или ложное «Нет сообщений» для косметики. Этот precode не резервирует миграцию и не принимает весь item15, items1–36, iPhone/VoiceOver или production. У #1012 есть merge, но production deploy здесь не запускался.

Вывод: исходники подтверждают ограниченную следующую возможность уплотнения продолжений без уменьшения доступных действий. Рекомендую этот двухфайловый slice после review; выигрыш пока гипотеза с конкретной исходной метрикой, а не готовый результат.
