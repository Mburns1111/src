# Shop presentation rule — October 2026

> **Classic shop categories** use one category showcase image and a direct item index.  
> Complex or premium items may use different preview and layout rules later.

The store **remains divided into Backgrounds, Panels, Frames, Fonts, Text Colors and Stickers**. A classic collection is a presentation group *within* a shop category, not a replacement for the categories.

## Current classic category sheets

| Shop category | One shared reference image |
| --- | --- |
| Backgrounds | Existing Classic Color Collection chart: nine families × Pastel / Normal / Dark |
| Panels | Existing Classic Color Collection chart, including the included gray panel |
| Frames | All six classic frames shown as enlarged **top-left corner crops**, with their real decorative frame artwork slightly overlapping on a plain white sheet |
| Fonts | All six available fonts together, with a title and a body text sample |
| Text Colors | Default, Black and White shown together, with Custom HEX called out; test-only Plum is retired from the storefront |
| Stickers | Available classic sticker artwork in a single gallery; the seasonal offer window still applies |

The same sheet is shown on the category's **public storefront post** and in its **private item index**. Each private index retains its direct selection dropdown and purchase/ownership information. The one permanent shop DM is reused as before.

Classic item detail and confirmation pages are intentionally text-first and do not regenerate an individual example image on every navigation. **My Preview** remains available to see a selected item on the member's own profile; **Preview Multiple** remains available for experimenting with combinations.

## Room for future complex items

The explicit, immutable classic ID sets live in `services/shop-presentation.js`. Today's IDs are included deliberately; newly added catalog IDs are **not** automatically treated as classics.

* Classic items use the shared category sheet.
* Future premium/complex items may display standalone imagery in the **same category's storefront post** and individual detail view.
* A future background/panel that is not part of the nine classic color families still appears in the dropdown, as its own choice.
* Custom HEX purchases are form-driven and are not misrepresented as a fixed showcase item.
* The configuration changes presentation only: item IDs, prices, purchases, inventory, seasonal ownership and profile appearance data are unchanged.

See `services/shop-showcase-sheets.js` for the one-sheet renderers and `commands/shop.js` for storefront, index, detail and confirmation routing.

## October 24 showcase refinement

The Frames classic image no longer shrinks six full profile cards. It enlarges **only the top-left corner of each frame** on a plain white background with a little overlap. The Standard frame corner uses the regular renderer's border geometry; decorative frames use the approved transparent SVG artwork, so no profile/avatar obscures the artwork.

**Plum text was a test-only item and is no longer offered or selectable in the current shop/editor.** Its original appearance definition remains for safe rendering of old saved profiles; no ownership or appearance migration takes place.

## Preview Multiple purchase summary

The live preview shows an itemized **Purchase All** total. Only explicitly selected, not-yet-owned sale items count; included/free items and already-owned items cost 0. Fonts chosen for both headings and body are deduplicated by their stable font ID, while two different fonts are separate purchases. Matching panels and `No Stickers` are preview operations, not products.

**Purchase All** requires an explicit confirmation. It rechecks the member's exact selection, product availability (including seasonal stickers), ownership, prices and wallet balance, and grants all paid items in one MongoDB transaction. It **does not equip** them; members can equip purchased designs in Customize Profile. Cancelling or editing the preview never charges Points. Custom HEX shades must first be purchased by the normal HEX purchase flow; already-owned custom colors can be included free in a preview.

## Classic panel matching — entitlement rule

**Owning a Classic background lets you choose Match background for the panels at no extra cost.** This is a *dynamic display mode*, stored as `panelColor: "match"`; it follows whatever owned background the member currently equips. It does **not** grant a separate purchased panel color.

To keep a particular Classic panel shade when switching to a different background, the member must separately own that **panel** item (the same color name is not interchangeable between `backgrounds` and `panels`). An unowned explicit panel ID is rejected or reset to the free default panel when the appearance is filtered before saving/rendering.

Preview Multiple allows trying combinations without ownership; Purchase All counts a separately selected locked panel at its own price. The `match` mode has **zero** additional price, and buying a background never writes a matching panel ID to inventory. Regression coverage: `tests/shop-panel-matching.test.js`.

## Selected-item thumbnail and optional Equip All

The shared **Classic category showcase** remains unchanged. When a member picks a Classic item from the index, their item detail and **Confirm Purchase** page show one **small, item-specific image**: a color swatch, an enlarged frame corner, a legible font example, or a sticker example. **My Preview** and **Preview Multiple** remain full personalized profiles.

On successful **Purchase All**, the same permanent shop DM displays a final choice: **Equip All** or **Continue Shopping**. Purchase remains an all-or-nothing wallet/inventory transaction. The exact purchased preview selection is recorded for optional equipping. **Equip All** checks that all selected items are owned, overlays the chosen combination onto the member's current saved appearance (retaining unselected categories), saves it, and refreshes the public profile card. Continue Shopping never changes their saved appearance. No second charge is made when equipping; a failed public-card refresh leaves the purchased snapshot available for retry.
