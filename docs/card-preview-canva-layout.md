# Single-card collectible preview — Canva template v1

## Bot test
1. Pull `feature/card-game-foundation` on the **development** bot.
2. Run `npm test` and `node register-commands.js` (new `/cards preview` slash command).
3. Start the development bot with `ENABLE_CARD_GAME_TEST=1`.
4. In your test server use `/cards preview` for the latest collected card or `/cards preview card_id:A7_kQ` using a real ID from your collection.
5. A portrait PNG should be returned privately. Only owned cards are previewable; preview does not alter inventory.

## Preview design
- Output: 900 × 1260 pixels (5:7 portrait).
- Safe border: 51 pixels from each edge.
- Pet name: top centered, baseline 148.
- Rarity: baseline 206.
- Art viewport: x=83, y=242, width=734, height=748. Crop-to-cover artwork.
- Upgrade label: centered below image, near y=1049.
- Series/release: lower left, y=1120.
- Artist credit: lower left, y=1167. It shows `Art credit: pending` until metadata is entered.
- Unique five-character public card ID: lower right, y=1167.
- Stage effects: Normal has a subtle rarity-colored frame; Neon adds mint/cyan glow; Mega Neon adds pastel rainbow-like treatment.
- Fallback: a clearly labeled generic placeholder graphic, not copyrighted Adopt Me pet artwork.

## Artwork workflow
Canva is for designing transparent background/frame/glow asset layers. The bot draws data fields at runtime from CardCopy, CardDefinition, CardRelease, CardSeries and PetCatalog. Export exact 900×1260 PNG assets, with frame overlay transparent and title/ID/credit areas left open.

The **Release 1 egg banner is a separate asset**, never placed on the collectible card. It belongs above the future three-card drop image. No egg-source attribution claims are made by this preview.

This v1 renderer currently draws its own frame; Canva file injection, alternate Neon/Mega artwork selection, and three-card composite are future work.
