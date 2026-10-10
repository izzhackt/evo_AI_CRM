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
| `content_type`, `body_*`, `body_shape` | не JSON, слишком большое тело, обрыв (415/413/400) | форма сайта, edge |
| `keys_missing`, `keys_unknown`, `request_id`, `name`, `phone`, `phone_digits`, `age`, `city`, `country`, `consent`, `honeypot`, `university` | правило проверки, которое не прошло (400); значения не пишутся | форма сайта (`evo-admissions/js/main.js`) и контракт `website-enquiry-contract.ts` |
| `rate_limited` | лимит 5 заявок за 10 минут с одного IP или 100 в час (429) | — |
| `request_conflict` | тот же `requestId` с другими данными (409) | — |
| `rpc_error_<SQLSTATE>` | база отказала (503): например, `rpc_error_42702` — дефект 262 | postgres-логи Supabase |
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

В «Маркетинге → Обзор» рядом с числом заявок периода показано, сколько из них
пришло с формы сайта.

Журнал контейнера живёт до пересоздания контейнера (выпуск); для истории
дольше — квитанции в базе и postgres-логи Supabase (≥ 35 дней).
