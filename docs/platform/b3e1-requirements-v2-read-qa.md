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

## Реальная локальная проверка — 21.09.2026

Исходники: `1fa3ef0e92477090d06f3a49db72708674d149f6`, два независимых
source review APPROVED. Все шесть обязательных проверок
[CI35554178154](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35554178154)
прошли; два maintenance job пропущены по scope. Интеграция main после `63c65f42`
изменила только Markdown; прежняя проверка типов/codec/native sources относится
к тем же байтам runtime и не выдаётся за новый запуск.

Root передал окно после signup27c. В существующем локальном Supabase
`evo-local-0fd3559d0240c989` один раз применена224 с SHA256
`99f0a1567b9e51786a26ed728fb69a321252ddf92e7c9cc2bc208bb601c2917a`.
Непосредственный baseline совпал с освобождённым root состоянием. Изменились
только три новые функции/их ACL и запись224 в migration ledger. Старые функции,
их права, ledger001–223 и все281 business tables сохранены. Реестр стал001–224;
Auth users/identities осталось8/8.

Обычный вход существующих Student1 и Admin и12 реальных read RPC дали PASS:

- Восемь успешных чтений: две сохранённые подготовки × Student/Admin × v1/v2.
  Все прежние поля совпали, новые поля соответствуют контракту224.
- Четыре отказа: чужое дело, Student через staff RPC, оба RPC без авторизации.
- Четыре исходных v2 ответа без преобразования успешно прочитаны фактическими
  TypeScript и Swift decoders. Это новая проверка на реальном локальном RPC.
- Полные snapshots до/после чтений совпали: business tables, функции/ACL,
  схема/ledger, Auth counts. Содержимое Auth sessions не сравнивалось.

## Портал и CRM на реальных ответах

На том же source HEAD открыт отдельный local server33236 и своя Chrome-вкладка.
Обычный Student-вход: сохранённые Guangdong International Economics and Trade
и XJTLU Computer Science and Technology, оба read refresh и перезагрузка XJTLU.
Обычный Admin-вход: то же дело, обе панели подготовки и «Обновить документы».
Показанные названия, инструкции, ссылки на существующие slots, обязательность
и отсутствие файла сверены с исходными RPC. Стартовый список честно помечен
как требующий уточнения; решение относится к версии файла.

Desktop и настоящий browser viewport390px проверены визуально. У обеих
студенческих страниц и CRM `scrollWidth == clientWidth == 380`: горизонтальной
прокрутки нет; оставшиеся10px занимает scrollbar. Длинные названия переносятся,
нижние действия доступны над навигацией. Сохранены верхний/нижний viewport
кадры; оригиналы JPEG380×822, а не PNG390×844. Снимок с суффиксом
`mobile-bottom-final` подтверждает фактический конец страницы; предыдущий
`mobile-bottom` сохранён как промежуточный кадр.

Первый dev server остановился из-за Turbopack, не принимающего внешний
`node_modules` symlink. Его failure log сохранён. Тот же код успешно запущен
через webpack; данные и приложение ради этой проверки не изменялись.

После UI полные snapshots281 tables/functions/ACL/schema001–224/ledger/Auth8/8
совпали с состоянием после apply. Бизнес-команды, новые identities, загрузки,
отправка заявки и provider actions не выполнялись. Своя вкладка закрыта,
viewport сброшен, свой server остановлен и порт33236 закрыт. QA-окно освобождено
для A225; повторно применять224 нельзя.

## Доказательства и ограничения

Приватные исходные ответы, snapshots и изображения сохранены в
`/private/tmp/evo-b224-read-qa/`; персональные поля и credentials в Git не внесены.
Основные SHA256:

| Артефакт | SHA256 |
| --- | --- |
| `apply-receipt.json` | `418b6014857c01f3c285b4da92866632322566530187b38422446f82d2028103` |
| `read-receipt.json` | `07874802af1e410bcec5ea91bb61695bf1d73f1e4f402984b9ae698ae45ac069` |
| `ui/ui-receipt.json` | `ab16c6f0a77c72bbb4d853d7159e068cc43acd3a868247f8863bb609687c37d8` |
| `ui/after-read.json` | `f2eb8682377e40add0f70bbd26c14ffcb0a534a63f84a3c541d7783d2133b2c2` |
| `release-receipt.json` | `a6e53f58da9b204d4658e8be80468aecbc37de857845d99ab3b38498c6754224` |

Это изолированная QA-проверка текущего218 starter. Полный список, optional,
deadline и definitionImpact проверены codec corpus, но ещё не реальным full
backend. Положительный Admin read не доказывает non-admin scoped assignment.
Swift прошёл фактический decoder и проверку native sources; актуальный native
UI не проверен при недоступном Mac UI. Production rollout, полный editor,
загрузка файла и полная продуктовая приёмка остаются за пределами этого среза.
Старые B3d UI доказательства относятся к своим прежним ревизиям.
