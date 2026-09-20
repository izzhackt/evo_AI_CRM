# Impeccable — iPhone Home, baseline 2026-09-20

Method: dual-agent (A: /root/home_design_a · B: /root/home_evidence_b).
Native source from #927, identical at d1404aef / 55c5ff4; two fresh RU Simulator
captures and an earlier exact-code dark/max-text capture. No full E2E claim.

The interface is grounded in EVO's real student tasks and native iOS conventions.
Keep the system lists, navigation, real state, and red accent. Improve action
hierarchy rather than replacing the visual language.

| Heuristic | Score | Finding |
| --- | --- | --- |
| Status visibility | 3/4 | Actual stage/counts; independent loading and error states in source |
| Familiar language | 3/4 | Wordy support labels and mismatched KY admission name |
| User control | 3/4 | Native navigation; runner exit not assessed by reviewers |
| Consistency | 3/4 | Native controls; long bottom labels are visually tight |
| Error prevention | n/a | No form/destructive action in assessed Home |
| Recognition | 3/4 | Concrete lesson/test/universities; module denominator ambiguous |
| Efficiency | 3/4 | Direct continuation; quiet state pushes saved work down |
| Minimalism/hierarchy | 2/4 | Name card and quiet admission dominate first viewport |
| Error recovery | 3/4 | Independent retry in source, not exercised in this review |
| Help | n/a | Help/contact outside assessed surface |
| Total | 23/32 | Good, preliminary limited-surface assessment |

## What works

Native NavigationStack/List/TabView, semantic typography, and true progress make
the screen understandable. Calm admission copy avoids false urgency. Source
separates failed reads from genuine empty results.

## Priorities and next implementation

- P2: a real saved test draft (1/36) sits below quiet admission/new learning.
  Keep real required actions/errors first; surface unfinished work earlier.
  Use Impeccable layout/distill with a recorded deterministic ordering rule.
- P2: long auxiliary copy increases scrolling with maximum Dynamic Type.
  Shorten the learning heading and mark the count as module-level. Do not cap
  Dynamic Type or truncate lesson titles. Use clarify/adapt.
- P2: the KY shortcut quotes «Менин тапшыруум» but the actual admission title is
  «Менин кабыл алынышым». Align existing destination terminology with clarify.
- P3: the continue-test frame sits outside the styled control; move the minimum
  height into its label to make sizing explicit. Actual hit failure is not proven.

## Personas and load

Returning student: unfinished work takes extra scrolling. Student using enlarged
text: verbose support copy expands substantially, including mid-word wrapping.
Cognitive load is moderate: section grouping and context work, action priority
is weak. Five native tabs are not inherently an excessive choice count.
The emotional start is calm; attention then splits among several directions.

## Minor observations and limits

The standalone name card and compact tab labels remain small density concerns.
The single red asset against dark card color has a source-derived 3.17:1 contrast
candidate; normal-size dark appearance needs direct verification before declaring
rendered controls inaccessible. No VoiceOver, hardware, actual touch rectangles,
or complete KY runtime assessment was performed by the reviewers.

Assessment B's single detector run returned exit 0 and []. Its documented
non-HTML regex support does not establish native SwiftUI layout/accessibility
coverage; no clean accessibility claim follows. Browser overlays do not apply.

Questions skipped: the owner already requested continuing the UI refinement;
ordinary bounded choices follow the existing product contract. Recommended batch:
layout/distill for priority, clarify for RU/KY, then a bounded native polish pass.
