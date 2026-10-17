# Приём заявок сайта: как увидеть, что он работает

Аудит 10.10 (A7): после исправления 262 нельзя было отличить «с сайта никто не
писал» от «отправки падают». С 10.10 приёмник Платформы
(`src/lib/server/website-lead-intake.ts`) пишет одну строку журнала на каждый
ответ. В ней нет полей формы, имени, телефона, IP и id запроса — только:

```json
{"event":"website_intake","status":400,"code":"invalid_request","reason":"name"}
```

`status` — HTTP-ответ сайту, `code` — код в теле ответа, `reason` — причина из
закрытого списка:

| reason | Что значит | Куда смотреть |
| --- | --- | --- |
| `accepted` | заявка принята (200) или повтор того же `requestId` | — |
| `config` | на сервере нет ключа edge, организации или intake-владельца (503) | `.env.production` |
| `key_or_origin`, `ip` | edge не подставил ключ/IP или чужой Origin (403) | edge Caddy, маршрут `/api/website-leads` |
| `content_type`, `body`, `body_json`, `body_size`, `body_timeout`, `body_shape` | не JSON, слишком большое тело, обрыв (415/413/400) | форма сайта, edge |
| `keys_missing`, `keys_unknown`, `request_id`, `name`, `phone`, `phone_digits`, `age`, `city`, `country`, `consent`, `honeypot`, `university`, `fields` | правило проверки, которое не прошло (400); значения не пишутся | форма сайта (`evo-admissions/js/main.js`) и контракт `website-enquiry-contract.ts` |
| `rate_limited` | лимит 5 заявок за 10 минут с одного IP или 100 в час (429) | — |
| `request_conflict` | тот же `requestId` с другими данными (409) | — |
| `rpc_error_<SQLSTATE>`, `rpc_error_PGRST<nnn>`, `rpc_error` | база или PostgREST отказали (503): например, `rpc_error_42702` — дефект 262; без кода — `rpc_error` | postgres-логи Supabase |
| `rpc_unavailable`, `rpc_status`, `rpc_shape`, `rpc_exception` | функция вернула «недоступно», неожиданный ответ или упала по таймауту (503) | intake-владелец, сеть до Supabase |

## Счёт за сутки (только чтение)

На hermes-vps:

```bash
docker logs --since 24h evo-crm-app-1 2>&1 | grep -o '"event":"website_intake","status":[0-9]*,"code":"[a-z_]*","reason":"[A-Za-z0-9_]*"' | sort | uniq -c | sort -rn
```

Ни одной строки за сутки — до Платформы не дошло ни одной отправки: смотреть edge
и сайт. Принятые заявки по дням — в базе (только чтение, агрегат):

```sql
select created_at::date as day, count(*) from platform_private.website_lead_receipts
where created_at > now() - interval '14 days' group by 1 order by 1;
```

Квитанций может быть больше, чем лидов с источником «Сайт»: повтор с тем же
телефоном присоединяется к открытому лиду, а заявка человека с делом прямого
добавления или импорта в работе присоединяется к лиду этого дела и нового лида
не открывает (миграция 303; `docs/runbooks/admissions-direct-import.md`).
Такие заявки в «Маркетинге» считаются повторными.

В «Маркетинге → Обзор» рядом с числом заявок периода показано, у скольких из них
источник «Сайт». Это форма и ручные лиды, которым сотрудник выбрал «Сайт», —
не только форма; доставку формы показывают журнал и квитанции выше.

Журнал контейнера живёт до пересоздания контейнера (выпуск) и ограничен 5 файлами
по 10 МБ; строка пишется до проверки лимита частоты, поэтому поток мусорных POST
может вытеснить сутки журнала — тогда смотреть квитанции в базе и postgres-логи
Supabase (≥ 35 дней).

## Список стран формы (282): порядок перехода

Один список стран продукта: CN, MY, AE, TR, IT, CZ и «Пока не решил»
(`src/lib/study-countries.json`, решение владельца 16.10.2026). Форма сайта
шлёт английские значения: China, Malaysia, United Arab Emirates, Turkey,
Italy, Czechia, Undecided.

1. **CRM с 282.** Приёмник принимает текущие значения
   (`platform_private.website_enquiry_country_values()`) и прежние значения
   старой формы (`website_enquiry_legacy_country_values()`: Europe, Germany,
   United Kingdom, Netherlands, France, Poland, Austria, Cyprus). Направление
   лида прежнее: Italy, Czechia и прежние европейские значения дают `EU`,
   Undecided остаётся без направления.
2. **Сайт.** Выкладка формы с новым списком делается отдельным шагом с OK владельца.
   Новый список целиком входит в то, что приёмник уже принимает, поэтому
   порядок «сайт раньше CRM» тоже безопасен.
3. **Прежние значения остаются.** Приёмник сознательно не сужается
   (план §6.4): кэшированная старая страница, повтор со старым `requestId`
   или откат сайта не должны терять заявку. Отдельной миграции сужения нет;
   если её захотят, нужно решение владельца и правка плана §6.4. Посмотреть,
   приходят ли ещё прежние значения (только чтение):

   ```sql
   select payload->>'country' as country, count(*) from platform_private.website_lead_receipts
   where created_at > now() - interval '14 days'
     and payload->>'country' in ('Europe', 'Germany', 'United Kingdom', 'Netherlands',
       'France', 'Poland', 'Austria', 'Cyprus')
   group by 1;
   ```
