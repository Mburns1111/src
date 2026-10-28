# AM Isa — Card and egg artwork credits

Artwork sources are kept **separate from the factual pet catalogue** in `data/card-artwork-catalog.json`. This prevents pet-name/rarity references from being confused with permission to use art.

## Releases and linked credit lists

- `releases`: planning groups for egg types, each with a list of `eggArtworkIds`. **Release 1 has only one egg type.** Future releases may contain more, without changing the earlier release.
- `artists`: one profile per contributing artist/editor, including display name, platform, and profile link when available. Reuse the same `artistId` when a contributor works on several images.
- `artworks`: one record per image or distinct artwork edition. Store its `artworkId`, contributor roles, original component source, attribution, intended use, local/hosted file, license review, and associated release IDs. For composites, `contributions` identifies who edited/assembled the final image versus who created incorporated elements.

For implemented egg releases, `CardRelease.eggArtworkId` can reference the artwork's `artworkId`. `eggImageUrl` remains the image location used by the existing code. The credit link is **metadata only**; it does not upload, render, approve or import artwork. The catalog's `release-1` is a **planning identifier** until matched to an actual `CardRelease.releaseId`; do not assume one exists in MongoDB.

## Release 1 — the only egg type: edited Egg Drop image

- **Artwork ID:** `egg-drop-001`
- **Artwork type:** Edited/composite egg-drop graphic for AM Isa, **not** the unmodified Pixabay original
- **Created/edited by:** AM Isa project owner (`am-isa-project-owner`)
- **Incorporated artwork:** stux (`pixabay-stux`) — https://pixabay.com/users/stux-12364/
- **Original incorporated material:** Pixabay content ID `1255730`
- **Suggested overall credit:** "Edited for AM Isa using artwork by stux from Pixabay."
- **Original source attribution retained:** "Image by stux from Pixabay"
- **Provided source attribution URL:** https://pixabay.com//?utm_source=link-attribution&utm_medium=referral&utm_campaign=image&utm_content=1255730
- **License/source permissions:** `needs-review` for incorporated material; do not infer reuse rights from attribution alone
- **Release grouping:** `release-1` (its only planned egg artwork)
- **Actual final image file:** Not supplied yet

The finished image was edited/assembled by the project owner and **includes** material by stux. The composite-edit contribution and the original Pixabay visual contribution are credited separately: the creator of the component is not represented as the creator of the entire final egg graphic. Owner's preferred public credit name can be updated later. Editing an image does not, by itself, clear rights for any third-party art included.

## Artist research — αriαℓ / u/softlambkin

The owner reports direct permission from Reddit artist **αriαℓ** (`u/softlambkin`). Artist profile: https://www.reddit.com/user/softlambkin/ . Source thread: https://www.reddit.com/r/AdoptMeRBX/comments/1r9g9qo/adopt_me_fanart_c/

The image-by-image review, Reddit image URLs, comment links and owner decisions are stored in [`data/artist-research-softlambkin.json`](../data/artist-research-softlambkin.json). Owner uploaded conversation screenshots and confirmed further pet identities on 28 October 2026.

### Identified drawings and Series 1 matching

| Pet illustration | Reddit image / context | Current Series 1 |
|---|---|---|
| Strawberry Shortcake Bat Dragon, styled version | `4n7u9ef90xkg1` | Yes |
| Strawberry Shortcake Bat Dragon, Neon effects | `2mly8s5aklkg1` | Yes (same pet species) |
| Wolf and Ghost Wolf pair | `softlambkin-wolf-duo` | Wolf only |
| Turtle, drawn in response to a request | `softlambkin-turtle` | Yes |
| Neon Cute-A-Cabra | `softlambkin-neon-cute-a-cabra` | Yes |
| Bunny Swirl, named Buttercream | `ovz9uv3uykkg1` | No |
| **Arctic Fox**, named Winnie | `ikg3l74flkkg1` | **Yes — owner-confirmed** |
| **Canadian Goose**, with a box backpack | `oup3bl978kkg1` | **No — different from Series 1 Goose; owner-confirmed** |
| **Happy Duckling**, using art of Cloud | `mnmid66l4kkg1` | **Yes — owner-selected representation** |
| **Unicorn**, named Laffytaffy | `c28dvwz60kkg1` | **Yes — owner-confirmed** |

**Important distinction:** The owner selected the costumed drawing of Cloud to **represent Happy Duckling**. This does not establish the source screenshot's species as a verified fact. Its planned card-art association is a creative selection. It is not yet assigned to a database card definition or approved for public display.

The original in-game Turtle reference screenshot `zw2w9yz23lkg1` was posted by `u/PhoenixTheTortoise`. Softlambkin made the **finished Turtle drawing** in the reply. PhoenixTheTortoise also drew a separate pink fan-art picture in that conversation; that other illustration is **not** softlambkin's work.

### Four-pet group illustration — reserved for general use

- **Image:** `xdlpsxxahlkg1`
- **Catalog artwork ID:** `softlambkin-general-multipet-001`
- **Artist:** αriαℓ (`u/softlambkin`)
- **Source:** https://www.reddit.com/r/AdoptMeRBX/comments/1r9g9qo/comment/o6dp5vo/
- **Intended usage:** Undecided future general graphic, **not an individual pet card**.
- **Restrictions:** Unassigned to any release, pet species, or bot feature. Permission scope and full-resolution image still need recording before public use.

The artwork is in the main artwork credits catalog because it has potential other uses, but has `petCardEligible: false` and an empty `releaseIds` list. The sole Release 1 **egg type** remains `egg-drop-001`.

### Skipped illustration

The dark furry pet illustration `urkhhed6ujkg1` from the Glum-Factor3313 request has been **skipped by the owner**. It is excluded from pet-card selection and future general-artwork candidates. Its source link remains in the research JSON strictly for attribution and decision history; no species assignment is needed or pending.

**These are research and artwork-credit records, not imported card art.** Before use in Discord cards, check the specific original file and the permission scope granted by the artist; preserve contributor attribution.

## Upper-Trade-7110 — reported permission and photographed pet art

Reddit: https://www.reddit.com/user/Upper-Trade-7110/ . The project owner reports the artist gave permission to use their art. The exact wording and whether cropping/editing is included have not yet been archived. Their four distinct Reddit photo/media links (one Hedgehog URL was duplicated in the user message) and four user-uploaded reference photographs are tracked in [`data/artist-research-upper-trade-7110.json`](../data/artist-research-upper-trade-7110.json).

| Artwork record | What is depicted | Series 1 status |
|---|---|---|
| `uppertrade-butterfly-slug-001` | Butterfly and Slug; exact butterfly species unconfirmed | Future-releases candidate |
| `uppertrade-beetle-001` | Beetle; exact species unconfirmed | Future-releases candidate |
| `uppertrade-scorpion-001` | Blue-purple **Scorpion**, not a lobster; could be Halloween Blue Scorpion, not confirmed | Future-releases candidate |
| `uppertrade-hedgehog-001` | **Hedgehog** | Series 1 candidate (Ultra-Rare) |

The uploaded photograph `image(20261028-214740).png` also shows an orange-spotted, long-snouted animal with a plant pot. It **might be** a stylized Giant Anteater, but this is not confirmed and no direct Reddit media link is confidently matched to that crop. Preserve this reference in the research file without prematurely labeling it or assigning a card.

All four artwork records exist in the main artist catalog with the artist credited and their original Reddit preview URLs. They are **source-only candidates**, not cropped/imported pet art or approved MongoDB card definitions. The original image URLs could not be independently retrieved during this review, so pet-to-media mapping follows the owner's supplied descriptions and photographs. `releaseIds` remains empty; the Release 1 egg drop still has its sole egg image record.

## Adding images in the future

1. Create or reuse an artist entry (`artistId`, name, profile URL).
2. Add an artwork entry with a unique `artworkId`. For an edited/composite image, credit the editor/composer **and** each outside artwork creator, distinguishing their roles in `contributions`.
3. Record the **original image URL or platform item ID**, not just the platform homepage, plus the file path/hosted URL of the version actually used.
4. Preserve the provided attribution wording and license/permission evidence. Leave `reviewStatus` at `needs-review` until checked; a credit does not automatically mean permission.
5. Add the egg image's `artworkId` to its planned release's `eggArtworkIds`, and add the release planning ID to its `releaseIds`. When a real release record is created, connect its `CardRelease.eggArtworkId` to the image, verifying the real database release ID rather than assuming it matches the planning ID.

This catalog is a **Git-tracked source list**, not an automatic MongoDB import. Nothing in this change updates production, starts drops, publishes the image, or alters existing releases.

## Future integration

The bot can later use the `artworkId` to build an artist-credit display, a credits command, or a read-only credits index without repeating artist information on every egg. Until an explicit integration step is implemented, these records are preserved for editing and auditing in GitHub only.
