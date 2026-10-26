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
