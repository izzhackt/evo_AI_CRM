import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { formatTeamChatChannelTime } from "../src/lib/team-chat-channel-time-label.ts";

// Pure formatter contracts only. These examples do not prove rendered UI, Auth or live data.
const expected = (dateTime, label, fullLabel) => ({ dateTime, label, fullLabel });

test("a channel time exposes a short Bishkek label and a complete accessible date", () => {
  assert.deepEqual(formatTeamChatChannelTime("2026-09-22T04:05:06.123456Z"), expected(
    "2026-09-22T04:05:06.123456Z", "22.09 10:05", "Последнее сообщение: 22.09.2026 10:05 (GMT+06:00)",
  ));
});

test("the organization date follows Bishkek across UTC day, month and year boundaries", () => {
  const cases = [
    ["2026-09-21T18:00:00Z", "2026-09-21T18:00:00.000000Z", "22.09 00:00", "Последнее сообщение: 22.09.2026 00:00 (GMT+06:00)"],
    ["2026-01-31T18:15:00Z", "2026-01-31T18:15:00.000000Z", "01.02 00:15", "Последнее сообщение: 01.02.2026 00:15 (GMT+06:00)"],
    ["2026-12-31T18:00:00Z", "2026-12-31T18:00:00.000000Z", "01.01 00:00", "Последнее сообщение: 01.01.2027 00:00 (GMT+06:00)"],
    ["2024-02-28T18:01:00Z", "2024-02-28T18:01:00.000000Z", "29.02 00:01", "Последнее сообщение: 29.02.2024 00:01 (GMT+06:00)"],
    ["2026-09-22T00:00:00Z", "2026-09-22T00:00:00.000000Z", "22.09 06:00", "Последнее сообщение: 22.09.2026 06:00 (GMT+06:00)"],
  ];
  for (const [input, dateTime, label, fullLabel] of cases) {
    assert.deepEqual(formatTeamChatChannelTime(input), expected(dateTime, label, fullLabel), input);
  }
});

test("equivalent timestamp offsets produce the same displayed and machine-readable value", () => {
  const result = expected(
    "2026-12-31T18:00:00.123456Z", "01.01 00:00", "Последнее сообщение: 01.01.2027 00:00 (GMT+06:00)",
  );
  for (const input of [
    "2026-12-31T18:00:00.123456Z",
    "2027-01-01T00:00:00.123456+06:00",
    "2026-12-31T12:30:00.123456-05:30",
  ]) assert.deepEqual(formatTeamChatChannelTime(input), result, input);
});

test("dateTime keeps canonical UTC6 even when the wire omits fractional digits", () => {
  const cases = [
    ["2026-09-22T10:05:06+06:00", "2026-09-22T04:05:06.000000Z"],
    ["2026-09-22T10:05:06.7+06:00", "2026-09-22T04:05:06.700000Z"],
    ["2026-09-22T04:05:06.000001Z", "2026-09-22T04:05:06.000001Z"],
    ["2026-09-22T04:05:06.999999Z", "2026-09-22T04:05:06.999999Z"],
  ];
  for (const [input, dateTime] of cases) {
    assert.deepEqual(formatTeamChatChannelTime(input), expected(
      dateTime, "22.09 10:05", "Последнее сообщение: 22.09.2026 10:05 (GMT+06:00)",
    ), input);
  }
});

test("microseconds never round the visible minute into the following day or year", () => {
  assert.deepEqual(formatTeamChatChannelTime("2026-12-31T17:59:59.999999Z"), expected(
    "2026-12-31T17:59:59.999999Z", "31.12 23:59", "Последнее сообщение: 31.12.2026 23:59 (GMT+06:00)",
  ));
  assert.deepEqual(formatTeamChatChannelTime("2026-12-31T18:00:00.000001Z"), expected(
    "2026-12-31T18:00:00.000001Z", "01.01 00:00", "Последнее сообщение: 01.01.2027 00:00 (GMT+06:00)",
  ));
});

test("missing legacy data, null and invalid input do not produce a time label", () => {
  assert.equal(formatTeamChatChannelTime(), null);
  for (const input of [
    undefined, null, false, 0, {}, [], new Date("2026-09-22T04:05:06Z"),
    "", "2026-09-22", "2026-09-22T04:05:06", "2026-09-22T24:00:00Z",
    "2026-02-29T04:05:06Z", "2026-09-22T04:05:06.1234567Z", "2026-09-22T04:05:06+24:00",
    " 2026-09-22T04:05:06Z", "2026-09-22T04:05:06Z\n",
  ]) assert.equal(formatTeamChatChannelTime(input), null, String(input));
});

test("formatter output is independent of the process time zone and ambient locale", () => {
  const moduleUrl = new URL("../src/lib/team-chat-channel-time-label.ts", import.meta.url).href;
  const script = `
    import { formatTeamChatChannelTime } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(JSON.stringify([
      formatTeamChatChannelTime("2026-12-31T18:00:00.123456Z"),
      formatTeamChatChannelTime("2026-12-31T17:59:59.999999Z")
    ]));
  `;
  const result = [
    expected("2026-12-31T18:00:00.123456Z", "01.01 00:00", "Последнее сообщение: 01.01.2027 00:00 (GMT+06:00)"),
    expected("2026-12-31T17:59:59.999999Z", "31.12 23:59", "Последнее сообщение: 31.12.2026 23:59 (GMT+06:00)"),
  ];
  for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Kathmandu", "Pacific/Kiritimati"]) {
    // The child receives only locale/time-zone settings, never the parent's credentials.
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024,
      env: { TZ: timezone, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.deepEqual(JSON.parse(output), result, timezone);
  }
});
