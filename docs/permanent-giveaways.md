# Permanent Discord giveaways — test checklist

Development branch: `feature/permanent-giveaways`. This is a separate, general AM Isa Bot feature; it does not depend on the unmerged Hatchem card-game branch.

## Commands

- `/giveaway start title:<title> prize:<prize> minutes:<1–20160> winners:<1–10> rules:<optional> channel:<optional> role:<optional>`
- `/giveaway list` — recent giveaway IDs, status, and direct message links
- `/giveaway end id:<giveaway-ID-or-message-link>` — finish now
- `/giveaway reroll id:<giveaway-ID-or-message-link> winner:<1-based-position>` — replace one winner

Staff must have Manage Server. The bot needs permission to View Channel, Send Messages, Embed Links, Read Message History, and edit its own announcements. Entrants need no commands or special permissions, unless a required role is configured.

## Expected behavior

1. Start a giveaway in a test channel. The bot posts one announcement with title, prize, rules, host, ending time and an **Enter**, **Leave**, **Entry Count** control.
2. Try entering twice. Both attempts must produce a private response, but only one entry must be saved. Joining costs no Points.
3. Test leaving/re-entering, the live Entry Count, optional required-role rejection and the fact that staff commands are not available to regular members.
4. Stop the development bot during a running giveaway, restart after the deadline, and verify that the same message changes to **Ended** with winners and final entrant count. The bot must not delete the giveaway message.
5. Create a giveaway with two or more members and multiple winners; verify distinct winners.
6. Use `/giveaway end` early; repeating End must **not** select another winner.
7. Use `/giveaway reroll` for one winner. Verify the previous winner, replacement, and reroll history remain visible in the **same** message. A replacement must not select a current or earlier winner.
8. Re-run the bot and verify archived results persist. Test a late Enter/Leave against an expired message; entry must be denied.
9. Test with zero entrants; the final message should explicitly state there were no winners.
10. Check `/giveaway list`, and test staff End/Reroll using both the giveaway ID and the original message link.

## Behavior and limits

- The bot **never deletes a finished giveaway** and keeps its database record.
- Prize fulfillment is **manual**. The bot does not transfer real Adopt Me pets or confirm TikTok follows. Optional external requirements in the Rules field are informational and must be checked by staff.
- Results are selected with cryptographic randomness from unique recorded entrants. If there are fewer entrants than winner slots, it awards only the available number.
- Rerolls exclude previous winners and keep an audit trail. They do not deliver prizes or undo previously delivered prizes.
- The public active post does not update on every click. Entrants can use **Entry Count** to see the live count privately. The final public post contains the exact total.
- Automatic endings run on a 30-second sweep, with restart recovery. An offline bot cannot close giveaways while offline; it reconciles them after reconnecting.
- No production deployment or merge until the user explicitly approves.
