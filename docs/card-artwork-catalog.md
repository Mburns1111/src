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

The owner reports direct permission from Reddit artist **αriαℓ** (**u/softlambkin**). Artist profile: https://www.reddit.com/user/softlambkin/ . Initial public source thread: https://www.reddit.com/r/AdoptMeRBX/comments/1r9g9qo/adopt_me_fanart_c/

Research and **direct links to the artist's artwork replies** are stored in [`data/artist-research-softlambkin.json`](../data/artist-research-softlambkin.json). The current text-confirmed drawings cover **Wolf and Ghost Wolf together, Turtle, and neon Cute-A-Cabra**. Three pets (Wolf, Turtle, Cute-A-Cabra) match the owner's Series 1 working roster. Other finished works are only associated with pet nicknames/screenshot-only requests, so their species remain unconfirmed.

**These are discovery/review records, not imported card artwork.** Permission message/evidence, reuse scope, final chosen files, and visual pet identification must be checked before assigning an artwork ID to a card.

## Submitted Reddit image links — visual follow-up

Ten Reddit preview links from the fan-art thread are tracked under `submittedImageReview.images` in `data/artist-research-softlambkin.json`. The owner later provided **14 conversation screenshots** containing original in-game pet references and finished art; each preview retains its Reddit image ID, source URL, comment and poster.

**Visual identifications (high confidence):**
- `4n7u9ef90xkg1`: Strawberry Shortcake Bat Dragon, dressed/recolored — Series 1.
- `2mly8s5aklkg1`: another Strawberry Shortcake Bat Dragon, Neon effects — Series 1.
- `ovz9uv3uykkg1`: Buttercream is a Bunny Swirl (dessert petwear) — **not** Series 1.
- `zw2w9yz23lkg1`: requester's gameplay screenshot of a Turtle — Series 1. The actual **Turtle drawing in the reply was made by softlambkin**. Do not count the gameplay screenshot as a separate fan illustration.
- The previously linked Wolf/Ghost Wolf pair, Turtle illustration, and neon Cute-A-Cabra illustration were visually corroborated; Wolf, Turtle, Cute-A-Cabra are on Series 1.

**Candidate identifications, not final:**
- `ikg3l74flkkg1`: Winnie resembles Arctic Fox or possibly a recolored Fennec Fox — both on Series 1, exact species uncertain.
- `oup3bl978kkg1`: brown and white goose-like bird, likely Canadian Goose rather than the Series 1 Goose — uncertain.
- `mnmid66l4kkg1`: Cloud is a costumed pale duck-like bird, possibly Happy Duckling — uncertain.
- `c28dvwz60kkg1`: Laffytaffy resembles a pink-purple Unicorn, but heavy petwear obscures identifying features — uncertain.
- `xdlpsxxahlkg1`: collage depicting four animals, individual species uncertain.
- `urkhhed6ujkg1`: dark furry canine/feline-looking animal, exact species uncertain.

**Creator attribution:** `u/PhoenixTheTortoise` supplied an in-game Turtle screenshot to request art and separately drew pink fan artwork of softlambkin's pet. The pink drawing is **not** softlambkin's work and should not be placed in their credited collection. The submitted Turtle gameplay screenshot is also not authored art; softlambkin's separate Turtle illustration is correctly credited to softlambkin.

All images remain **research records**, not cleared or imported card assets. Record the higher-resolution finished art, exact permission scope and final pet identity before assigning it to a card.

## Adding images in the future

1. Create or reuse an artist entry (`artistId`, name, profile URL).
2. Add an artwork entry with a unique `artworkId`. For an edited/composite image, credit the editor/composer **and** each outside artwork creator, distinguishing their roles in `contributions`.
3. Record the **original image URL or platform item ID**, not just the platform homepage, plus the file path/hosted URL of the version actually used.
4. Preserve the provided attribution wording and license/permission evidence. Leave `reviewStatus` at `needs-review` until checked; a credit does not automatically mean permission.
5. Add the egg image's `artworkId` to its planned release's `eggArtworkIds`, and add the release planning ID to its `releaseIds`. When a real release record is created, connect its `CardRelease.eggArtworkId` to the image, verifying the real database release ID rather than assuming it matches the planning ID.

This catalog is a **Git-tracked source list**, not an automatic MongoDB import. Nothing in this change updates production, starts drops, publishes the image, or alters existing releases.

## Future integration

The bot can later use the `artworkId` to build an artist-credit display, a credits command, or a read-only credits index without repeating artist information on every egg. Until an explicit integration step is implemented, these records are preserved for editing and auditing in GitHub only.
