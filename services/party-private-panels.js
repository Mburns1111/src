// Discord ephemeral interaction replies cannot be fetched from a channel.
// Keep only short-lived in-process interaction handles for the answering
// window, so the original private panel can be deleted when entry closes.
// No tokens or private answers are persisted in MongoDB or logs.
const panels = new Map();
const keyFor = (gameId, round, userId) => [String(gameId), round, userId].join(":");
export function trackCourtAnswerPanel(game, interaction) {
  if (!interaction || typeof interaction.deleteReply !== "function") return;
  const key = keyFor(game._id, game.round, interaction.user.id);
  const old = panels.get(key);
  // If the user reopened the private panel, remove the stale old panel.
  if (old && old !== interaction) {
    Promise.resolve().then(() => old.deleteReply()).catch(() => {});
  }
  panels.set(key, interaction);
}
export async function closeCourtAnswerPanels(gameId, round) {
  const prefix = [String(gameId), round].join(":") + ":";
  const jobs = [];
  for (const [key, interaction] of panels) {
    if (!key.startsWith(prefix)) continue;
    panels.delete(key);
    jobs.push(Promise.resolve().then(() => interaction.deleteReply())
      .catch(error => {
        // A deleted/expired interaction is expected if a user dismissed
        // their private view. Never stall the timed game on cleanup.
        if (![10008, 10015, 10062].includes(Number(error?.code)))
          console.warn("[Party] Could not dismiss private answer panel", String(error));
      }));
  }
  await Promise.all(jobs);
}
export async function cleanCourtAnswerPanelsForGame(game) {
  if (game.phase !== "answering") return closeCourtAnswerPanels(game._id, game.round);
}
