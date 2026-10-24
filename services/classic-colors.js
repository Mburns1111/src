// The approved Classic collection, ordered around the color spectrum.
// Each original Normal swatch is paired with the approved Pastel and Dark
// variants. One item per color/variant appears in Backgrounds and Panels.
export const CLASSIC_COLOR_FAMILIES = Object.freeze([
  { id: "yellow", name: "Classic Yellow", pastel: "#F8EFC3", normal: "#EBD56A", dark: "#78601F" },
  { id: "orange", name: "Classic Orange", pastel: "#F6D6AE", normal: "#EA9D52", dark: "#80411E" },
  { id: "coral", name: "Soft Coral", pastel: "#E4BEBA", normal: "#CC827A", dark: "#773C2D" },
  { id: "rose", name: "Dusty Rose", pastel: "#E7B8C3", normal: "#D15E72", dark: "#692831" },
  { id: "orchid", name: "Orchid", pastel: "#E4BAE0", normal: "#CC7AC4", dark: "#563352" },
  { id: "lavender", name: "Lavender", pastel: "#E1D5F2", normal: "#C5AFE6", dark: "#534A61" },
  { id: "aqua", name: "Aqua", pastel: "#BAE0E4", normal: "#7AC4CC", dark: "#335256" },
  { id: "leafGreen", name: "Leaf Green", pastel: "#BAE4BE", normal: "#7ACC82", dark: "#335637" },
  { id: "gray", name: "Classic Gray", pastel: "#E5E5E5", normal: "#939393", dark: "#252525" },
]);

// Original free Starter Sage remains an approved appearance but NOT a shop item.
export const STANDARD_BACKGROUND_ID = "sagePreview";
export const STANDARD_PANEL_ID = "grayNormal";
export const STANDARD_PANEL_OPACITY = 0.9;

export const CLASSIC_COLOR_OPTIONS = Object.freeze(
  CLASSIC_COLOR_FAMILIES.flatMap(family => [
    { id: `${family.id}Pastel`, name: `${family.name} · Pastel`, hex: family.pastel, dark: false, variant: "pastel" },
    { id: `${family.id}Normal`, name: `${family.name} · Normal`, hex: family.normal, dark: false, variant: "normal" },
    { id: `${family.id}Dark`, name: `${family.name} · Dark`, hex: family.dark, dark: true, variant: "dark" },
  ]),
);

// Starter Sage (sagePreview) is free and separate from this collection.
// Every Classic background, including Pastel Leaf Green, costs 75 Points.
export const CLASSIC_BACKGROUND_PRICES = Object.freeze(
  Object.fromEntries(CLASSIC_COLOR_OPTIONS.map(item => [item.id, 75])),
);
export const CLASSIC_PANEL_PRICES = Object.freeze(
  Object.fromEntries(CLASSIC_COLOR_OPTIONS.map(item => [
    item.id, item.id === STANDARD_PANEL_ID ? 0 : item.dark ? 60 : 50,
  ])),
);
