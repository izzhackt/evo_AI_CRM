# Frontend foundation browser evidence

Captured from the real root Next.js application on 2026-07-24 with the seeded
SQLite demo dataset. These images prove responsive rendering and navigation
behavior only; they do not prove any external provider connection.

| Evidence | Viewport | Result |
|---|---:|---|
| `dashboard-desktop-1440x1024.png` | 1440 × 1024 | Full 250 px staff sidebar, top bar and dashboard |
| `dashboard-tablet-834x1194.png` | 834 × 1194 | 80 px icon rail, 2 × 2 KPI grid, no page-level horizontal overflow |
| `dashboard-mobile-390x844.png` | 390 × 844 | Mobile top bar and urgent bottom navigation |
| `mobile-menu-390x844.png` | 390 × 844 | Native modal dialog with role-authorized navigation and focused close control |
| `sales-tablet-834x1194.png` | 834 × 1194 | Wide funnel remains inside its own bounded horizontal region |

Measured browser values:

- Tablet dashboard: `window.innerWidth = 834`,
  `document.documentElement.scrollWidth = 824`, sidebar width `80`.
- Tablet top bar keeps context and controls on the first row and places the
  separate amoCRM, WAHA, and AI states on a second row without overlap.
- Mobile dashboard: `window.innerWidth = 390`,
  `document.documentElement.scrollWidth = 380`, desktop sidebar hidden,
  mobile navigation visible.
- Mobile menu opens as a native modal dialog and initially focuses its labelled
  close button.

Deliberate differences from the visual concept:

- Separate amoCRM and WAHA chips say “not verified” instead of showing green
  connected states because neither provider was exercised in this frontend
  slice.
- AI is labelled “drafts only”; the frontend does not expose automatic send.
- Dashboard figures come from the repository's seeded read model rather than
  invented showcase values.

The remaining page-level workspaces, Student Portal and cross-flow acceptance
evidence belong to later implementation blocks.
