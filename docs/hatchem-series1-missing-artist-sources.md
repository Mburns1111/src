# Remaining Series 1 pet art (12) — owner reference list

The first real Series 1 release (`s1-r1`) has 100 planned pets; the original
`Hatchems.zip` supplies 88 900x1260 pet illustrations. All 12 names below were
cross-checked against the uploaded archive and Series 1 roster.

**Never silently substitute artists, invent credits, or count a Reddit post as
a license.** The owner previously reported obtaining permission from these
artists. Retain actual permission/source notes and review each prepared asset
before activating the official release.

## αriαℓ / u/softlambkin (seven)

Original Reddit fanart thread:
https://www.reddit.com/r/AdoptMeRBX/comments/1r9g9qo/adopt_me_fanart_c/

- Wolf — illustration in response to the user's wolf pair (artist reply)
- Turtle — turtle illustration in replies to PhoenixTheTortoise
- Cute-A-Cabra — artist illustration in response to the neon Cute-A-Cabra
- Arctic Fox — selected drawing of Winnie
- Happy Duckling — selected drawing of Cloud
- Unicorn — selected drawing of Laffytaffy; two versions, including without headpiece
- Strawberry Shortcake Bat Dragon — previously selected for this artist, but the
  exact individual image link was not recovered in the current source inspection;
  verify the correct image against the user's original permission/source notes.

## jovyisweird / u/InformalPrinciple834 (four)

- **Owl** and **Otter**: gallery pictures 3 and 4, respectively, at
  https://www.reddit.com/r/AdoptMeRBX/comments/1koppjd/pet_redesigns_because_yes/
- **Lamb**: first design in "Adopt me redesigns part 2":
  https://www.reddit.com/r/AdoptMeRBX/comments/1korpq6/adopt_me_redesigns_part_2/
- **Lion**: first design in "Pet redesigns part 3":
  https://www.reddit.com/r/AdoptMeRBX/comments/1kq332s/pet_redesigns_part_3/

## Upper-Trade-7110 (one)

- **Hedgehog**: owner previously supplied a `preview.redd.it` image URL and
  reported artist permission. The exact URL was not available in the currently
  retrieved notes; recover it from the user's original Artwork-Credit records
  rather than choosing an unrelated Hedgehog or miscrediting the source.

## Preparing for the existing 900x1260 transparent-card renderer

- Create/open a **900x1260 RGBA transparent canvas**. Put the approved artist
  illustration inside the **734x748 window (x=83..817, y=242..990)**.
- Preserve image aspect ratio: scale to fit inside that window without stretching;
  center as needed. Cropping should be a deliberate owner choice rather than
  automatic clipping of artist details.
- Remove any unrelated opaque white page margin if it conflicts with the owner
  background, then export **one full-canvas transparent PNG per pet** with all
  content in the established alignment. Do not flatten the rarity, background,
  `artoutline.png`, or Normal/Neon/Mega layers into individual pet images.
- Filename exactly as the pet: `Otter.png`, `Wolf.png`,
  `Cute-A-Cabra.png`, `Happy Duckling.png`, `Lamb.png`,
  `Hedgehog.png`, `Arctic Fox.png`, `Lion.png`,
  `Strawberry Shortcake Bat Dragon.png`, `Unicorn.png`,
  `Turtle.png`, `Owl.png`.
- Record artist credit on **each** pet: never give all 12 one artist name.
  Imported art remains `needs-review` and the cards stay disabled until the
  owner verifies source terms, attribution and previews.

**Warning:** The existing 88-pet importer assumes shared art in the
source folder; after the owner changed the shared background to
`common-basic.png` and added `artoutline.png`, simply rerunning the old
full-pack importer may fail with a shared-art overwrite guard. Use a dedicated
12-pet add-only import workflow when the 12 properly prepared PNGs are ready.
