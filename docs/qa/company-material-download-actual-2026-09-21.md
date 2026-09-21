# Материалы компании: два реальных скачивания — 21 сентября 2026

Принят узкий локальный сценарий пункта 32: существующий Admin скачал через UI
два ранее опубликованных TXT. Это отдельная проверка Company download endpoint;
доказательство скачивания платёжного чека здесь не используется.

Исполненный clean source: `e0276ecd5a7a0488370745d84d9b983334d85f52`.
Пять файлов Company UI/route/DTO побайтово совпали с main
`d6add88372778758b23686fb0bba6ae74181e15b`: `KnowledgeDocuments.tsx`,
`FileManager.tsx`, `platform-company-file-storage-route-handlers.ts`,
`api/v3/company-file-versions/[versionId]/download/route.ts` и
`platform-company-files.ts`. Это scoped parity, не новый аудит всего продукта.

## Фактический путь и байты

Для каждого файла выполнен один обычный клик: app GET → 307 → Storage 200 →
browser Download → сохранение файла. Оба Download завершились без ошибки;
сохранённые байты независимо сверены с исходным инвентарём. Первый результат
по байтам и after-first по эффектам принят до второго intent и клика.

| Существующий опубликованный файл | Байт | SHA-256 скачанных байтов |
|---|---:|---|
| Обзор EVO Admissions.txt | 1804 | `1d2f2e9c890bf3c6067659efad8f372c366a1ce8e33e57cc2496c87db5059ac0` |
| Как EVO сопровождает клиента.txt | 1598 | `a40658afde0c558eddd568a3075c38a4ecc58ac961fb8b73ddab5e2e2a91cd11` |

Сетевые записи сохраняют `net::ERR_ABORTED` для redirect-target request.
Это событие сосуществует с успешным Download, Storage 200 и совпавшими байтами;
его причина не установлена. Trace не объявляется полностью свободным от ошибок.
Исторические STOP входа/readiness сохранены, успешная проверка их не переписывает.

## Эффекты и закрытие локальной среды

Сверены все 290 business tables: только download grants +2, consumptions +2,
command receipts +4 и audit events +4; все прежние строки этих таблиц сохранены.
Остальные business-данные, каталог, схема 001–235 и прочие эффекты неизменны.
Каждая новая строка относится к одному из двух разрешённых скачиваний.

Все 33 Auth/Storage таблицы сверены. Изменились только собственные Auth sign-in
metadata и login/logout audits; прежние sessions, refresh tokens и AMR сохранены
точно. Storage и остальные пользователи не изменены; собственная временная
сессия отсутствует в final. Обычный Auth logout вернул 204 с `scope=local`;
UI logout не заявляется. Собственные cookies очищены, браузер и сервер закрыты,
порт 33250 освобождён, собственные файлы захваченного Auth state удалены.
Независимое offline review одобрило две загрузки и strict closure;
release передал среду B1006, не подтверждая его сценарий.

## Квитанции и ограничения

Приватные доказательства хранятся вне Git; здесь только имена и SHA-256.

| Доказательство | SHA-256 |
|---|---|
| `source-parity.json` | `ec05a5fb898c2bfb602ffdec1f23d54df9c7bbf48445b8a73de8547882ebe8f2` |
| `observer/before.json` | `b9c12b873a3320cf496af95337a6439f7a570572b1338d2ab50e34fde688dd36` |
| `observer/after-first.json` | `1ca6adf4206b56f3183adfd8ccddd4b87178beb6cd9bed7a072de7d471555975` |
| `observer/after-ui.json` | `48a13a9b19f6c1bb001e463c5ab694886fde9f2026ec9f3bb870d3190df44468` |
| `observer/final.json` | `73fd5b9937018399cf48ffed88ff70fa359868ff6fd73373203b8302f9d7eeb6` |
| `runtime/download-1.bytes.json` | `00e2747a52d8c8bd2d3b368d5174c1468bf680b318a55eaee9cae35c45e637fb` |
| `runtime/download-2.bytes.json` | `3dddd6eaaf4c9d3d342c0310d9af1cbb98450a9a23ec3a435cb1ffc6400ccb96` |
| `runtime/own-closure.json` | `cb91dd26958d241ebfc2f02fac35300d27fc7693c96d423c403e7b6bf97abc20` |
| `release-receipt.json` | `50fe4292a1a7d9f6e176d13a2d124c0f80a7de849e7e959b7a923b7daea60dab` |
| Независимое actual review | `2abe1d27e415b3e3789ffd3216c218f751bd5dd68915af45cfac0fe83a09526b` |

Подтверждены только эти два существующих TXT и локальный Admin-путь.
Весь пункт 32, остальное содержимое, новые uploads/scanning, другие роли,
клиентский AI и production не считаются завершёнными. Этот документационный
checkpoint не меняет продукт, права, миграции, KB или публикации.
Проверка документационного diff и `git diff --check` заменяет ненужный повтор
неизменённых продуктовых тестов; отдельные exact-head review/CI обязательны.
