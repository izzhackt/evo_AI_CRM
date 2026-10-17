# Telephony maintenance timer (host-side)

`evo-telephony-maintenance.service` and `.timer` run
`docker exec evo-crm-app-1 node /app/telephony-maintenance.mjs` one minute after
the previous run ended (a oneshot unit never overlaps itself).
Plan: `docs/EVO_TELEPHONY_PLAN_2026-10-16.md` section 5.3; the job is built from
`scripts/telephony-maintenance.mjs` into the app image.

The job does nothing unless `EVO_PLATFORM_TELEPHONY_ENABLED=1` in the app
container, and makes no PBX request without the complete
`EVO_PLATFORM_TELEPHONY_PBX_*` group or while `outbound_paused` is set. Its only
output is one JSON line of counters and fixed words.

Installation on the VPS is a one-off server step that needs the owner's separate
go-ahead (plan section 14, step 5); it is not part of a release:

```sh
sudo install -m 0644 deploy/telephony/evo-telephony-maintenance.service /etc/systemd/system/
sudo install -m 0644 deploy/telephony/evo-telephony-maintenance.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now evo-telephony-maintenance.timer
systemctl list-timers evo-telephony-maintenance.timer
```

Rollback: `sudo systemctl disable --now evo-telephony-maintenance.timer`.
