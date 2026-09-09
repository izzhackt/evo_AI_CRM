# E5 — browser acceptance поступления CN / MY

Статус: **PASS — изолированный E5 browser acceptance**, 9 сентября 2026 года. Это не подтверждение production rollout.

## Граница доказательства

- Изолированный локальный Supabase: настоящие Auth, Postgres, RLS и миграции 001–138.
- Отдельная копия Next.js-приложения и собственный `.next`; открытые 3100/3000 и старый `evo-platform-local` не используются.
- Browser использует изолированный `next dev`; видимый Next.js dev indicator не скрывался. Production build, CI и managed release проверяются отдельно.
- Только вымышленные данные. Исходные клиенты/лиды создаются dedicated SQL fixture; договор и первый платёж — описания вымышленных подтверждений, без движения денег.
- Настройка индивидуальных прав подтверждения и staff organization scope проходит через существующие подписанные Admin RPC. Передача шести лидов — существующий подписанный Sales handoff RPC; принятие куратором — настоящий интерфейс.
- Два Student Auth-пользователя взяты из отдельно активированных синтетических E4 fixtures в разных организациях. Это проверка запрета staff-доступа, **не доказательство обычного приглашения**. Normal invite проверяется отдельным E1-контуром.
- Новые факты маршрута, заявки, визы, жилья и поездки изменяются через формы. Существующие application/document-slot RPC используются только для подготовки заявок и точных связей документов.
- Нет mock backend, production-доступа, отправки сообщений, реальных бронирований, иммиграционных заявок или платежей.

## Проверяемые сценарии

1. CN и MY: принятие handoff, выбор направления, основной заявки и документальных оснований.
2. Документы привязаны к конкретной заявке; документ другой заявки не предлагается. Непринятый документ блокирует этап до явно обоснованного исключения.
3. Подтверждение получения партнёром не переводит заявку в поданную. Фактическая подача и canonical status заполняются отдельно.
4. Условное предложение сохраняет блокировку до подтверждения выполнения условий; альтернативная заявка не закрывается автоматически.
5. MY: applicability, EMGS/eVAL, применимые SEV/eVISA и MDAC, жильё, билеты и встреча; общий pre-arrival clearance не подменяет выданный Student Pass.
6. MY: билеты не подтверждают прибытие; завершение требует отдельных фактов прибытия. Medical, registration и Student Pass могут остаться pending. После reopen текущее закрытое прибытие исключается из отчёта.
7. Две реальные вкладки: stale snapshot не перезаписывает сохранённое, ввод остаётся до явного обновления.
8. Реальный offline: несохранённое защищено от ссылок, logout и Back; неопределённое сохранение замораживает ввод, повтор использует тот же запрос.
9. Все пять направлений доступны в навигации. CN-фильтр и сводка сверяются с SQL, MY-отчёт проверяет прибытие и reopen, Europe — пустой результат. Оба реальных Student не получают staff workspace.
10. 393 px: клавиатурная навигация по этапам не меняет стадию; копирование шаблона требует заполненных placeholders и проверяется через настоящий clipboard. Проверяются reflow и axe.
11. CN: после сохранения фактов запрос RSC намеренно удерживается сетевым gate. Соседняя форма статуса недоступна до обновления; после пропуска настоящего запроса следующий ввод сохраняется с новой версией. Backend-ответ не подменяется, sleep не используется.

Матрица содержит 16 зарегистрированных cases: 6 desktop-сценариев и 2 отдельных mobile-сценария; восемь противоположных viewport-вариантов намеренно пропускаются. Это разделение покрытия, а не пропуск failed-сценариев.

## Воспроизводимость

```sh
PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
EVO_NODE_BIN=/opt/homebrew/opt/node@22/bin/node \
bash scripts/test-e5-admissions-browser.sh
```

Требования: Node 22, установленные зависимости/Playwright Chromium, работающий OrbStack и Docker context `orbstack`. Harness выбирает свободные loopback-порты и удаляет только свой scratch/project при завершении. Секреты генерируются для одного запуска и не выводятся.

`source-manifest.json` в приватном evidence-каталоге связывает запуск с HEAD и SHA-256 копий product source, assets, dependencies lock, тестов, harness/helpers, fixture, исходной Supabase-конфигурации и миграций. Ledger сравнивается с **скопированным** inventory. Browser/app logs и PNG остаются приватными; scratch с учётными данными удаляется.

## Выявленное в диагностике

- Fixture: квалифицировано имя `membership.current_role`, чтобы исключить совпадение со встроенным PostgreSQL `current_role`.
- E4 Student-only seed не предоставлял неиспользованным Sales/Curator staff organization scope и Admin индивидуальных прав подтверждения. E5 оформляет их штатными RPC, не отключает проверки.
- Уточнён существующий стартовый экран куратора: `/v3/calendar`.
- Реальный browser обнаружил HTTP 500 карточки: legacy `staff_student_case_read_snapshot` использовал `page.*` после расширения paged directory. Product fix `32fb342c` заменил wildcard на прежнюю явную проекцию; отдельный SQL regression проверяет 33-колоночный контракт. Итоговый E5 после исправления прошёл.
- Реальный browser обнаружил сброс следующего ввода canonical status при позднем refresh после сохранения фактов заявки. Fix `e07d9050` проверен удержанием настоящего RSC: sibling controls disabled до обновления; следующие submitted и offer сохранены с версиями 6→7 и 8→9.
- После обновления подробностей визы legacy VisaForm удерживал прежнюю версию в action state: следующий статус получал stale и оставался заблокирован. Fix `5d4abe79` проверен сравнением hidden expected_version с реальным workspace и переходом approved 4→5 без ручного reload перед сохранением.
- У всех использованных native selects вычисленные accessible names совпали с видимыми названиями без списка options. `getByLabel` использует поиск по тексту с обязательным единственным совпадением, а каждый select дополнительно проверяется через `toHaveAccessibleName`.
- Диагностический `k4UZ3b` дал 7 PASS / 1 FAIL / 8 skips до visa fix. `xIXRxv` дал 7 PASS / 1 FAIL / 8 skips из-за ошибочного общего названия MY-этапа в тесте; исправление `452e3e05` сохраняет отдельную проверку canonical heading и единственного выбранного текущего этапа. Эти запуски не считаются итоговым PASS.

## Итоговый запуск

Проверен committed SHA `452e3e05f6ebcbb85c5f0cb5df0e5005503790e7`. Код, harness, fixture и spec не менялись во время запуска; последующий этот evidence-only документ не меняет проверенные исходники.

- **8 passed / 8 intentional viewport skips**, browser 56.1 s, полный harness exit 0 включая cleanup.
- Ledger: 001–138; marker `E5_ADMISSIONS_MIGRATION_LEDGER_VERIFIED_THROUGH 138`.
- Итоговый marker `E5_ADMISSIONS_BROWSER_VERIFIED`; fixture mode явно содержит `not_invite_or_payment_proof`.
- 471 файл source manifest: повторная сверка с checkout дала **0 mismatches**. SHA-256 inventory: `14e1038a338cb977440a2c3c171006d56b0bc7004d2c5f3249c2b5c538c9698b`.
- 16 PNG просмотрены: 4 CN desktop, 7 MY desktop, stale/offline/manager report, 2 mobile 393 px. Проверены сохранённые значения, видимые блокировки, понятные состояния ошибки и отсутствие перекрытий полей. Все шесть выполненных axe-проверок WCAG 2/2.1/2.2 AA дали 0 violations; это не заменяет полный аудит assistive technologies.
- SHA-256 JSON inventory `{filename: sha256}` для всех PNG с именами в лексикографическом порядке: `95d412390f0fa7037a19b8124a47cded6a9ebf845748ad5d285a782ec02d6a71`.
- Точный реальный MY путь: accepted handoff → семь этапов → confirmed arrival; medical/registration/Student Pass остались pending; monthly arrival count 1 → explicit reopen → 0. Полный CN путь после conditional decision проверяется отдельным SQL gate, не заявляется как полный browser journey этого E5.
- Focused ESLint, TypeScript `--noEmit`, `bash -n` и `git diff --check` прошли. Application log не содержит Error/exception/HTTP 500; pageerror-проверка охватывает и полный MY путь.
- Собственных `evo-e5-*` контейнеров после cleanup нет. 3000 остался за прежним SSH PID 63797, 3100 — за прежним Node PID 72356.

Приватные evidence: `/var/folders/p4/c09jb8gd4qngjbkr1cqfh8rh0000gp/T/evo-e5-admissions-evidence.dqiuYJ/` — `browser.log`, `app.log`, `source-manifest.json` (0600), `screenshots/`. Секреты scratch удалены, evidence не публикуются в Git. Terminal proof: `cfw://span/01a086c2bc4870a1b88b8affef8df858`; source/порт readback: `cfw://span/01a086c3a3cd7541bd44616a136b2887`.

Обычное приглашение, production backup/restore и controlled deployment остаются отдельными границами доказательства в [run-plan](../student-admissions-run-plan.md) и [launch contract](../../../EVO_LAUNCH_PLAN.md).
