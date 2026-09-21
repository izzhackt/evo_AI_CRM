# CRM-09b: договор и оплата — локальная UI-проверка, 21.09.2026

Ограниченный presentation-срез item12. Основной путь на вкладке «Деньги» получил
явные подписи стоимости EVO, оплат с учётом возвратов и остатка; договор, транши,
оплаты/чеки — отдельные секции. Все обязательства раскрываются отдельно, legacy
дополнительные формы/возвраты/история и финансовые права сохранены.
Это не завершение всего item12 и не production delivery.

## Источник и фактическая проверка

Pre-code `8fde0f54dbcd613f83e2e60f487ab3a28f78f616`, independent review approved.
Runtime — пять UI-файлов из контракта; checks исходных readers/DTO/команд сохранены.
Существующая currency-mismatch source-проверка обновлена под новую композицию
с nonempty guard. SQL/API/provider/финансовых записей нет.

Existing ordinary Local Admin, owned-local Supabase001–222, app127.0.0.1:33234.
Использована существующая Chrome-сессия и существующее handed-off active дело
из квитанции root222. Новых актёров/ролей/данных/файлов для картинки не создавали.

- До изменения реально показаны известная цена1000USD, paid0, remaining1000
  без подписей; ниже противоречивое «Бюджет не указан». Договор, транши, оплаты
  отсутствовали. Existing contract tab открывается, утверждённых templates нет.
- После изменения сумма/оплаты/остаток совпадают с исходными значениями; общие
  обязательства больше не выглядят второй ценой договора. Пустые состояния
  договора, траншей, оплат, всех обязательств и истории различимы.
- Actual CSS viewport1280px (scroll1270),390px (scroll390),320px (scroll320).
  Один batched desktop/mobile проход, без дефектов, требующих повторного UI-цикла.
  Сняты реальные full-page screenshots; ширина подтверждена DOM, не только
  параметром эмуляции. Вкладки профиля сохраняют прежний горизонтальный список.
- Название/сумма/валюта несохранённого транша сохраняются после close/reopen.
  Назначение и выбор «Расходы третьих сторон» дополнительной формы также сохранены.
  Значения hidden request ID в Playwright оказались sanitized: сохранность самого
  nonce этим UI-наблюдением не доказана; создание/retry handlers не менялись.
- Клавиатурный переход к следующему summary показывает solid2px focus.
  Договорный CTA имеет44px высоту; новые links/summaries — min-h-11.
  «Условия продажи» ведёт к настоящей форме того же дела, «Подготовка договора
  и отчёты» — к существующему contract workspace того же дела.
- Два наблюдавшихся POST классифицированы по actual Next action manifest как
  `loadStaffNotificationsAction`; финансовые команды/загрузки не запускались.
  Network events не усечены. Scope проверки не включает provider или customer E2E.

48 существующих scoped Node tests PASS, ESLint пяти UI-файлов PASS,
TypeScript `--noEmit --incremental false` PASS, `git diff --check` PASS.
После UI только whitespace indentation в Money, без изменения DOM/вычислений.

## Impeccable: совет → решение → проверка

Operate: знакомые формы и ясная иерархия важнее декоративной выразительности.
Сохранены Golos, EVO tokens и существующий Card; подписи вместо цепочки чисел,
нейтральные секции вместо декоративных KPI, раскрытие вторичных обязательств
без unmount форм, readable tranche action вместо «⋯». Craft-floor прочитан
непосредственно до правок. Existing реальные desktop/mobile captures подтверждают
перенос текста, отсутствие document overflow, доступность переходов/черновиков.

## Целостность и пределы

`/private/tmp/evo-finance-hierarchy-qa/release-receipt.json`
SHA256 `6edf931140639879539a4b8b5c4e915217f94124d5eee5bb189c219dd4c47e13`.
Три full snapshots (beforeUI/afterIncumbent/afterUI) равны:281business tables,
схема/functions/ledger, Auth users/identities counts. Auth attributes и session
rows не хешировались — их неизменность не заявляется. Own server/tab закрыты,
временная эмуляция снята. Скриншоты/DOM/запросы/логи только в private QA-каталоге.

У этого дела нет положительных траншей/сроков/оплат/возвратов/чеков/договорных
файлов, mixed currencies и missing-cost branch. Эти позитивные UI-варианты,
other staff roles/preview и Student finance UI не проверены. Их guards/ledger
семантика проверены исходниками/существующими tests; synthetic success не добавлен.
Полный перенос template/draft/review/post-contract/report остаётся отдельным
срезом; старая contract tab/commands и все B3d-входы сохраняются.
