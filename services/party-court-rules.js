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
].map(([category, text], index) => Object.freeze({ id: index + 1, category, text })));

export const COURT_ROUND_POINTS = Object.freeze([1000, 1500, 2000]);
export const COURT_MIN_PLAYERS = 4;
export const COURT_MAX_PLAYERS = 20;

export function assignCourtMatchups(players, round, category = "mixed", usedIds = [], random = Math.random) {
  if (players.length < COURT_MIN_PLAYERS || players.length > COURT_MAX_PLAYERS || new Set(players).size !== players.length)
    throw new Error("Court of Chaos requires 4–20 distinct players.");
  const pool = COURT_PROMPTS.filter(p => (category === "mixed" || p.category === category) && !usedIds.includes(p.id));
  const available = pool.length ? pool : COURT_PROMPTS.filter(p => category === "mixed" || p.category === category);
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const matchups = [];
  const options = [...available];
  const count = Math.floor(players.length / 2);
  for (let i = 0, offset = 0; i < count; i++) {
    const size = players.length % 2 && i === count - 1 ? 3 : 2;
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
  if (completedRounds < 2 || scores.length < 4 || priorCompletionCount >= 2) return [];
  const eligible = scores.filter(p => (answeredCounts[p.userId] || 0) >= 2)
    .sort((a,b) => b.score - a.score || a.userId.localeCompare(b.userId));
  return eligible.map((player, index) => ({
    userId: player.userId,
    completion: 5,
    placement: [10,6,3][index] || 0,
  }));
}

export function safeCourtText(text) {
  return String(text || "").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/@/g, "@\u200b").replace(/[\x60*_~|>]/g, "\\$&").slice(0, 160);
}
