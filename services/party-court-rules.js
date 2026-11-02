// Original, family-friendly prompts. Keep game mechanics independent of prompt text.
export const COURT_PROMPTS = Object.freeze([
  ["silly", "What is the worst possible prize inside a mystery box?"],
  ["silly", "What is the worst name for a brand-new pet?"],
  ["silly", "What's the first rule of a school run entirely by cats?"],
  ["silly", "What should never be written on a birthday cake?"],
  ["silly", "What is a terrible slogan for a theme park?"],
  ["silly", "What's a suspicious thing for a talking refrigerator to say?"],
  ["silly", "What would a ghost put on its shopping list?"],
  ["silly", "What should you NEVER bring to a royal banquet?"],
  ["silly", "What's a superhero's least helpful superpower?"],
  ["silly", "What does a dragon secretly keep under its bed?"],
  ["silly", "What would a penguin complain about at the beach?"],
  ["silly", "What is the worst possible name for a new planet?"],
  ["silly", "What would a robot call its pet human?"],
  ["silly", "What's the worst thing to hear from your dentist?"],
  ["silly", "What is the strangest thing a vending machine could sell?"],
  ["roblox", "What's the worst thing to say during an Adopt Me trade?"],
  ["roblox", "What's a terrible name for a new Roblox game?"],
  ["roblox", "What would a Frost Dragon order at a restaurant?"],
  ["roblox", "What's the most suspicious thing to see in a pet nursery?"],
  ["roblox", "What should never come out of an Adopt Me egg?"],
  ["roblox", "What's the worst thing to shout when someone offers you a pet?"],
  ["roblox", "What would an Adopt Me pet write in a complaint letter?"],
  ["roblox", "What's a ridiculous new job for your Roblox avatar?"],
  ["roblox", "Why did the unicorn get banned from the pet salon?"],
  ["roblox", "What's the funniest item to offer for a legendary pet?"],
  ["roblox", "What is the most useless potion in a pet shop?"],
  ["roblox", "What happens when a dragon tries to drive a tiny car?"],
  ["roblox", "What's the worst advice for a new Adopt Me player?"],
  ["roblox", "What would a pet name its owner if it could choose?"],
  ["roblox", "What is the worst possible update announcement for a pet game?"],
  ["fantasy", "What is the worst spell to cast during a royal wedding?"],
  ["fantasy", "What's the silliest thing a wizard could turn into?"],
  ["fantasy", "What does a vampire really hate about Mondays?"],
  ["fantasy", "What's the worst quest reward from a mysterious stranger?"],
  ["fantasy", "What should a knight never say to a dragon?"],
  ["fantasy", "What's a terrible name for a haunted castle?"],
  ["fantasy", "What would a goblin put on a fancy invitation?"],
  ["fantasy", "What does a unicorn do when nobody is watching?"],
  ["fantasy", "What's the worst thing to find at the bottom of a potion bottle?"],
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
].map(([category, text], index) => Object.freeze({ id: index + 1, category, text })));

export const COURT_ROUND_POINTS = Object.freeze([1000, 1500, 2000]);
// A host may start with any nonempty lobby; one player is a solo showcase.
export const COURT_MIN_PLAYERS = 1;
export const COURT_MAX_PLAYERS = 20;

export function assignCourtMatchups(players, round, category = "mixed", usedIds = [], random = Math.random) {
  if (players.length < COURT_MIN_PLAYERS || players.length > COURT_MAX_PLAYERS || new Set(players).size !== players.length)
    throw new Error("Court of Chaos requires 1–20 distinct players.");
  const pool = COURT_PROMPTS.filter(p => (category === "mixed" || p.category === category) && !usedIds.includes(p.id));
  const available = pool.length ? pool : COURT_PROMPTS.filter(p => category === "mixed" || p.category === category);
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const matchups = [];
  const options = [...available];
  const count = Math.max(1, Math.floor(players.length / 2));
  for (let i = 0, offset = 0; i < count; i++) {
    const size = players.length === 1 ? 1 :
      (players.length % 2 && i === count - 1 ? 3 : 2);
    const playerIds = shuffled.slice(offset, offset + size);
    offset += size;
    if (!options.length) options.push(...available);
    const choice = Math.floor(random() * options.length);
    const [prompt] = options.splice(choice, 1);
    matchups.push({ playerIds, promptId: prompt.id, prompt: prompt.text });
  }
  return matchups;
}

export function scoreCourtMatchup(playerIds, answers, votes, round) {
  const present = playerIds.filter(id => answers.some(a => a.userId === id && a.text?.trim()));
  const maxPoints = COURT_ROUND_POINTS[round - 1] || 0;
  const totals = Object.fromEntries(playerIds.map(id => [id, 0]));
  if (present.length < 2 || !maxPoints) return totals;
  const eligibleVotes = votes.filter(v => present.includes(v.targetId) && !playerIds.includes(v.voterId));
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

export function courtRewardPlan(scores, answeredCounts, completedRounds, priorCompletionCount = 0) {
  if (completedRounds < 2 || scores.length === 0 || priorCompletionCount >= 2) return [];
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
