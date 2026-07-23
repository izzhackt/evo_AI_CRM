# Company Source-Document Registry

| Field | Value |
| --- | --- |
| Owner | EVO management |
| Status | Verified against supplied originals |
| Last verified | 2026-07-12 |
| Sources | Four owner-supplied PDF files |

The checksum is the document's digital fingerprint. If one byte changes, the
SHA-256 value changes. This lets the team confirm that two copies are the same
without exposing the document contents.

| Document | Pages | Classification | Repository location | SHA-256 |
| --- | ---: | --- | --- | --- |
| EVO Admissions logobook | 24 | Team/public brand reference | `docs/company/brand/evo-admissions-logobook.pdf` | `144b1f0183e9868816816beacb5a0a5cd0eec3da6fa7eb8f6a35b16d4854e878` |
| MBank SOM account requisites | 1 | Restricted financial | `docs/company/private-source-documents/mbank-som-account-details.pdf` | `865f084f5f6f4564b1b040685f42c1be3b546a099e3f65e044f3b22cf2790408` |
| EVO Admissions registration certificate | 2 | Restricted legal | `docs/company/private-source-documents/evo-admissions-registration-certificate.pdf` | `4f7c5115b94ec9df6609c82a421ce96c8d56399432fd1c991cd89e5cc34c4f67` |
| EVO Admissions charter | 10 | Highly restricted legal and personal data | `docs/company/private-source-documents/evo-admissions-charter.pdf` | `cfa27c305cd9a9507dd1a5c06f824ee130c3d2729ccd91e3cb7da1b6adf15337` |

The restricted PDFs are intentionally ignored by Git. Their local presence is
not proof that teammates can access them; an access-controlled shared document
store still needs to be selected by EVO management.
