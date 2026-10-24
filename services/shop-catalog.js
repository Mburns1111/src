import { APPEARANCE_CATALOG } from "./post-appearance.js";
import { FREE_APPEARANCE } from "./appearance-ownership.js";

// Temporary starter pricing; edit here when your final artwork and prices are ready.
const prices = {
  backgrounds: { paleSage: 75, warmCream: 75, dustyBlue: 75, sageDots: 150, garden: 300 },
  panels: {
    sagePanel: 50, creamPanel: 50, bluePanel: 50,
    charcoal: 60, forest: 60, navy: 60,
    moss: 100, lavender: 100,
  },
  frames: { doubleLine: 125 },
  fonts: { classic: 100 },
  fontColors: { plum: 75 },
  stickers: { flower: 50, star: 50 },
};
const names = {
  paleSage: "Pale Sage", warmCream: "Warm Cream", dustyBlue: "Dusty Blue",
  sagePanel: "Sage Panel", creamPanel: "Cream Panel", bluePanel: "Blue Panel",
  charcoal: "Charcoal", forest: "Forest", navy: "Navy",
  sageDots: "Sage Dots", garden: "Garden", moss: "Moss", lavender: "Lavender",
  doubleLine: "Double Line", classic: "Classic Serif", plum: "Plum",
  flower: "Flower", star: "Star",
};
export function shopItems() {
  return Object.entries(prices).flatMap(([category, entries]) =>
    Object.entries(entries)
      .filter(([id]) => APPEARANCE_CATALOG[category]?.[id] && !FREE_APPEARANCE[category]?.includes(id))
      .map(([id, price]) => ({ category, id, name: names[id] || id, price })),
  );
}
export function shopItem(category, id) {
  return shopItems().find(item => item.category === category && item.id === id);
}
