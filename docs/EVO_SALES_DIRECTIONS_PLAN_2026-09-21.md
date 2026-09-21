# Отчёт продаж: полный список направлений

21 сентября 2026. Принятый пункт 7; предыдущий блок #995 смержен.
Исходный main `a23490f746c9d13398712eed5e26dffd2330760b`. ROOT резервирует миграцию 233; A — 234 для очередей сообщений.
Реализация в изолированном worktree; shared QA сейчас у B232, этот блок сначала source-only.

## Actual gap and existing path

- Accepted plan `docs/EVO_CRM_UX_AND_ADMISSIONS_PLAN_2026-09-20.md:131–136`: direction chosen from actual values, filters before pagination, reset keeps period. Current `src/components/v3/SalesRegisterView.tsx:103–117` is an ordinary GET form; direction alone is a free-text input at114. No new POST/action is needed. Existing write actions in `src/lib/platform-sales-register-actions.ts:38–53,176,222` are unrelated and remain untouched.
- Route `src/app/(v3)/v3/main/page.tsx:30–36` retains requireV3PageActor + sales.report.read; capability maps to sales.register.read (`src/lib/platform-access.ts:8`). Flat frontend hints can grant Admin presentation access (`platform-access.ts:29–34`); they are not database authority.
- SSR reader `src/lib/v3/sales-register-source.ts:31–60` validates filters, uses ordinary-cookie Supabase RPC read_sales_register_v2, decodes strictly and checks returned row/query scope. It already passes direction unchanged. No direct/service-role table read is required.
- Authoritative216 `supabase/migrations/216_platform_sales_register_search.sql:19–25,37–58` calls sales_register_actor, then tenant/per-row sales.register.read, archive/year/month/manager/exact direction/review/search before count, currency totals and limit50/offset. Do not duplicate or replace that query. Archived totals intentionally become[] and unresolved counts0 at58; this is existing semantics, not missing finances.
- Existing manager options are all authorized tenant rows independent of current period/filter at216:59–62. Directions have no options reader. Do not derive options from workspace.rows/first50 or from leads/admissions countries. `country` and `direction` are distinct fields (`platform-sales-register-contract.ts:4–8`).
- v1 decoder rejects extra fields (`platform-sales-register-contract.ts:116–132`); v2 strips exactly query and reuses v1 (`sales-register-search.ts:13–19`). Adding direction_options into existing v2 would break that contract.

## One coherent implementation

Add only a separate read-only `platform.read_sales_register_directions_v1(p_organization_id uuid)` plus matching private implementation, a tiny strict directions DTO/SSR adapter, and replace the direction control in the existing GET form. No new table, enum, role, business permission, cache, action or client-side data source.

**Scope**: all records that this actual actor may read within that organization, including other periods and both archive states, independent of q/year/month/manager/review/direction/offset. This matches the manager facet and makes a selected direction stable when period changes. It does not imply every listed value has matches in the current report; the unchanged report decides that. No facet counts are displayed.

**Server**: resolve actor with the same current platform_private.sales_register_actor (156:762–775), apply organization plus staff_can_access(org, actor.membership_id, 'sales.register.read', 'sales_register', r.id) before DISTINCT/limits. The helper admits actors with any sales-register permission, then per-row read scope determines visible values; do not invent a literal Sales/Admin role requirement or implicit system-Admin bypass. Same real-actor read boundary applies in presentation preview; preview does not become ordinary-Sales evidence.

Return exact object `{organization_id, directions: string[]}`. Preserve nonempty original strings, case, punctuation, Unicode and spacing; no aliases, country mapping, trim/lowercase normalization or history rewrite. Use explicit deterministic COLLATE "C" for distinct labels/order so this new list does not merge visually similar but distinct labels. Exclude only SQL-null/missing/empty direction from options; selecting “Все” still includes those records. Do not create an artificial “Не уточнено” value whose empty token would mean all records. A literal stored word such as “unknown” stays an ordinary exact value.

Bound successful payload to1000 distinct options (a proposed safety limit, NOT a measured count). Inspect1001 distinct authorized values and fail explicitly if over1000; never return a silently truncated success. No global/inaccessible count may be exposed. A future readiness read must establish actual distinct cardinality before this bounded choice is treated as sufficient.

**Grants correction**: following216 exactly means private STABLE SECURITY DEFINER with empty search_path and platform STABLE SECURITY INVOKER wrapper. The invoker wrapper requires authenticated EXECUTE on the private implementation as well as platform wrapper (216:79–89; private schema usage already exists in038:35–36). Revoke PUBLIC/anon/service_role defaults and grant only the two named functions to authenticated. “Private closed” means no new exposed schema/table grants; it must not incorrectly mean zero private EXECUTE. Existing helpers/tables/RLS and all v1/v2/write ACLs remain unchanged. Do not set LEAKPROOF.

**DTO/SSR**: use a small separate `src/lib/sales-register-directions.ts` pure decoder (exact keys/org match, bounded array, exact unique strings, no null/coercion/dedup/truncation) and a readSalesRegisterDirections adapter in existing source file. No modification to v1/v2 shape or mutation action. Pass only actor.organizationId; preserve authoritative RPC errors as forbidden/unavailable instead of returning[]. Load once for the report/filter surface, not edit/new/record preview, through the existing ordinary-cookie client. No browser public fetch or cross-actor cache.

## UI states and preserved context

- Ready: native labelled select “Направление”, initial value is exact current query, first option value="" is “Все”, then actual options. Use the same inputCls/min-h-11/grid as manager. No custom combobox, modal, new visual language or autosubmit. Ordinary “Показать” submits existing q/year/month/archive/manager/review and resets offset naturally because form has no offset field.
- Current valid URL value absent from options: retain one exact-value selected option labelled “Из текущего фильтра: …”. This only echoes the user's query; it does not assert that a hidden/deleted direction exists or is authorized. Do not substitute the first option, drop the query, mark the option as disabled, or call this evidence of permission loss. Report may correctly be empty.
- Ready[]: retain “Все” and any current valid value; help text “Нет заполненных направлений в доступных записях”. This describes direction availability, not absence of sales. Unknown direction records remain readable with all directions.
- RPC/decoder/overflow failure: show a distinct inline option-loading error and retain the existing exact-text direction input, so already-working filtering stays usable; do not present[] as successful empty. For a forbidden facet response, do not infer broader workspace rights: preserve independent authoritative report/denial behavior. Existing report load/error remains visible; no success fallback for it.
- Invalid selected query: preserve invalid state and editable text (existing correction path), never truncate/sanitize then silently query a different direction. Reset keeps period; record links/Back keep direction and the other query keys via existing params/href (`SalesRegisterView.tsx:56–70`). No changes to summary995, list991, cash, target/import management, Students layout or financial permissions.

## Concrete compatibility check before precode

There is an actual source-boundary mismatch to handle explicitly, not a new product-policy question:
- Persisted fields permit500 Unicode code points and allow TAB/LF/CR/DEL (`134_platform_sales_register.sql:90–100`; row decoder69–72 also permits these controls). Current direction filter rejects all ASCII controls and measures JS UTF-16 length<=500 (`sales-register-source.ts:41–45`, View36), while SQL216 uses character length<=500 and rejects POSIX controls.
- Small safe recommendation: share an exact non-normalizing direction-query validator between View and SSR that counts500 Unicode code points (bounded UTF-16<=1000 first), preserving SQL's control prohibition. This makes already-storable non-BMP labels selectable without changing SQL or data. It is a direct facet compatibility correction, not changing arbitrary search rules. New DTO must not copy the more permissive row-string decoder for filterability.
- Before claiming a complete usable facet, ordinary read-only readiness must count authorized stored nonempty directions containing current-forbidden controls/otherwise invalid types. If any exist, do not silently omit/normalize them or widen existing216 predicate in this slice: options return explicit unavailable and the old exact-input/report path remains. Report the precise existing-data compatibility gap for a bounded follow-up. No such rows are asserted to exist now. Null/empty values are intentionally not selectable labels as above.

## Validation and next inputs

Owned future files: new migration233; `src/lib/sales-register-directions.ts`; `src/lib/v3/sales-register-source.ts`; direction-related validation/control only in `src/components/v3/SalesRegisterView.tsx`; focused pure decoder/selection tests; approved precode/QA docs. Existing133/134/156/216 historical SQL, country logic and sales actions remain immutable. No overlap with A chat/messages or B admissions.

Pure checks: exact schema/tenant/duplicate/boundary rejection; Unicode500/501 and controls; null/empty/unknown-selected identity; no normalization; error versus ready[]; backward strict v1/v2. These are contract tests, not mocked acceptance. SQL static review must show scope before DISTINCT and overflow, exact grants and no write statement. Actual SQL/Auth/UI later in one assigned local window: existing ordinary Sales/Admin, unavailable/no-read/other-org actors already available; compare full authorized distinct set to options, not to first page; select a real direction and verify exact rows/count/totals before pagination; preserve period/year/all/q/manager/archive/review/reset/Back; desktop390/320 keyboard/native select/AX and long existing labels in max2 batches. No new fixture/role needed. >50 matching rows, >1000 options, populated archive or legacy-control positive cases are UNPROVEN if absent in retained data. Report that rather than constructing evidence.

No unavoidable owner decision was found. 995 merged and migration233 allocated. Remaining: bounded read-only readiness of actor capabilities/distinct cardinality/filterability plus actual source binding. Those are execution/technical inputs, not another policy/permission question.

Impeccable Operate/adapt read with established session context (not rerun): consistent native controls and restrained existing typography; structural stacking, min44px target and real labels, no arbitrary redesign. Craft-floor is due immediately before the eventual UI edit; no UI edited here.

Primary PostgreSQL17 documentation checked2026-09-21: [Collation support](https://www.postgresql.org/docs/17/collation.html) supports explicit byte-order C sorting; [CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html) covers invoker/definer, search_path and default EXECUTE security. These support the proposed SQL mechanics, not a claim that the new function or live data was tested.

## Уточнения перед реализацией

Независимое source-advisory подтвердило scope на main47d4/f59 и отсутствие
изменений направления в #995. Manager precedent ограничивает1000 значений:
новый reader обязан проверять1001-е и завершаться явной ошибкой, не усекать успех.
Fallback input использует maxLength1000 UTF-16 вместе с общим лимитом500 Unicode
code points; прежний maxLength500 не позволял выбрать допустимые non-BMP строки.
SQL проверяет тип/длину/контрольные символы всех разрешённых непустых направлений
перед успешным DTO; неподходящие старые значения не скрываются и не исправляются.

Impeccable Operate/adapt: native select в существующей сетке и типографике,
обычная кнопка «Показать», без autosubmit. Craft-floor читается перед UI-правкой.
Здесь не добавляются финансовые действия, новые данные или country mapping.
