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
