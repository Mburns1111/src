import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import CardArtwork from "../models/CardArtwork.js";

// Only use explicit, safe HTTPS destinations recorded for the artwork.
// Never turn artist names or unsourced artwork into guessed clickable URLs.
export function validCardArtistUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 1800 || /[\u0000-\u001f\u007f<>]/.test(text)) return "";
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" || !parsed.hostname.includes(".") ||
        parsed.username || parsed.password || parsed.port) return "";
    return parsed.href;
  } catch { return ""; }
}

export function cardArtistDestination(definition, artwork = null) {
  if (!definition) return null;
  const original = validCardArtistUrl(definition.artSourceUrl || artwork?.sourceUrl);
  const profile = validCardArtistUrl(definition.artistUrl) ||
    validCardArtistUrl(artwork?.artistUrl);
  const url = original || profile;
  if (!url) return null;
  const credit = String(definition.artistCredit || artwork?.artistCredit || "").trim().slice(0, 80);
  return { url, credit, isOriginal: Boolean(original) };
}

export async function cardArtistDestinations(definitions) {
  if (!Array.isArray(definitions) || !definitions.length) return [];
  const keys = [...new Set(definitions.map(def => def?.petArtworkKey).filter(Boolean))];
  const artworks = keys.length ? await CardArtwork.find({
    key: { $in: keys }, kind: "pet",
  }).select("key artistCredit artistUrl sourceUrl").lean() : [];
  const byKey = new Map(artworks.map(item => [item.key, item]));
  return definitions.map(def => cardArtistDestination(def, byKey.get(def?.petArtworkKey)));
}

export function artistLinkButton(destination, { index = null } = {}) {
  if (!destination?.url) return null;
  const label = index === null
    ? destination.isOriginal ? "View Original Art" : "Visit Artist"
    : destination.isOriginal ? "Original Art #" + (index + 1) : "Artist #" + (index + 1);
  return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(destination.url);
}

export function cardArtistLinkRow(destination) {
  const button = artistLinkButton(destination);
  return button ? new ActionRowBuilder().addComponents(button) : null;
}

// Three-card drop: one link per slot. Grab controls occupy their own row.
export function dropArtistLinkRow(destinations) {
  const buttons = (destinations || []).map((value, index) =>
    artistLinkButton(value, { index })).filter(Boolean);
  return buttons.length ? new ActionRowBuilder().addComponents(buttons) : null;
}

// Keep attribution buttons on a drop after it closes or a grab updates it.
export function preservedArtistLinkRows(message) {
  return (message?.components || []).filter(row =>
    row.components?.length && row.components.every(button => button.style === ButtonStyle.Link));
}
