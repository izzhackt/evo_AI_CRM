# University catalogue: reviewed public sources, 10 September 2026

## Publication boundary

The initial five records were **editorial templates**, not live database seed
rows. That initial runtime file was retired in the
[full-catalogue run](../university-catalog-completion-run-plan.md); the current
country-specific reviewed JSON files replace it, not a second catalogue.
The sixteen previously accepted identities remain only as a compact regression
snapshot in `tests/fixtures/university-catalog-accepted-identities.json`.
Migration 148 creates
no university, Admin, student or approved source. An existing authenticated,
organization-scoped Admin must save a draft, inspect every public field and
official source, then explicitly publish it. Drafts remain private to Admin.
The atomic publication invokes the existing BW5 source-review and catalogue
import workflow for a new institution; existing canonical identities are reused.
Details and programs are immutable publication revisions, with optimistic
version checks. Exact requests replay their original receipt; a newer version
cannot be overwritten by an older draft.

There is no university API sync, remote server fetch, applicant ingestion, price
promise, partnership claim, ranking or generated campus image. Unknown dates,
times, language and unavailable photos remain null. A program's start date is
not treated as its application deadline. All displayed content is reviewed for
Student publication; raw registry/audit rows are excluded from the DTO.

## Official content

| University | Verified example and intake | Source / explicit limits |
| --- | --- | --- |
| Asia Pacific University of Technology & Innovation, MY | BSc (Honours) Computer Science; three years. The program page lists 28 September and 24 November 2026 starts. | [Official program](https://www.apu.edu.my/course/bsc-hons-in-computer-science). Application deadlines are **unknown**; intake availability requires confirmation. |
| Sunway University, MY | BSc (Honours) Computer Science; three years. January / April / September are recurring intake months. | [Official program](https://sunwayuniversity.edu.my/faculty-of-engineering-and-technology/courses/bachelor-of-science-honours-computer-science). No exact upcoming intake year/date or deadline is inferred. |
| Multimedia University, MY | Bachelor of Computer Science (Honours), Cyberjaya; three years. Published international application deadline: 23 September 2026. | [Official program](https://www.mmu.edu.my/programmes-by-faculty-all/programmes-by-faculty-fci/bachelor-of-computer-science-hons/), [program/campus list](https://www.mmu.edu.my/full-list-of-programmes-offered/), [intake notice](https://www.mmu.edu.my/apply-now/). The notice labels 10 November 2026 with an inconsistent weekday; only November is stored, exact start remains null. Closing time/timezone are not supplied. |
| Xi'an Jiaotong-Liverpool University, CN | **BEng (Hons)** Computer Science and Technology; four years; September 2027 listed on the program page. | [Official program](https://www.xjtlu.edu.cn/en/study/undergraduate/computer-science-and-technology), [undergraduate applications](https://www.xjtlu.edu.cn/en/admissions/global/how-to-apply). The past June 2026 undergraduate deadline is not rolled forward. [Master's deadlines](https://www.xjtlu.edu.cn/en/admissions/master/how-to-apply) do not apply to this bachelor program. |
| University of Nottingham Ningbo China, CN | BSc (Hons) Computer Science; three/four years depending on entry. | [Official program](https://www.nottingham.edu.cn/en/study-with-us/undergraduate/courses/prospectus.aspx?id=9270dd66-3c75-45de-bebe-bafe5d78c7c1), [undergraduate applications](https://www.nottingham.edu.cn/en/study-with-us/undergraduate/how-to-apply.aspx). The latter retains a 30 June 2026 heading but its update closed regular admission 21 June at 23:59 Beijing and discussed waitlisting. No old date is displayed as a current open deadline; the next intake deadline is unknown. |

Summaries are short editorial paraphrases, not copied prospectuses. These five
computing examples are not represented as each university's complete catalog.
An Admin can add other real institutions and programs with separately checked
official HTTPS source URLs; they are not restricted to the five initial hosts.
Links are display-only, without credentials, private literals, fragments or
secret query parameters. The human review establishes whether a public URL is
actually an appropriate official source; URL syntax alone cannot do that.

## Existing EVO sources and conflicts

- Migration 056 defines a reviewed import boundary, not a real university seed.
  `docs/platform/bw5-catalog-import-boundary.md` records an unavailable Notion
  source; synthetic acceptance fixtures are not customer-facing records.
- The approved client knowledge note **«APU — наборы и стоимость»** contains older
  dates. Current [APU intake calendar](https://www.apu.edu.my/intake-calendar)
  lists Foundation 19 November rather than the note's 20 November; listed
  Diploma 7 September / 9 November entries refer to Semester 2 credit transfer.
  Those entries and unverified prices were not imported. The knowledge note is
  unchanged; its conflict is recorded here instead of silently retaining both
  dates as current. The new bundle uses the dated official program source.
- No raw/private applicant archive, correspondence or personal attachment was
  used. Approved China checklists contain process conditions, not a reliable
  list of university offerings to invent or auto-publish.

## Real campus images and licensing

Wikimedia Commons file pages and `imageinfo` license/author metadata were
checked on 10 September 2026. The UI uses four **exact public thumbnail URLs**,
not arbitrary user-supplied image URLs or a server image proxy. Requests use
`referrerPolicy="no-referrer"`; image failure shows a truthful placeholder.
Local binary downloads were blocked by the execution tool, so no local campus
files are claimed or relied on. The photographer and source/license links are
shown with every image. Thumbnail resizing and card cropping are disclosed.

| Key | File / author | License |
| --- | --- | --- |
| sunway | [Cmglee Sunway University new building](https://commons.wikimedia.org/wiki/File:Cmglee_Sunway_University_new_building.jpg), Cmglee | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| mmu | [CYBER.jpg](https://commons.wikimedia.org/wiki/File:CYBER.jpg), Dunhill1410; Cyberjaya campus, 2009 | Author's public-domain dedication (PD-self), documented on file page |
| xjtlu | [XJTLU Admin Lib.JPG](https://commons.wikimedia.org/wiki/File:XJTLU_Admin_Lib.JPG), Goyah; 2013 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| unnc | [20230912 Ningbo Nottingham Daxue.jpg](https://commons.wikimedia.org/wiki/File:20230912_Ningbo_Nottingham_Daxue.jpg), Yumeto; 2023 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

Image licenses remain the stated per-file licenses, not the repository's code
license. Attribution is not endorsement. APU has no suitable verified current
campus image here: the historical UCTI exterior and Japan's unrelated APU are
not used. A third-party MMU image with unclear copied-photo rights was rejected.

## Existing Admin publication steps

1. Open `/v3/universities/manage` using the ordinary existing Admin account,
   outside role preview. Choose a prepared university or “Добавить другой
   университет”. Do not create a fake Admin or bypass Auth.
2. Check the official pages, correct any changed facts, keep unknown dates
   empty, and save the content **на проверку**. All content fields will be public
   after publication; the separate Admin reason is not part of Student content.
3. Open the draft preview; confirm sources, dates, public suitability and the
   publish decision. A single transaction records review/import/publication.
4. Open the published staff card. The same published content is available under
   `/portal/universities` only to a genuine active Student in the organization.
   An Admin cannot impersonate Student to inspect private student information.
5. Subsequent edits start with “Предложить обновление” on a published card and
   receive a new version only after review. A stale draft requires deliberate
   reconciliation; uncertain transport retries keep the same request/content.

Local SQL tests are rollback-only authorization evidence, not proof that these
records have been published in production or exercised by a live Student.
