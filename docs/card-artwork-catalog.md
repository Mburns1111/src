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

## Submitted Reddit image links (10)

The project owner supplied ten Reddit preview image links from the fan-art thread (two were accidentally pasted together and are separated in the registry). They are preserved in `data/artist-research-softlambkin.json` under `submittedImageReview.images`, each with an exact source URL, Reddit image ID, original poster and reply context.

**Important provenance distinction:** Nine supplied images were posted by `u/softlambkin`. The file `zw2w9yz23lkg1.png` was posted by **u/PhoenixTheTortoise** as a separate drawing offered in exchange, not by `u/softlambkin`, and is excluded from their attributed artwork. Do not interpret the surrounding Turtle request as establishing the depicted pet's species.

The images' pixel content was not accessible through the current inspection method, so none of these ten image files has been assigned a confirmed Adopt Me pet species. Replies identify the nicknames **Winnie, Buttercream, laffytaffy, and Cloud** for some images; these are not species labels. Where the artist replied to another person's uploaded pet screenshot, the species still requires visual verification.

Keep these as research-only previews, not approved image files or card assets. When the original pictures/screenshots become available for visual inspection, update each `petSpecies`, confirm whether it matches the 100-pet Series 1 list, and record the higher-resolution source and permission scope before artwork approval.

## Adding images in the future

1. Create or reuse an artist entry (`artistId`, name, profile URL).
2. Add an artwork entry with a unique `artworkId`. For an edited/composite image, credit the editor/composer **and** each outside artwork creator, distinguishing their roles in `contributions`.
3. Record the **original image URL or platform item ID**, not just the platform homepage, plus the file path/hosted URL of the version actually used.
4. Preserve the provided attribution wording and license/permission evidence. Leave `reviewStatus` at `needs-review` until checked; a credit does not automatically mean permission.
5. Add the egg image's `artworkId` to its planned release's `eggArtworkIds`, and add the release planning ID to its `releaseIds`. When a real release record is created, connect its `CardRelease.eggArtworkId` to the image, verifying the real database release ID rather than assuming it matches the planning ID.

This catalog is a **Git-tracked source list**, not an automatic MongoDB import. Nothing in this change updates production, starts drops, publishes the image, or alters existing releases.

## Future integration

The bot can later use the `artworkId` to build an artist-credit display, a credits command, or a read-only credits index without repeating artist information on every egg. Until an explicit integration step is implemented, these records are preserved for editing and auditing in GitHub only.
