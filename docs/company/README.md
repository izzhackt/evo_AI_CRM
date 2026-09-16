# EVO Product Brand And Shared Company Context

This public CRM repository retains only product-safe context and the brand
resources needed by its independently runnable product and tests.

- [Company profile](../business/evo-company-profile.md): reviewed, product-safe
  facts; use the existing approval rules before making external claims.
- [CRM logobook](brand/evo-admissions-logobook.pdf): the versioned reference used
  by design documentation, the specification generator and the real browser
  upload check. Keep this file in CRM; do not replace it with an external link.
- [Shared EVO context and brand navigation](https://github.com/izzhackt/EVO): a
  separate private metadata repository, available to authorized collaborators.
  It is not required to build or test a standalone CRM clone.

Corporate originals and their local source registry are stored separately in
ignored `EVO/Компания/`, outside both repositories' versioned files. Do not put
legal/bank originals, personal details, signatures or credentials in tracked
Markdown, issues, logs or presentations. The move preserves the originals and
does not erase past Git history or authorize publication of private material.

The runtime logo in `public/brand/`, fonts/template in `assets/`, product business
docs and demo presentations stay in CRM. A shared brand source change requires
a deliberate, reviewed product update; it must not silently replace test inputs
or introduce a sibling-checkout dependency.
