# AM Isa — Card and egg artwork credits

Artwork sources are kept **separate from the factual pet catalogue** in `data/card-artwork-catalog.json`. This prevents pet-name/rarity references from being confused with permission to use art.

## Two linked lists

- `artists`: one profile per artist, including display name, platform, and profile link. Reuse the same `artistId` if that artist supplies several images.
- `artworks`: one record per image or distinct artwork edition. Store its `artworkId`, its artist ID(s), source, original source item ID/page, attribution, intended use, local/hosted file, license review, and associated release IDs.

For egg releases, `CardRelease.eggArtworkId` optionally references the artwork's `artworkId`. `eggImageUrl` remains the image location used by the existing code. The credit link is **metadata only**; it does not upload, render, approve or import artwork. Until a release is identified, leave `releaseIds` empty and the release's `eggArtworkId` blank.

## First entry — Egg Drop Image

- **Artwork ID:** `egg-drop-001`
- **Artist:** stux (`pixabay-stux`)
- **Artist profile:** https://pixabay.com/users/stux-12364/
- **Source:** Pixabay — content ID `1255730`
- **Attribution:** Image by stux from Pixabay
- **Provided attribution URL:** https://pixabay.com//?utm_source=link-attribution&utm_medium=referral&utm_campaign=image&utm_content=1255730
- **Current rights status:** `needs-review`
- **Release:** Not linked yet
- **Artwork file:** Not supplied yet

The source HTML attribution is recorded, but it is **not** itself a grant of every required usage permission. Check the original item, its publication date, applicable Pixabay terms (https://pixabay.com/service/terms/), and any separate third-party rights before marking artwork ready for public use.

## Adding images in the future

1. Create or reuse an artist entry (`artistId`, name, profile URL).
2. Add an artwork entry with a unique `artworkId`. For your own artwork, mark yourself as the creator and record any external source materials separately when applicable.
3. Record the **original image URL or platform item ID**, not just the platform homepage, plus the file path/hosted URL of the version actually used.
4. Preserve the provided attribution wording and license/permission evidence. Leave `reviewStatus` at `needs-review` until checked; a credit does not automatically mean permission.
5. When the egg/release is known, add its release ID to the artwork's `releaseIds` and set the matching `CardRelease.eggArtworkId` on that release record.

This catalog is a **Git-tracked source list**, not an automatic MongoDB import. Nothing in this change updates production, starts drops, publishes the image, or alters existing releases.

## Future integration

The bot can later use the `artworkId` to build an artist-credit display, a credits command, or a read-only credits index without repeating artist information on every egg. Until an explicit integration step is implemented, these records are preserved for editing and auditing in GitHub only.
