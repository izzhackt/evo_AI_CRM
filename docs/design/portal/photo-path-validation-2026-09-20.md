# Проверка photo objectPath — 20 сентября 2026

База: main 3ac6f326c. Изменён только web resolver и его прямой regression contract. iPhone читает bundled library напрямую и этим resolver не пользуется.

## Реальное чтение

Дата UTC: 2026-09-20T16:22:25.275Z. Текущий committed manifest: 144 записей; каждый production resolver URL совпал с прежним ожидаемым URL, включая 87 managed записей. Из них три детерминированных образца (первая, средняя, последняя managed запись в порядке манифеста) прошли настоящий public Storage GET и SHA-256 сравнение с манифестом:

| Ключ | HTTP | Байт | SHA-256 |
|---|---:|---:|---|
| academy-of-arts-architecture-and-design-in-prague | 200 | 454411 | a643f4a297b265ced1552370ff47c86e1d44e26e5de050e56a7ad3ff620f3b7d |
| technical-university-of-liberec | 200 | 161188 | c8fdb11e405a31deb058a3dbe48b80c2ac3c9afd11c2e21fbe806860f93cd4e9 |
| zjut | 200 | 193123 | cb17ba4b1d08d18409fb339a40c2feb259508f7ae8f2832b88c002623206f5b7 |

## Регрессия и ограничения

Node 22.23.1; npm ci --ignore-scripts выполнен. tests/university-photo-storage.test.mjs: 10/10; scoped ESLint и git diff --check прошли. Первоначальный запуск до установки зависимостей остановился на missing server-only; после установки проверка прошла. Негативные искусственные пути проверяют только чистую функцию, не подменяют настоящее чтение. Существующие тесты migration apply используют тестовые зависимости и не означают реальную миграцию.

Никаких Storage/DB/Auth/provider writes. Не проводились authenticated UI, browser render, iPhone runtime, полная повторная загрузка 87 файлов или выпуск. Bundle-size остаток пункта 26 не закрыт. UI и действительные URL не изменены.
