# B3e-1 / 224 — проверка чтения требований v2

Контракт: [read v2](b3e1-requirements-v2-read-contract.md).
Это переход readers CRM/web/iPhone, не реализация полного списка или staff editor.

## Выполнено локально, без DB/Auth

- Общий TypeScript/Swift corpus:172 допустимых и ошибочных wire-форм; оба клиента
  дали одинаковый результат. TS codec с дополнительными v1/Unicode проверками:
  174 PASS; вместе с portal i18n:182 PASS.
- Swift дополнительно проверяет прежние v1 формы, отказ v1 для reserved full и
  некорректные Unicode surrogate sequences. Лёгкая компиляционная проверка всех
  native sources прошла; прежнее предупреждение SessionRouter осталось отдельно.
- TypeScript `npm run typecheck`, scoped ESLint и `git diff --check` прошли.
- SQL224, его PL/pgSQL helper и тела обоих SQL wrappers разобраны pglast7.7.
  Проверка AST нашла только три новые функции и их ACL. Исторические миграции
  и существующие v1 initializer/receipt/pending paths не изменены.

Corpus — проверка протокола, не university facts, не действующий full backend
и не реальные screenshots. Сроки/optional/full/changed пока проверены только
на этом уровне. Текущий224 выдаёт218 starter и новые литералы null /
document_version / null.

## Реальная проверка остаётся открытой

Подготовлен отдельный локальный пакет чтения двух существующих QA-подготовок:
Student1 и retained Admin, сопоставление ответов v1/v2, foreign-case/Student-as-staff/
anonymous отказы. Пакет не создаёт документы, выборы, uploads, reviews или команды.
Admin positive сам по себе не доказывает non-admin scoped assignment.

До исполнения root должен принять точные исходники/SQL/observer и выделить окно
общего локального QA. Проверить прежние281 business tables, старые function
definitions/ACL и ledger001–223 до/после: разрешённая разница — только три функции
224 и его запись ledger. Auth users/identities counts не равны содержимому sessions;
обычный вход фиксируется отдельно. Не повторять apply, если224 уже существует.

После чтения неизменённые реальные RPC ответы должны пройти оба decoder.
Проверка актуального UI на этих ответах и native UI пока не выполнена; Mac заблокирован.
Никакой production rollout, full editor или полной продуктовой приёмки этот отчёт
не заявляет. Старые B3d UI доказательства относятся к своим прежним ревизиям.
