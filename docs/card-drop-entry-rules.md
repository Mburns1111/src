# Card drop entries — development test rules

Drop windows are still 75 seconds, with three cards shown and the same art/credits.

- The **person who created the drop** may choose one card, which is **guaranteed** for that person.
- Other members may click the same card. Those buttons remain active even after other guests have entered.
- Each member gets **one active entry per drop**, not one per card. Clicking again while still entered is refused.
- If the drop creator chooses an already-contested card, all earlier guests on that specific card have their **entry released**. They may enter either of the other unlocked cards before the timer expires.
- A creator-priority card is visually marked **Chosen** and its button is disabled for everyone.
- When the drop expires, every card not chosen by the creator selects one entrant at random using cryptographic randomness. Each slot can award **at most one card**.
- People who lose a draw receive no card. Refund refers to the **entry opportunity** if displaced by the creator; the current drop system does not charge Points or tokens for entering.
- The bot creates the unique card IDs only on award, within the existing MongoDB transaction. Legacy open/closed reservations remain supported on settlement.
- The final public banner remains the same short **Drop Ended** heading, with buttons removed at expiry.

## Verification
Pull the dev branch and run npm test. Make a fresh test drop with `/cards test-drop release:test-s1-r1`.
1. Have guest A and B click **Grab #1**. Both should receive entry confirmations; the button should remain clickable.
2. Have the drop creator click **Grab #1**. It should say **Chosen** and become disabled.
3. Before expiry, guest A and B should be able to enter **Grab #2** or **Grab #3**.
4. At expiry verify the creator receives #1, and only one person is randomly awarded each of #2/#3.
5. Verify one member cannot enter two active slots, and the same slot never mints twice during recovery.
