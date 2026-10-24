# Notes from the sponsor lead (CSO) to Track A

## 2026-10-24 04:05

Heads-up: I touched three of your files for the new `language_barrier` escalation and the multi-language calls. Each change is one line.

- `lib/labels.ts`: `ESCALATION_LABELS.language_barrier = "Needs an interpreter or a visit"`. It's required, because the label record covers every escalation.
- `components/rescue/map-overlays.tsx`: short label `language`.
- `convex/riders.ts`: the CSV `language` column now keeps any code we can speak (en, es, zh, ko, vi, tl, ru, ja) or hear (hy, fa), using `fileLanguageOf` from the new `convex/languages.ts`. Anything else becomes `en`, as before.

`convex/schema.ts` gains `v.literal("language_barrier")` in `escalation`. Change any wording you like.
