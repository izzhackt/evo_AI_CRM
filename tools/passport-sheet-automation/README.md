# EVO passport-to-Sheet automation

This macOS CLI reads EVO student rows and Drive links, downloads passport
documents temporarily, extracts TD3 MRZ data locally with Apple Vision, checks
the MRZ checksum and student identity, and optionally fills column X.

## Setup

1. Enable Google Drive API and Google Sheets API in Google Cloud.
2. Create an OAuth client of type **Desktop app** and save its downloaded JSON
   as `credentials.json` here. Never commit that file.
3. Run `uv sync`.

Review all rows without writing:

```bash
uv run evo-passport-sheet \
  --spreadsheet-id 1CqCf8ifv5_NWPJlGmHAAHmUeA-qpkilPy-j0kWvZeVQ \
  --start-row 3 --end-row 42
```

After review, test one real write:

```bash
uv run evo-passport-sheet \
  --spreadsheet-id 1CqCf8ifv5_NWPJlGmHAAHmUeA-qpkilPy-j0kWvZeVQ \
  --start-row 3 --end-row 3 --apply --exclusive-writer
```

The tool never prints passport numbers, refuses to replace a different X value,
and re-reads every write. It does not automate EMGS or visa milestone columns.
Temporary documents are deleted when a row finishes; the OAuth token is stored
with mode `0600` under the ignored `.private/` directory.

Review-only extraction may run while another operator is working. Apply mode
must not: stop every other column-X writer first, then pass `--exclusive-writer`.
Google's values API has no conditional compare-and-swap parameter, so the tool
also checks all X snapshots before writing and aborts on any detected drift.

Official references:

- https://developers.google.com/workspace/drive/api/guides/manage-downloads
- https://developers.google.com/workspace/sheets/api/guides/values
- https://developers.google.com/identity/protocols/oauth2/native-app
