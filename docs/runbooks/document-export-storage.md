# Хранилище сформированных анкет

Команда [configure-document-export-storage.mjs](../../scripts/configure-document-export-storage.mjs)
проверяет настройки одного bucket, а не готовность всего D4. Контракт:
[сохранённые результаты](../design/v3/evo-docs-export-artifacts-contract.md).

## Область действия

- Единственный проект: `iosckaqtovbbnssqcpde`.
- Bucket: `platform-document-exports`, private, только
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
  максимум `5242880` байт (5 MiB).
- По умолчанию только чтение. `--apply` может создать отсутствующий bucket.
  Существующий public bucket или иной размер/MIME — конфликт, без изменения.
- Нет PUT/DELETE, загрузки объектов, SQL, изменения других buckets или запуска
  recovery harness. `platform-documents` остаётся неизменным.

## Запуск после разрешения на managed-настройку

Нужен Node 22. В процессе должны уже находиться `NEXT_PUBLIC_SUPABASE_URL`
со значением `https://iosckaqtovbbnssqcpde.supabase.co` и серверный
`EVO_PLATFORM_SUPABASE_SECRET_KEY` из существующего защищённого окружения.
Не вставляйте ключ в команду, историю shell, тикет или чат. Скрипт сам не читает
файлы `.env` и не получает новые credentials. Publishable/anon ключ не подходит.

```bash
node scripts/configure-document-export-storage.mjs
```

После просмотра результата и только в согласованном окне изменений:

```bash
node scripts/configure-document-export-storage.mjs --apply
node scripts/configure-document-export-storage.mjs
```

Результат — JSON с фиксированными кодами, очищенными before/after settings и
`readbackVerified`. `exit 0` означает только точное совпадение bucket settings.
Имена владельцев, timestamps, сырые ответы, URLs из ошибок и ключи не выводятся;
неожиданные MIME обозначаются `OTHER_MIME`, а не копируются в лог.

## Если проверка не завершена

`bucket_missing`: проверка не создаёт bucket; решите, разрешён ли `--apply`.
`bucket_settings_conflict`: остановитесь; скрипт не переопределяет существующую
политику и не уменьшает ранее согласованные лимиты.
`create_outcome_unknown` или `readback_failed`: не повторяйте запись автоматически.
Сначала повторите **проверку без `--apply`**. Нужен точный readback, не только HTTP200.
`credentials_rejected`: не повторяйте отклонённый ключ; проверьте доступ отдельно.
Другой проект, redirect, неверный JSON или неизвестная ошибка также завершают
команду nonzero. Один запрос ограничен 10 секундами и 64 KiB ответа; повторов нет.

Глобальный Storage limit, RLS/grants и фактические upload/download этой командой
не проверяются. `globalLimitVerified` и `artifactAcceptance` остаются false.
Перед будущими формами20MiB/пакетами65MiB отдельно проверить managed capacity;
этот script не изменяет глобальный лимит, тариф или будущие ограничения D4.

## Основания и проверка

REST GET/POST и поля сверены с установленным `@supabase/storage-js`2.111.0 и
[официальной реализацией createBucket](https://github.com/supabase/storage/blob/master/src/http/routes/bucket/createBucket.ts).
[getBucket](https://github.com/supabase/storage/blob/master/src/http/routes/bucket/getBucket.ts)
возвращает settings; [NoSuchBucket](https://supabase.com/docs/guides/storage/debugging/error-codes)
означает отсутствие, а не произвольный HTTP404. Заголовки следуют
[правилам API keys](https://supabase.com/docs/guides/getting-started/api-keys):
`sb_secret_…` только в `apikey`; legacy service-role JWT также в Bearer.
[Глобальный лимит](https://supabase.com/docs/guides/storage/uploads/file-limits)
имеет приоритет над bucket limit. Паттерн сравнения settings взят из существующего
recovery reconciler по исходному коду; сам recovery harness не импортируется.

```bash
node --test tests/configure-document-export-storage.test.mjs
```

Тесты используют явно подставленный HTTP и синтетический ключ. Это unit proof,
не свидетельство настройки managed Storage или реальной передачи файлов.
