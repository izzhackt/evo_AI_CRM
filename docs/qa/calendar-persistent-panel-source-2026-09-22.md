# Calendar16b: проверка исходного кода постоянной панели

22 сентября 2026. Основание — принятый [контракт](../platform/crm-calendar-persistent-panel.md),
зафиксированный до реализации коммитом `37d00f7f`; уточнение исправления недоступного исполнителя —
`343116ac`. База `ec3f62bad9b7f5030ecb2949a33d9f1a9b46d9ed` содержит принятую disclosure16a/#1025.

## Изменение

Календарь сохраняет один клиентский экземпляр в пределах личности, организации, membership,
access version и preview. Форма «Задача по студенту» остаётся смонтированной при закрытии панели,
смене задачи, вида, периода и ширины экрана. Её первоначальный день и command request ID не
заменяются новым серверным UUID. Один native dialog становится боковой немодальной панелью
на desktop и модальным окном на телефоне; смена режима не запускает навигацию. Закрытие, возврат
фокуса после завершения навигации и поддерживаемое выделение текста управляются синхронно.

После stale нужны явное обновление, новый серверный token, завершение pending и варианты
исполнителей для точной пары дело/token. Устаревшие ответы не разблокируют форму. Свежие варианты
позволяют исправить уже недоступного исполнителя, но Save остаётся недоступным до допустимого
выбора. Автоматического повтора нет. После saved новая попытка создаётся только кнопкой
«Создать ещё» с UUID, возвращённым прежней action. Известный недоступный target очищает старые
capabilities и показывается в той же панели; другие ошибки продолжают доходить до error boundary.

Локальные классы названия/метаданных карточки приведены к существующим 14/12px. Impeccable
Operate/adapt и craft-floor применены с сохранением EVO; использованы актуальные сохранённые
изображения принятой 16a, не новые изображения 16b.

## Выполненные проверки

- Node `22.23.1`, зависимости собственной worktree установлены через `npm ci --ignore-scripts`.
- 8 новых pure lifecycle checks: старый token, явный refresh, pending, запоздавшие варианты,
  права, исправление исполнителя без разрешения Save и новый request ID только после saved.
- 4 существующих React SSR visibility checks: реальные компоненты и permission helper;
  серверные действия не вызываются. Это проверка разметки, не Auth/DB-приёмка.
- 48 существующих узких calendar integration/D2 checks; включая date/cursor contracts и
  source wiring. Обновлены только прежние ожидания места permission gate, обёртки create action
  и identity key; SSR loader подключает новый pure helper.
- Scoped ESLint и Next typegen/TypeScript; `git diff --check`.
- Общий `DeadlineFields` и весь блок изменения существующей задачи совпадают с базой побайтно.
  State logic disclosure16a сохранена. Actions, SQL, shared picker/composer, AppShell и global CSS
  не изменены. Квитанция проверки сохранности: SHA256
  `4ecc7d340affd1b94e660c9d78c4ab3bf2083bf035da9ed11c7d9b15f5111f6a`.

Первоначальный запуск выявил пустую обёртку у запрещённой формы: она устранена, прежняя проверка
пустого результата сохранена. Четыре первоначальных integration failures относились к старой
форме source wiring, намеренно заменённой этим контрактом. Исходные логи сохранены; последние
указанные проверки прошли. Это не неизвестные production failures и не live save evidence.

## Что ещё не подтверждено

Для 16b не запускались сервер, браузер, Auth, DB или записи задач. Нужна согласованная одна
проверка на существующих данных в 1440/390/320: один form DOM, все draft values/request ID,
resize focus/selection, close/reopen, target/view/period/Back/Forward, Tab/Escape/return и
computed 14/12px. Допускается один ограниченный корректирующий проход при найденном дефекте.
Saved/stale/unknown в реальном приложении не доказаны pure checks и потребуют отдельного
намеренного сохранения; отсутствующие варианты не считаются PASS. Целиком item 16,
широкий финальный E2E, native и production здесь не закрываются.


## Native-picker Escape correction — source checks, 22 September 2026

Pre-code `2653f38a` extends the existing16b contract after the two preserved actual STOPs.
Only `CalendarPanel.tsx` changes product behavior from source `0a01800b`: capture a real open
native select's Escape without cancelling its default, skip the matching desktop event and consume
its paired native dialog cancel. Fresh keydown, keyup, pointerdown, panel lifecycle and unmount
clear the guard. Held-key repeat retains that gesture's provenance; ordinary closed-select Escape
and the Close button retain normal panel-close behavior. No form/action, geometry, CSS or authority
change is included.

Fresh scoped checks: 21 existing calendar integration checks and 4 actual-component SSR visibility
checks PASS; scoped ESLint, Next typegen/TypeScript and diff check PASS. The single-file Impeccable
detector returned exit0 with no findings. These checks do not exercise native picker default ordering;
no fabricated native-event test was added. The previously passed layout/draft prefix remains evidence
for unchanged source, while modal/desktop picker-close + panel-remains-open + next-Escape-close
regression is pending. No new browser/Auth/DB/production run occurred while implementing this fix.


## Native-picker blur/focus correction — source checks, 22 September 2026

Actual regression of `3e11eef9` stopped because both the native picker and panel remained open
after the first Escape. Panel preservation alone is not acceptance; that receipt remains unchanged.
Pre-code amendment `fffb3848` explicitly supersedes the previous native-default assumption.

Only CalendarPanel changes product code: actual open+focused select Escape prevents the keyboard
default, blurs the real select and refocuses it if still focusable, without assigning its value or
selectedIndex. The paired-cancel/event-identity guard is removed; one boolean limits held-key repeat,
with existing gesture/lifecycle resets. Ordinary native cancel, closed-select Escape and Close remain.
No CSS, layout, form/action, permission or source integration change is included.

Fresh checks on this second correction: 21 existing calendar integration and 4 actual-component SSR
visibility checks PASS; scoped lint, Next typegen/TypeScript, diff and single-file Impeccable detector
PASS (detector exit0, no findings). No fake native-event test or new runtime dependency was added.
These checks do not prove popup dismissal, focus events or selection invariance. Independent source
review and the next coordinated modal/desktop native-picker regression remain pending; no browser,
Auth, database or server was run during this source correction.


## Current actual checkpoint — 22 September 2026

The scoped [actual16b](calendar-persistent-panel-actual-2026-09-22.md) passed on `5c421e50`; all three native-picker
STOPs remain historical failures. Independent actual/resource review `4065fc07`
and ROOT release `0531f47e` are accepted. Business data and incoming Auth sessions/
refresh/AMR/Storage are preserved; only own sign-in metadata and two own login/logout
audits differ, and owned resources/capture are closed. No task was saved.

The successful native-picker scenario covers320/1440, held repeat and separate
Escape, focus/draft/request ID, existing target/history/view/period and14/12px.
It measured zero scroll only and one modal Tab, not a full focus cycle. Original0a
geometry1440/390/320 is reused only for unchanged layout. Saved/stale/unknown,
hard reload/cross-identity, absent task/cursor variants, full item16/native/production
remain outside this acceptance. Calendar5c bytes stay unchanged during main2a
integration; final exact-head review/CI/merge #1028 are pending.
