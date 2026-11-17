import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Э3 (27.09.2026): сроки вузов ушли из «Сегодня» решением владельца 28.09 (PLAN_CHANGES «Э8: ответы владельца на открытые
 * вопросы»): чтение 145 (`admissions_deadline_page_v1`) и его код в приложении убраны; сама функция базы и её проверка
 * авторизации в обе стороны (supabase/tests/platform_today_university_deadlines.sql на реальном Postgres,
 * scripts/test-runners/test-postgres-authorization.sh) остаются в базе неиспользуемыми — тест ниже проверяет только их
 * сохранность. Это не живая проверка Supabase, прав или данных. Экран EVO Docs, который жил в этом же срезе, убран из CRM
 * 17.11.2026 вместе со своими проверками.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("real-Postgres suite: the deadline read's authorization both ways runs on the latest chain", () => {
  const script = read("scripts/test-runners/test-postgres-authorization.sh");
  const suite = read("supabase/tests/platform_today_university_deadlines.sql");
  const loopEnd = script.indexOf("find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort\n)");
  const run = script.indexOf("-f /workspace/supabase/tests/platform_today_university_deadlines.sql");
  const policies = script.indexOf("-f /workspace/supabase/tests/authorization_policies.sql");
  assert.ok(loopEnd > 0 && run > loopEnd && run < policies, "after every migration, before the policy inventory");
  for (const proof of [
    /Admissions A resolves with platform_role NULL/u,
    /t3d_band\(\) = pg_temp\.t3d_ids\(801, 803, 809, 810, 813\)/u,
    /pg_temp\.t3d_today\(\) - 7, pg_temp\.t3d_today\(\) \+ 14/u,
    /a deadline passed without submission stays in the band for 7 days/u,
    /a submitted application''s passed deadline stays out/u,
    /a deadline passed before the window stays out/u,
    /Admissions B reads only the own case 502/u,
    /the Admissions Manager reads the active cases curated in its department/u,
    /the Admin reads every active case; closed 504 and pending 506 never appear/u,
    /the Sales Manager \(no application\.manage\) is refused/u,
    /a member with case\.read\.full but without application\.manage is refused/u,
    /the Student is refused, even for the own case 505/u,
    /an authenticated user without membership is refused/u,
    /an anonymous caller is refused/u,
    /an application without a program is a row with a NULL program/u,
    /a submitted application no longer carries the application deadline/u,
    /SECURITY DEFINER, empty search_path, EXECUTE for authenticated only/u,
  ]) assert.match(suite, proof);
  assert.match(suite, /^BEGIN;$/mu);
  assert.match(suite, /^ROLLBACK;\s*$/mu);
  assert.doesNotMatch(suite, /@(?!example\.invalid)[a-z0-9.-]+\.[a-z]{2,}/iu, "synthetic addresses only");
});
