# WhatsApp health alert timer (host-side)

`evo-whatsapp-health.service` and `.timer` run
`docker exec evo-crm-app-1 node /app/whatsapp-health-maintenance.mjs` five
minutes after the previous run ended (a oneshot unit never overlaps itself).
The job is built from `scripts/whatsapp-health-maintenance.mjs` into the app
image; migration 321 holds its state. Runbook:
`docs/runbooks/whatsapp-go-live.md`, section «Тревога об отключении и тишине».

What one run does, in short:

- does nothing unless `EVO_PLATFORM_WAHA_INGRESS_ENABLED=1` in the app
  container (WhatsApp intentionally off means no alerts);
- asks WAHA for the status of `crm_primary` (one `GET`, the key comes from the
  Vault binding); it never starts, stops, restarts, logs out or re-pairs the
  session and sends no message to anyone;
- status other than `WORKING`, or WAHA not answering, not knowing the session
  (404) or refusing the key (401/403), for 10 minutes: one task
  «WhatsApp отключён — переподключите» (or «WhatsApp не на связи — проверьте
  подключение и сообщите техническому администратору» when the service itself
  is the problem) for every active system admin (and the
  intake sales head named by `EVO_PLATFORM_WAHA_INTAKE_SALES_MEMBERSHIP_ID`);
- `WORKING` but no incoming customer message for 3 working hours (Mon-Sat,
  10:00-20:00 Asia/Bishkek): one task «WhatsApp молчит 3 часа в рабочее время»;
- the tasks close themselves when the session works again or a message arrives.

Its only output is one JSON line of counters and fixed words
(`journalctl -u evo-whatsapp-health -n 20`): no number, key, token or text.

**Wazzup part** (docs/EVO_WAZZUP_WHATSAPP_PLAN_2026-10-27.md §5.2, §5.4;
`docs/runbooks/wazzup-whatsapp.md`). The same run, after the WAHA part, does three
independent Wazzup steps (nested under `wazzup` in the JSON line):

- `sweep`: projects stored but not yet projected Wazzup events in small batches (50,
  at most 4 per run) and reports the age of the oldest one (`oldest_pending_seconds`,
  `backlog: degraded` above 30 minutes). It runs on every pass while
  `EVO_PLATFORM_WAZZUP_INGRESS_ENABLED=1` and the database transport is Wazzup, even if
  the Wazzup poll fails;
- `health`: one `GET /v3/channels` with the key from the Vault (10 s timeout), the
  channel state becomes the 321 status word for the session `wazzup` (the series is
  written here and only here, once per run) and the same 10-minute / 3-working-hour
  rules open and close the tasks;
- `reconcile`: between 00:10 and 06:00 Asia/Bishkek counts yesterday's inbound messages
  in EVO and, where an amoCRM read is configured, compares them (more than
  `max(3, 2 %)` missing in EVO opens a `gap` task, a matching count closes it).

Each step says `transport_inactive` while the database transport is not Wazzup. The path
(`none`, `waha` or `wazzup`) is read once per run by `platform.whatsapp_transport_read_v1`
(migration 326, service role only, writes nothing) and printed as `transport`. When the
env switches and the path disagree - Wazzup intake on with path `waha`, intake stopped
with path `wazzup`, path `waha` with the WAHA intake off, path `wazzup` with the WAHA
intake on - the run says `degraded` with `reason: transport_mismatch` and the word in
`transport_mismatch` (runbook, section 8); path `none` is the normal state before the
switch and not a mismatch. The AI start for new inbound
messages runs after the three steps with a 15 s deadline; a skipped step or a missed
deadline makes the run `degraded`. The WAHA part is unchanged; with both receive switches on it fails with
`transport_conflict`. The Wazzup part never sends anything to a customer and calls
Wazzup with `GET /v3/channels` only. **Do not switch Wazzup intake on before this
timer is installed:** whatever the in-request projection (5 s) did not finish would
stay unprojected, without an alert.

Installation on the VPS is a one-off server step that needs the owner's separate
go-ahead; it is not part of a release. Install only after the release that
carries `/app/whatsapp-health-maintenance.mjs` and migration 321 is live:

```sh
sudo install -m 0644 deploy/whatsapp/evo-whatsapp-health.service /etc/systemd/system/
sudo install -m 0644 deploy/whatsapp/evo-whatsapp-health.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now evo-whatsapp-health.timer
systemctl list-timers evo-whatsapp-health.timer
sudo systemctl start evo-whatsapp-health.service   # one pass now
journalctl -u evo-whatsapp-health -n 5 --no-pager
```

Rollback: `sudo systemctl disable --now evo-whatsapp-health.timer`. Open alerts
stay as ordinary staff tasks; close them by hand in «Задачи».
