# Adopt Me appearance shop — Replit/Discord test checklist

**Test only the `feature/profile-appearance-editor` branch with the test bot and test database. Do not run checkout/purchases against production.**

Before testing, stop the Replit bot, `git pull --ff-only origin feature/profile-appearance-editor`, then `npm install`, `npm test`, and Run. Give a *test member* enough Points to buy a few designs. Have a second test member with no purchases to verify locked controls. Record any failing test's Discord screenshot and Replit console error.

## A. Startup, permanent storefront, and DMs
- [ ] Bot starts without a missing-module, missing-font, or canvas exception.
- [ ] The six storefront categories appear: Backgrounds, Panels, Frames, Fonts, Text Colors, Stickers.
- [ ] Each **View All** button opens the correct category in the member's **one permanent shop DM**.
- [ ] Reopen the shop: the same permanent DM is reused; no duplicate shop messages.
- [ ] **Previous**, **Next**, category dropdown and **Refresh Points & Items** work at first and last pages.
- [ ] Public featured cards look correct; frames, backgrounds, and panels display as before.
- [ ] A nonmember cannot use another server's shop; members cannot spend another member's Points.
- [ ] /shop balance reflects purchases, and a purchase receipt is sent once.

## A1. Classic shared category showcases (one sheet per category)
- [ ] The public shop still has **six separate category messages**.
- [ ] Each category displays one **large Classic Collection** sheet instead of multiple classic featured cards.
- [ ] Backgrounds and Panels reuse their original 27-shade charts.
- [ ] Frames displays **six enlarged top-left frame corners only**, with slight overlap against a **plain white background**; full profiles and tiny cards do not appear.
- [ ] Fonts shows all six font samples on one image; lettering appears visually distinct.
- [ ] Stickers shows one gallery of currently available stickers, not per-sticker profile example cards.
- [ ] Text Colors sheet shows only Default, Black, White and a Custom HEX callout; **no Plum** in shop, index, sheet, or new editor selections.
- [ ] The same shared image appears inside the permanent DM's category index above the dropdown.
- [ ] Classic item detail and confirmation screens stay image-light; **My Preview** still shows your own profile.
- [ ] **Preview Multiple** works as before, and the category buttons/All Items navigation still work.
- [ ] A future nonclassic background or panel remains independently selectable and may have its own preview.
- [ ] Switching `STICKER_SEASONS_OVERRIDE` regenerates the seasonal sticker gallery without removing owned stickers.

## A2. Fast category index and direct jump navigation
- [ ] First opening of **every category** shows an item index with names, prices, and owned statuses **rather than immediately loading a large preview image**.
- [ ] The dropdown opens a chosen item directly (try the very last listed font, frame, and sticker).
- [ ] Backgrounds and Panels each list **nine color families + Custom HEX** (10 choices), not 27 individual shade entries.
- [ ] The original **Classic Color Collection** swatch chart appears under the Backgrounds and Panels index, labeled Pastel/Normal/Dark with all 27 shades (including the free gray panel shade).
- [ ] Choose Classic Yellow/Gray (and another family) directly from the index dropdown; it opens the matching **Normal** item. Then test Pastel, Normal and Dark buttons for the exact price, ownership and purchase.
- [ ] The Backgrounds/Panels index requires no second page; larger *other* categories still paginate normally.
- [ ] Previously posted dropdowns with specific color shade IDs still open the exact item instead of charging for a different shade.
- [ ] The index never shows more than 25 dropdown options or five Discord action rows.
- [ ] **All Items** on a detail page returns to the index without having to click Previous repeatedly.
- [ ] **All Categories** button is visible on indexes and detailed item/preview/confirmation screens; it opens a home with all six categories.
- [ ] All six category buttons on that home open the correct item index and do not create additional shop DMs.
- [ ] The category dropdown reads **Switch Category · viewing …**, rather than looking like a static Stickers label; it also changes categories.
- [ ] **Preview Multiple** from All Categories and then **Back to Shop** returns to All Categories.
- [ ] Frames, Fonts, Text Colors and Stickers detail pages have **Jump directly to another item** dropdowns.
- [ ] Background and Panel detail pages retain the existing family and Pastel/Normal/Dark selection controls.
- [ ] Switching the category dropdown opens that new category's index, not its first item preview.
- [ ] **Refresh Index & Points** stays on the index and updates your balance/owned statuses.
- [ ] From the index open **Preview Multiple** and click **Back to Shop**; it returns to the index. From an item detail, Back returns to that item.
- [ ] Old category/shop DM remains the only permanent message; no duplicate shop DMs or broken stale purchase buttons.
- [ ] Index page selection is noticeably quicker than stepping through full profile images. A selected item's full preview can still take longer, as it renders a PNG.

## B. Wallets and transactional purchases — all categories
- [ ] Buy an ordinary background or panel; Points decrease by its listed price **once**, and the item becomes Owned.
- [ ] Buy a frame, font, custom HEX text color, and sticker in separate transactions; each becomes owned, with matching wallet deductions.
- [ ] Attempt to buy with insufficient Points; purchase is blocked and inventory unchanged.
- [ ] Revisit an owned item; the Buy button says **Owned** and cannot charge again.
- [ ] Double-click Confirm / use old Confirm message; no second purchase and no second charge.
- [ ] Cancel an unconfirmed purchase; balance and inventory unchanged.
- [ ] Restart Replit; bought items, shop DM, pending profile drafts, and Points are still correct.
- [ ] Invalid/stale purchase buttons show an error instead of debiting a different item.

## C. Custom HEX colors (backgrounds, panels, text)
- [ ] Backgrounds > Custom HEX: enter `#A1B2C3`, preview on your own profile; **225 Points** to buy.
- [ ] Panels > Custom HEX: enter `#DCA4F0`, preview; **150 Points** to buy.
- [ ] Text Colors > Custom HEX: enter `#0033BB`, preview title, labels, body and status; **100 Points** to buy.
- [ ] Enter a six-digit HEX without `#` or in lowercase: it normalizes correctly.
- [ ] Enter invalid HEX (`#12345`, `#GGHHJJ`): private error, no charge.
- [ ] Choose a HEX, click **Change HEX Code**: new value is shown before confirming.
- [ ] Cancel/reopen the HEX purchase: nothing was accidentally purchased.
- [ ] Buy exactly one HEX and try buying the same code again: second charge is blocked for that category.
- [ ] The same HEX in two categories requires separate purchases; owning a background doesn't unlock text.
- [ ] Purchased custom colors appear in the **owned-only Customize Profile** dropdown and in live Preview Multiple.
- [ ] Multiple custom colors stay owned after bot restart and are all selectable.
- [ ] Test dark background, light panel and very bright text HEX: manually check readability.

## D. Frames and fonts
- [ ] Classic Thin frame is free; Double Line and Soft Rounded are **125 Points**, other three premium frames **300 Points**.
- [ ] Equip different frames; their border artwork is visible and doesn't cover the profile's main text.
- [ ] All paid fonts appear at correct prices: Nunito 125, Silkscreen 175, Caveat 250, Cinzel 300, **Bold Dancing Script 600**.
- [ ] Standard Clean is free. Any previously owned Classic Serif is still available.
- [ ] Font selected for **Headers Only** changes the title and section headings without changing body text.
- [ ] Font selected for **Profile Text Only** changes usernames, bio, roles, footer without changing headings.
- [ ] **Apply Heading Font to Both** sets both font slots without purchasing twice.
- [ ] Preview Multiple can try a different paid font in each slot *before purchasing*.
- [ ] After purchasing one font it can be equipped in either slot for free, including after restart.
- [ ] Large titles and long usernames shrink or truncate safely; fancy fonts don't break the layout.

## E. Sticker storefront: prices and seasonal rotation
- [ ] Standard stickers: Heart 50, Star 50, Crescent 50, Sparkle 50, **Daisy 75**.
- [ ] October/Halloween stickers: **Spooky Bat 50**, **Little Ghost 75**, **Pumpkin Patch 75**.
- [ ] Flower previously owned before this update now displays as **Daisy** and remains owned (ID `flower`).
- [ ] View each sticker's shop preview; shapes are recognizable on 1200×800 profile cards.
- [ ] Buy a sticker: Points deducted once and permanent ownership granted.
- [ ] Reopening its page says Owned and cannot charge again.
- [ ] **Season test:** stop the bot, set Replit environment variable `STICKER_SEASONS_OVERRIDE=off`, restart. Halloween stickers vanish from new sale, but all five standard designs remain.
- [ ] During `off`, previously bought Halloween stickers remain on published profiles and appear in owned Customize Profile and Preview Multiple.
- [ ] While `off`, a new account cannot purchase the Halloween stickers (even using an older Confirm button).
- [ ] Set `STICKER_SEASONS_OVERRIDE=halloween`, restart: all three Halloween items return, with their original prices and ownership.
- [ ] **IMPORTANT:** unset `STICKER_SEASONS_OVERRIDE` after the season test. By default Halloween sells **October 1–31, America/New_York**, and hides from sale starting November 1.

## F. Sticker customization (buy once, unlimited free recoloring)
- [ ] A member with no sticker purchases sees **no locked designs** in Customize Profile; they can use the Shop to unlock one.
- [ ] Buying Heart makes **Place Heart** available in Customize Profile, including after restart.
- [ ] Place Heart, choose **Sticker HEX Color**, enter `#D977A6`; preview updates, **no Points** deducted.
- [ ] Daisy: **Main & Accent HEX** lets member separately choose petals (`#D977A6`) and center (`#EEC52E`).
- [ ] Pumpkin Patch: main pumpkin and accent stem/leaf recolor separately.
- [ ] Little Ghost: main body and accent face/eyes recolor separately.
- [ ] Star, Heart, Crescent, Sparkle and Spooky Bat have **one** color field, not an unnecessary accent field.
- [ ] Invalid HEX in the sticker modal is rejected and draft retains previous colors.
- [ ] **Outline** cycles Auto → Black → White → None → Auto; preview changes without charging.
- [ ] **Reset Colors** restores only selected sticker colors/outline, retaining position and size.
- [ ] **Position & Size** shows Left, Right, Up, Down, Smaller, Larger, Rotate Left and Rotate Right **buttons**, not a dropdown that overlays the preview.
- [ ] Clicking any positioning button immediately updates the preview; repeating it works without reopening a menu.
- [ ] **Colors & Style** changes controls without re-rendering the unchanged PNG; the preview stays visible.
- [ ] In Colors & Style, choose Main/Accent HEX, cycle outline, reset colors and remove the selected sticker.
- [ ] **← Position & Size** restores movement and size controls, keeping the same selected sticker.
- [ ] Position/Style mode survives another sticker selection and restarting the test bot while the draft is open.
- [ ] Move left/right/up/down, rotate both ways, resize up/down and remove stickers; preview updates.
- [ ] Add the same unlocked sticker **twice**, recolor each copy differently; both stay independent.
- [ ] Fill all **8** slots; additional placement is unavailable. Remove one; placement becomes possible.
- [ ] Open temporary editor, recolor, **Discard Changes**: published card is unchanged.
- [ ] Open again, recolor, **Confirm & update profile**: public card updates; changes persist through restart.
- [ ] Stickers sit below the selected frame overlay; stickers don't overwrite shop/item buttons (these are Discord components, not image layers).
- [ ] Seasonal sticker that is already owned remains recolorable even when its sale window is closed.

## G. Preview Multiple, no-purchase preview
- [ ] Preview Multiple opens on the existing private shop message, **not** a second permanent DM.
- [ ] Change background, panel, frame, header font, body font, text HEX and sticker in the preview.
- [ ] The preview updates without deducting Points or adding items to ownership.
- [ ] **Use My Profile**, **Clear All Choices**, **Back to Shop** restore/change the expected state.
- [ ] Choose a locked sticker in Preview Multiple: it is only a temporary preview, never equipped.
- [ ] After purchasing a sticker, the shop and profile editor reflect ownership immediately.
- [ ] Custom HEX choices and purchased retired/seasonal options persist correctly through restart.
- [ ] Changing any one category doesn't erase another category's temporary try-on.

## H. Editor safety and regressions
- [ ] Only the owner can interact with the temporary profile editor.
- [ ] Another account cannot submit or confirm that user's sticker HEX modal.
- [ ] A stale, closed or expired editor modal cannot change a published profile.
- [ ] Preview editing is not a purchase; profile Confirm saves appearance but does not charge Points.
- [ ] Existing profiles with older Star/Flower stickers render correctly and receive default recoloring options.
- [ ] Previously owned retired frame and Classic Serif still render and stay selectable.
- [ ] Decorative text and profile photos still render correctly alongside multiple stickers.
- [ ] Profile messages and shop messages retain working Discord buttons after bot restarts.
- [ ] All PNGs render without "Cannot send an empty message", missing-font, or Canvas exceptions.

## When a check fails
Write down: **section/checkbox**, **test account**, **the exact button sequence**, **expected versus actual result**, **Replit console error**, and a **Discord screenshot**. Avoid publishing test members' private data or tokens.

Run `npm test` after making future changes to sticker shapes or seasonal windows. The automated tests validate the catalog, HEX normalization, ownership isolation, seasonal filtering and whether all eight shapes draw with their selected colors.

## J. Retired test color compatibility
- [ ] Plum cannot be bought in the shop or selected from the current Customize Profile text-color list.
- [ ] Any existing saved profile using Plum still renders without error until its owner selects another color.
