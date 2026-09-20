# CRM-22: переход мимо общей навигации

Base main876f78c0; pre-codeb3117d23; runtime
`9fb5d423c56f2e07b75eb968c0af22ebea1f3558`. One AppShell change: focus-visible
«К содержимому», stable ref/id target around page children. No new landmark,
remount key, route/permission/command changes. Original pre-codebase011c note
is historical; doc conflicts after959 kept fullmain+originalappendices.

## Real read-only UI

Existing ordinary Local QA Sales Auth against owned localQA001–215, ownNext33227.
No new entities, form submissions, opened conversations/mark-read or messages.
Desktop pipeline: first Tab focused skip-link (44px height at8,8); Enter focused
target div with tabindex=-1 containing the existing main. URL stayed unchanged;
next Tab reached «Добавить лида». Unsaved search text survived the skip action.

Desktop messages: first Tab again exposed the link; Enter + Tab reached real
«Поиск по студенту». Single main; height1184 at viewport1248 (existing h-64 rule).
390×844 messages: inner/client scroll390, main694 (existing h-150 rule), link44px;
Enter+Tab reached real message search. One batched desktop/mobile screenshot pass.

Browser Back returned to pipeline with unsaved search text still present. On
mobile390, activating skip moved focus to content and preserved that same text;
URL stayed pipeline, no overflow. Device override cleared afterwards.
A few locator operations timed out after Back; fresh DOM snapshots and whole-page
read-only DOM inspection confirmed the state, then actual keyboard activation
completed. These automation timeouts are not relabelled successful operations.

No existing Admin preview UI session was exercised; preview branch/source and
navigation tests remain evidence, not live preview proof. No screen-reader or
physical-device claim. This is one keyboard-access slice22, not all36 completion.

## Checks

- ESLint AppShell and `tsc --noEmit`: PASS.
- Existing navigation/brand tests:21/21 PASS.
- `git diff --check`: PASS.
- Impeccable detector on AppShell: exit0/no findings.
- Independent exact-head review and protected CI recorded by coordinator.
