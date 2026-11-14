import test from "node:test";
import assert from "node:assert/strict";
import {
  ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder
} from "discord.js";
import {preferSetupButtons,preferSetupChoices,setupButtonStyle}
  from "../services/setup-button-preferences.js";

const button=(label,action,style=ButtonStyle.Secondary)=>
  new ButtonBuilder().setLabel(label).setCustomId("config:one:"+action).setStyle(style);
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const buttonRows=components=>components.filter(r=>
  r.components.every(c=>c instanceof ButtonBuilder));
const flat=components=>buttonRows(components).flatMap(r=>r.components.map(c=>c.toJSON()));

test("Keep Current comes first and is blue without losing any other actions",()=>{
  const components=[
    row(button("Enable","enable"),button("Disable","disable"),button("Keep Current","keep")),
    row(button("Back","back"),button("Cancel","cancel",ButtonStyle.Danger))
  ];
  preferSetupButtons(components);
  const buttons=flat(components);
  assert.deepEqual(buttons.map(c=>c.custom_id.split(":").at(-1)),
    ["keep","enable","disable","back","cancel"]);
  assert.equal(buttons[0].style,ButtonStyle.Primary);
  assert.equal(buttons[1].style,ButtonStyle.Secondary);
  assert.equal(buttons.at(-1).style,ButtonStyle.Danger);
});

test("Keep moves from an overflow row ahead of preset choices without exceeding five per row",()=>{
  const choices=Array.from({length:5},(_,i)=>button("Option "+i,"option"+i));
  const components=[row(...choices),row(button("10 rerolls","reroll10"),button("Keep","keep"))];
  preferSetupButtons(components);
  assert.deepEqual(components.map(r=>r.components.length),[5,2]);
  assert.equal(components[0].components[0].toJSON().label,"Keep");
  assert.deepEqual(flat(components).slice(1).map(x=>x.custom_id.split(":").at(-1)),
    ["option0","option1","option2","option3","option4","reroll10"]);
});

test("Default choices are blue, including server, built-in and no-default options",()=>{
  const components=[row(
    button("Keep Saved","keep"),
    button("Use Built-in Default","default"),
    button("Write Instructions","custom"),
    button("No Default Banner","clearBanner"),
    button("Post","post",ButtonStyle.Success),
  )];
  preferSetupButtons(components);
  const buttons=flat(components);
  assert.equal(buttons[0].style,ButtonStyle.Primary);
  assert.equal(buttons[1].style,ButtonStyle.Primary);
  assert.equal(buttons[2].style,ButtonStyle.Secondary);
  assert.equal(buttons[3].style,ButtonStyle.Primary);
  assert.equal(buttons[4].style,ButtonStyle.Success);
  assert.equal(setupButtonStyle("Use Server Default","claimDefault"),ButtonStyle.Primary);
});

test("Channel/role/dropdown select rows retain their position and choices",()=>{
  const select=row(new StringSelectMenuBuilder().setCustomId("config:select")
    .setPlaceholder("Choose a banner").addOptions([{label:"Rose",value:"rose"}]));
  const components=[select,row(button("Upload","upload"),button("Keep selected channel","keep"))];
  preferSetupButtons(components);
  assert.equal(components[0],select);
  assert.equal(select.components[0].toJSON().custom_id,"config:select");
  assert.equal(components[1].components[0].toJSON().label,"Keep selected channel");
  assert.equal(components[1].components[0].toJSON().style,ButtonStyle.Primary);
});

test("Plain choice lists also start with Keep and preserve the rest",()=>{
  const result=preferSetupChoices([
    ["Write","write"],["Use server default","claimDefault"],["Keep / Skip","keep"],
    ["Remove","remove"]]);
  assert.deepEqual(result.map(x=>x[1]),["keep","write","claimDefault","remove"]);
  assert.equal(setupButtonStyle(result[0][0],result[0][1]),ButtonStyle.Primary);
  assert.equal(setupButtonStyle(result[2][0],result[2][1]),ButtonStyle.Primary);
});
