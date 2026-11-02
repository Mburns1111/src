// Original, family-friendly prompts. Keep game mechanics independent of prompt text.
export const COURT_PROMPTS = Object.freeze([
  ["silly", "What prize would make everyone wish they had left the mystery box unopened?"],
  ["silly", "What is the worst name for a brand-new pet?"],
  ["silly", "What's the first rule of a school run entirely by cats?"],
  ["silly", "What message would turn a birthday cake into a very confusing present?"],
  ["silly", "What is a terrible slogan for a theme park?"],
  ["silly", "What's a suspicious thing for a talking refrigerator to say?"],
  ["silly", "What would a ghost put on its shopping list?"],
  ["silly", "What would be the most awkward thing to bring to a royal banquet?"],
  ["silly", "What's a superhero's least helpful superpower?"],
  ["silly", "What does a dragon secretly keep under its bed?"],
  ["silly", "What would a penguin complain about at the beach?"],
  ["silly", "What is the worst possible name for a new planet?"],
  ["silly", "What would a robot call its pet human?"],
  ["silly", "What is the most ridiculous thing a dentist could say right before a checkup?"],
  ["silly", "What is the strangest thing a vending machine could sell?"],
  ["roblox", "What message would make an Adopt Me trade confusing in the funniest way?"],
  ["roblox", "What's a terrible name for a new Roblox game?"],
  ["roblox", "What would a Frost Dragon order at a restaurant?"],
  ["roblox", "What's the most suspicious thing to see in a pet nursery?"],
  ["roblox", "What would be the most surprising thing to hatch from an Adopt Me egg?"],
  ["roblox", "What's the worst thing to shout when someone offers you a pet?"],
  ["roblox", "What would an Adopt Me pet complain about in a very dramatic letter?"],
  ["roblox", "What's a ridiculous new job for your Roblox avatar?"],
  ["roblox", "Why did the unicorn get banned from the pet salon?"],
  ["roblox", "What's the funniest item to offer for a legendary pet?"],
  ["roblox", "What is the most useless potion in a pet shop?"],
  ["roblox", "What happens when a dragon tries to drive a tiny car?"],
  ["roblox", "What completely unhelpful tip would a mischievous player give a beginner?"],
  ["roblox", "What would a pet name its owner if it could choose?"],
  ["roblox", "What is the worst possible update announcement for a pet game?"],
  ["fantasy", "What spell would make a royal wedding unforgettable for all the wrong reasons?"],
  ["fantasy", "What's the silliest thing a wizard could turn into?"],
  ["fantasy", "What does a vampire really hate about Mondays?"],
  ["fantasy", "What strange reward would make an adventurer regret accepting a quest?"],
  ["fantasy", "What would a nervous knight blurt out to a dragon by mistake?"],
  ["fantasy", "What's a terrible name for a haunted castle?"],
  ["fantasy", "What would a goblin put on a fancy invitation?"],
  ["fantasy", "What does a unicorn do when nobody is watching?"],
  ["fantasy", "What unexpected ingredient would make a potion instantly suspicious?"],
  ["fantasy", "Why was the wizard fired from the magic school?"],
  ["fantasy", "What's a terrible password for a secret treasure room?"],
  ["fantasy", "What would a skeleton ask for at a birthday party?"],
  ["fantasy", "What's the least useful enchanted object?"],
  ["fantasy", "Why did the troll start a customer service hotline?"],
  ["fantasy", "What rule would the world's laziest king invent?"],
  ["silly", "What's the least useful thing to invent for a rainy day?"],
  ["silly", "What should a pirate never put on a treasure map?"],
  ["silly", "What ridiculous warning belongs on a loaf of bread?"],
  ["silly", "Why did a potato become famous overnight?"],
  ["silly", "What would a squirrel demand at a town meeting?"],
  ["silly", "What's the worst theme for a surprise party?"],
  ["silly", "What would you name a very tiny mountain?"],
  ["silly", "What's the worst thing to discover in your backpack?"],
  ["silly", "What would an alien misunderstand about Earth?"],
  ["silly", "What's the worst possible name for a fancy restaurant?"],
  ["silly", "What excuse would a sleepy cloud give for being late?"],
  ["silly", "What might a talking chair reveal about its owner?"],
  ["silly", "What's the silliest new holiday anyone could invent?"],
  ["silly", "What would a goldfish put in a secret diary?"],
  ["silly", "What's the least impressive world record?"],
  ["roblox", "What does a pet say after its owner changes its name for the tenth time?"],
  ["roblox", "What's the least useful feature for an Adopt Me house?"],
  ["roblox", "What is a terrible reason to cancel a pet trade?"],
  ["roblox", "What would a Roblox NPC do on its day off?"],
  ["roblox", "What's a strange item to find in the trading window?"],
  ["roblox", "What would a pet say if it could review its owner?"],
  ["roblox", "What's the funniest way to announce a legendary hatch?"],
  ["roblox", "What would an Adopt Me pet request for its birthday?"],
  ["roblox", "Why did the penguin leave the pet daycare?"],
  ["roblox", "What warning should appear before entering a friend's Roblox house?"],
  ["roblox", "What is the world's most inconvenient pet accessory?"],
  ["roblox", "What would you find inside the world's weirdest Roblox obby?"],
  ["roblox", "What's the worst thing a pet could learn to say?"],
  ["roblox", "What would an Adopt Me dragon do with a tiny allowance?"],
  ["roblox", "What should be the title of the next extremely unnecessary Roblox update?"],
  ["fantasy", "What strange thing does the castle's moat contain instead of water?"],
  ["fantasy", "What's the least convincing disguise for a giant monster?"],
  ["fantasy", "What does the royal jester keep in the emergency kit?"],
  ["fantasy", "What is a dragon's most embarrassing hobby?"],
  ["fantasy", "What did the witch accidentally turn the mayor into?"],
  ["fantasy", "What would you find in an unusually boring treasure chest?"],
  ["fantasy", "What would a fairy wish for if wishes were free?"],
  ["fantasy", "Why did the haunted mirror demand a vacation?"],
  ["fantasy", "What is the worst title for a spell book?"],
  ["fantasy", "What do two rival wizards argue about at breakfast?"],
  ["fantasy", "What would a goblin use as a royal crown?"],
  ["fantasy", "What's the most ridiculous law in a kingdom of frogs?"],
  ["fantasy", "Why was the royal dragon sent to detention?"],
  ["fantasy", "What would a mermaid find surprising about a swimming pool?"],
  ["fantasy", "What's a terrible place to hide a magical artifact?"],
  ["silly", "What would a cloud write in a one-star review of the sky?"],
  ["silly", "What job should a banana absolutely not be trusted to do?"],
  ["silly", "What would be the title of the world's shortest book?"],
  ["silly", "What excuse would a duck give for being late to work?"],
  ["silly", "What is the least helpful thing a map could say when you are lost?"],
  ["silly", "What would a dramatic spoon announce before entering a kitchen?"],
  ["silly", "What is a very silly thing to put in a time capsule?"],
  ["silly", "What would an umbrella ask for on its day off?"],
  ["silly", "What would be the strangest rule at a library for animals?"],
  ["silly", "What should a talking shoe put in its profile bio?"],
  ["silly", "What would a moon made of cheese complain about?"],
  ["silly", "What is the funniest possible name for a neighborhood of squirrels?"],
  ["silly", "What would a sleepy alarm clock say when you press snooze?"],
  ["silly", "What would be a terrible slogan for a store that sells only socks?"],
  ["silly", "What would a snowman pack for a trip to the desert?"],
  ["silly", "What message would make a fortune cookie completely unhelpful?"],
  ["silly", "What would a very confused mail carrier deliver to a lighthouse?"],
  ["silly", "What is something a magician should never pull from a hat?"],
  ["silly", "What would a frog ask for at a fancy restaurant?"],
  ["silly", "What would happen if every chair in town decided to go on vacation?"],
  ["silly", "What is the most ridiculous thing to name a boat?"],
  ["silly", "What would a houseplant say if it could leave a voice message?"],
  ["silly", "What is an odd thing for a museum to display as its most valuable item?"],
  ["silly", "What would a penguin bring to a job interview?"],
  ["silly", "What would be the worst flavor for toothpaste?"],
  ["silly", "What would a robot misunderstand about a picnic?"],
  ["silly", "What is a silly thing to put on a welcome sign for visitors from space?"],
  ["silly", "What would a very small dragon use as a blanket?"],
  ["silly", "What would a mailbox write in its diary after a busy day?"],
  ["silly", "What is the funniest thing to hear from a self-checkout machine?"],
  ["roblox", "What would an Adopt Me pet put on its wish list for a perfect day?"],
  ["roblox", "What would a pet say in a video tour of its new house?"],
  ["roblox", "What is the funniest name for a pet that thinks it is a superhero?"],
  ["roblox", "What would a bored Roblox NPC do after the game closes?"],
  ["roblox", "What tiny inconvenience could make a pet declare a dramatic emergency?"],
  ["roblox", "What would a Frost Dragon pack for a very ordinary school trip?"],
  ["roblox", "What would a pet put in a review of its owner's driving?"],
  ["roblox", "What would be a ridiculous name for a new Adopt Me vehicle?"],
  ["roblox", "What would a pet say after getting lost inside a giant house?"],
  ["roblox", "What is the silliest thing to find in a pet's backpack?"],
  ["roblox", "What would a Roblox avatar order at a restaurant for giants?"],
  ["roblox", "What would a pet nursery post as its most confusing house rule?"],
  ["roblox", "What would an egg say if it could leave a message before hatching?"],
  ["roblox", "What is the funniest reason for a pet to refuse a bath?"],
  ["roblox", "What would a legendary pet choose as its very ordinary day job?"],
  ["roblox", "What would an Adopt Me pet write on a tiny protest sign?"],
  ["roblox", "What would happen if every pet in the server switched owners for a day?"],
  ["roblox", "What would a pet say after winning a race by taking a nap at the finish line?"],
  ["roblox", "What is the strangest thing to see in a Roblox player's inventory?"],
  ["roblox", "What would be a terrible theme for a pet fashion show?"],
  ["roblox", "What would a pet name the world's most inconvenient stroller?"],
  ["roblox", "What would a Roblox avatar say after accidentally entering the wrong game?"],
  ["roblox", "What is a funny warning to put beside a very bouncy trampoline?"],
  ["roblox", "What would a pet's personal assistant be asked to do all day?"],
  ["roblox", "What would be the oddest item for a pet to trade for a snack?"],
  ["roblox", "What would a dragon do if it had to babysit a group of tiny chicks?"],
  ["roblox", "What message would a pet send after its owner decorates the house in one color?"],
  ["roblox", "What would a Roblox obby call its easiest level to sound impressive?"],
  ["roblox", "What would a pet say when asked to explain its very messy room?"],
  ["roblox", "What is the funniest thing to announce over the pet shop loudspeaker?"],
  ["fantasy", "What would a wizard put on a sign outside a very unreliable magic shop?"],
  ["fantasy", "What would a dragon request as a reasonable rent payment?"],
  ["fantasy", "What is the most unexpected thing for a phoenix to bring back from the ashes?"],
  ["fantasy", "What would a fairy godparent say after granting a very confusing wish?"],
  ["fantasy", "What would a goblin serve at a royal tea party?"],
  ["fantasy", "What would a cursed sword complain about after a long day?"],
  ["fantasy", "What is a silly thing for a wizard to keep in a magic hat?"],
  ["fantasy", "What would a mermaid bring to a sleepover on land?"],
  ["fantasy", "What would the royal announcement say if the king lost his crown again?"],
  ["fantasy", "What would a troll put on a sign to make a bridge sound welcoming?"],
  ["fantasy", "What is the strangest thing for a potion to do when shaken?"],
  ["fantasy", "What would a knight name a horse that refuses to gallop?"],
  ["fantasy", "What would a ghost say when someone walks through its favorite wall?"],
  ["fantasy", "What would a dragon write in a letter asking for a day off?"],
  ["fantasy", "What is the most inconvenient power for a magical ring to have?"],
  ["fantasy", "What would a wizard's familiar tell the class while the wizard is away?"],
  ["fantasy", "What would a kingdom's royal chef make for a dragon-sized picnic?"],
  ["fantasy", "What would an enchanted mirror say if it wanted to be left alone?"],
  ["fantasy", "What would a goblin use as a bookmark in a spell book?"],
  ["fantasy", "What would happen if a magic carpet got the hiccups?"],
  ["fantasy", "What is a ridiculous thing to find in a knight's emergency kit?"],
  ["fantasy", "What would a unicorn put in a job application?"],
  ["fantasy", "What would a sleepy vampire order at a morning café?"],
  ["fantasy", "What would a wizard name a spell that only tidies one sock?"],
  ["fantasy", "What would a castle's talking door ask before letting anyone in?"],
  ["fantasy", "What would a mermaid misunderstand about a snow day?"],
  ["fantasy", "What is the silliest thing for a kingdom to put in its royal treasure vault?"],
  ["fantasy", "What would a skeleton bring to a picnic that nobody else thought of?"],
  ["fantasy", "What would the royal jester say after accidentally becoming king for a day?"],
  ["fantasy", "What would a dragon name its tiny pet mouse?"],
].map(([category, text], index) => Object.freeze({ id: index + 1, category, text })));

export const COURT_ROUND_POINTS = Object.freeze([1000, 1500, 2000]);
// A host may start with any nonempty lobby; one player is a solo showcase.
export const COURT_MIN_PLAYERS = 1;
export const COURT_MAX_PLAYERS = 20;

// Each person gets two separate prompts per round, with a new opponent
// where the roster permits it. With one member, both prompts are solo.
export const COURT_MATCHUPS_PER_PLAYER = 2;

export function assignCourtMatchups(players, round, category = "mixed", usedIds = [], random = Math.random) {
  if (players.length < COURT_MIN_PLAYERS || players.length > COURT_MAX_PLAYERS || new Set(players).size !== players.length)
    throw new Error("Court of Chaos requires 1–20 distinct players.");
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const pool = COURT_PROMPTS.filter(p => category === "mixed" || p.category === category);
  // Prefer unused prompts, and never repeat a prompt within the same round.
  const alreadyUsed = new Set(usedIds);
  const usedThisRound = new Set();
  const matchups = [];
  for (let pass = 0; pass < COURT_MATCHUPS_PER_PLAYER; pass++) {
    const roster = pass === 0 ? shuffled : [
      ...shuffled.slice(1), shuffled[0],
    ];
    let offset = 0;
    const count = Math.max(1, Math.floor(roster.length / 2));
    for (let i = 0; i < count; i++) {
      const size = roster.length === 1 ? 1 :
        (roster.length % 2 === 1 && i === count - 1 ? 3 : 2);
      const playerIds = roster.slice(offset, offset + size);
      offset += size;
      const notShown = pool.filter(p => !usedThisRound.has(p.id));
      const fresh = notShown.filter(p => !alreadyUsed.has(p.id));
      const choices = fresh.length ? fresh : notShown;
      if (!choices.length) throw new Error("Not enough unique Court of Chaos prompts for this round.");
      const prompt = choices[Math.floor(random() * choices.length)];
      usedThisRound.add(prompt.id);
      matchups.push({ playerIds, promptId: prompt.id, prompt: prompt.text });
    }
  }
  return matchups;
}

export function scoreCourtMatchup(playerIds, answers, votes, round) {
  const present = playerIds.filter(id => answers.some(a => a.userId === id && a.text?.trim()));
  const maxPoints = COURT_ROUND_POINTS[round - 1] || 0;
  const totals = Object.fromEntries(playerIds.map(id => [id, 0]));
  if (present.length < 2 || !maxPoints) return totals;
  const eligibleVotes = votes.filter(v => present.includes(v.targetId) && !playerIds.includes(v.userId || v.voterId));
  if (!eligibleVotes.length) {
    const split = Math.floor(maxPoints / present.length);
    for (const id of present) totals[id] = split;
    return totals;
  }
  const counts = Object.fromEntries(present.map(id => [id, 0]));
  for (const vote of eligibleVotes) counts[vote.targetId]++;
  for (const id of present) totals[id] = Math.round(maxPoints * counts[id] / eligibleVotes.length);
  return totals;
}

export function courtRewardPlan(scores, answeredCounts, completedRounds) {
  // Eligibility depends on answering enough rounds in THIS game, never on
  // previous victories or how many parties someone played that day.
  if (completedRounds < 2 || scores.length === 0) return [];
  const eligible = scores.filter(p => (answeredCounts[p.userId] || 0) >= 2)
    .sort((a,b) => b.score - a.score ||
      (b.finalRound || 0) - (a.finalRound || 0) ||
      (b.wins || 0) - (a.wins || 0) ||
      a.userId.localeCompare(b.userId));
  return eligible.map((player, index) => {
    // Identical overall/final-round/win results share their placement.
    const rank = eligible.findIndex(p => p.score === player.score &&
      (p.finalRound || 0) === (player.finalRound || 0) &&
      (p.wins || 0) === (player.wins || 0)) + 1;
    // A solo session has no opponent and therefore no competitive placement bonus.
    return { userId: player.userId, completion: 5,
      placement: scores.length === 1 ? 0 : ([10,6,3][rank - 1] || 0) };
  });
}

export function safeCourtText(text) {
  return String(text || "").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b").replace(/[\x60*_~|>]/g, "\\$&").slice(0, 160);
}
