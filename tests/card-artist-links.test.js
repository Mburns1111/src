import test from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle } from "discord.js";
import {
  validCardArtistUrl, cardArtistDestination, artistLinkButton,
  cardArtistLinkRow, dropArtistLinkRow, preservedArtistLinkRows,
} from "../services/card-artist-links.js";

const jovy = {
  petArtworkKey: "s1-r1-pet-lamb-v1", artistCredit: "jovyisweird",
  artistUrl: "https://www.reddit.com/user/InformalPrinciple834/",
};
const arial = {
  petArtworkKey: "s1-r1-pet-unicorn-v1", artistCredit: "αriαℓ",
  artistUrl: "https://www.reddit.com/user/softlambkin/",
};

test("trusted HTTPS source links turn into Discord Link buttons", () => {
  const d = cardArtistDestination(jovy);
  assert.equal(d.credit, "jovyisweird");
  assert.equal(d.isOriginal, false);
  const row = cardArtistLinkRow(d).toJSON();
  assert.equal(row.components.length, 1);
  assert.equal(row.components[0].style, ButtonStyle.Link);
  assert.equal(row.components[0].label, "Visit Artist");
  assert.equal(row.components[0].url, jovy.artistUrl);
  assert.equal(row.components[0].custom_id, undefined);
});

test("original artwork link takes precedence over artist profile", () => {
  const src = "https://www.reddit.com/r/AdoptMeRBX/comments/example/original/";
  const d = cardArtistDestination(jovy, { sourceUrl: src });
  assert.deepEqual({ url:d.url, isOriginal:d.isOriginal }, {url:src,isOriginal:true});
  const button = artistLinkButton(d).toJSON();
  assert.equal(button.label, "View Original Art");
});

test("source links never guess destinations or accept non-HTTPS schemes", () => {
  for (const text of [
    "javascript:alert(1)", "http://reddit.com/u/example", "https://evil.com@reddit.com/foo",
    "https://localhost", "ftp://reddit.com/u/example", "https://reddit.com:444/a",
    "https://reddit.com/<@everyone>", "",
  ]) assert.equal(validCardArtistUrl(text), "", text);
  assert.equal(cardArtistDestination({artistCredit:"Unknown"}), null);
  assert.equal(dropArtistLinkRow([null,null,null]), null);
});

test("three-slot drops provide a readable link per attributed card", () => {
  const links = [cardArtistDestination(jovy), cardArtistDestination(arial), null];
  const buttonRow = dropArtistLinkRow(links);
  const row = buttonRow.toJSON();
  assert.equal(row.components.length, 2);
  assert.deepEqual(row.components.map(c => c.label), ["Artist #1", "Artist #2"]);
  assert.ok(row.components.every(c => c.style === ButtonStyle.Link));
  // Grab buttons should be removed after expiry without removing attribution.
  const display = {components:[{components:[{style:ButtonStyle.Primary}]}, buttonRow]};
  assert.deepEqual(preservedArtistLinkRows(display), [buttonRow]);
});
