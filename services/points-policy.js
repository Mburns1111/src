// Point values are stored per guild in PointsSettings and may be changed by
// managers. These defaults apply only when no override exists.
export const POINTS_MILESTONES = Object.freeze({
  shopFirstBrowse: { label: "First shop visit", points: 15 },
  profileFirstCustomization: { label: "First appearance customization", points: 40 },
  houseFirstListing: { label: "First published house listing", points: 20 },
  outfitFirstListing: { label: "First published outfit listing", points: 20 },
  tradeFirstListing: { label: "First published trade vote", points: 20 },
  tradingPostFirstPublished: { label: "First published Trading Post", points: 20 },
  inventoryFirstPost: { label: "First inventory photo or video post", points: 20 },
});

import { shopItems } from "./shop-catalog.js";
import { isClassicShopItem } from "./shop-presentation.js";

export function starterClassicBasket() {
  const categories = ["backgrounds", "panels", "frames", "fonts", "stickers"];
  const items = shopItems();
  return categories.map(category => {
    const cheapest = items.filter(item => item.category === category &&
      item.price > 0 && isClassicShopItem(category, item.id))
      .sort((a, b) => a.price - b.price)[0];
    if (!cheapest) throw new Error(`No paid Classic ${category} item found`);
    return { category, id: cheapest.id, price: cheapest.price, name: cheapest.name };
  });
}

export function starterClassicBasketCost() {
  return starterClassicBasket().reduce((sum, item) => sum + item.price, 0);
}

// Activity earns without an overall cap. Starter shop item costs are
// benchmarks for pacing, never ceilings on what members can earn.
// First seven days after joining: 2× eligible messages and voice rewards.
// Invite rewards are planned but not yet enabled.
export const POINTS_ACTIVITY_TARGETS = Object.freeze({
  firstWeekActivityMultiplier: 2,
  invitationReward: 40,
  inviteMinimumMembershipDays: 7,
  rewardedInvitesPerCalendarMonth: 2,
});

export function milestoneAwardAmount(settings, milestone) {
  const definition = POINTS_MILESTONES[milestone];
  if (!definition) throw new Error(`Unknown Points milestone: ${milestone}`);
  const custom = settings?.milestoneAmounts?.[milestone];
  return Number.isSafeInteger(custom) && custom >= 0 && custom <= 500
    ? custom : definition.points;
}
