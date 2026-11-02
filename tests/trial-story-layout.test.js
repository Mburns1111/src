import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { registerAppearanceFonts } from "../services/font-library.js";
import { courtStoryText, wrapCourtStory } from "../services/trial-event-portraits.js";
import { SOLO_TRIAL_EVENTS, DUEL_TRIAL_EVENTS } from "../services/survival-event-texts.js";
import { HARVEST_SOLO_TRIAL_EVENTS, HARVEST_DUEL_TRIAL_EVENTS } from "../services/survival-harvest-event-texts.js";

test("all 220 expanded stories fit the portrait plaque with long contestant names", () => {
  registerAppearanceFonts();
  const ctx = createCanvas(1000, 720).getContext("2d");
  const groups = [SOLO_TRIAL_EVENTS, DUEL_TRIAL_EVENTS,
    HARVEST_SOLO_TRIAL_EVENTS, HARVEST_DUEL_TRIAL_EVENTS];
  const templates = groups.flat();
  assert.equal(templates.length, 220);
  assert.equal(new Set(templates).size, 220);
  const actorId = "345678901234567890", victimId = "234567890123456789";
  for (const [groupIndex, group] of groups.entries()) {
    for (const [index, template] of group.entries()) {
      const title = `catalog ${groupIndex}, story ${index + 1}`;
      assert.ok(template.includes("{victim}"), title);
      assert.equal(template.includes("{actor}"), groupIndex % 2 === 1, title);
      assert.deepEqual([...template.matchAll(/\{([^}]+)\}/g)].map(m => m[1])
        .filter(name => !["actor", "victim"].includes(name)), [], title);
      for (const name of ["Rose Courtier", "W".repeat(32)]) {
        const story = courtStoryText({ actorId, victimId,
          description: template.replaceAll("{actor}", `<@${actorId}>`)
            .replaceAll("{victim}", `<@${victimId}>`),
        }, { actor: { name }, victim: { name } });
        assert.doesNotMatch(story, /<@|\{(?:actor|victim)\}/, title);
        ctx.font = '18px "AM Nunito", sans-serif';
        const lines = wrapCourtStory(ctx, story, 842);
        assert.ok(lines.length <= 5, `${title}: text would be clipped`);
        assert.equal(lines.join(" "), story, `${title}: words must remain intact`);
        assert.ok(lines.every(line => ctx.measureText(line).width <= 842), title);
        assert.ok((lines.length - 1) * 23 + 18 <= 124,
          `${title}: story must stay above the survivor-count divider`);
      }
    }
  }
});
