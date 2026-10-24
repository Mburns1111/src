# Phase 2: message and voice activity Points (TEST branch)

Branch: `feature/points-earning`. These changes do not deploy to Wispbyte or `main`. Production Points and shop balances are not modified by this phase.

## What earns Points

| Source | Established member | First seven days after joining | Anti-spam and eligibility |
| --- | ---: | ---: | --- |
| Qualifying Discord message | 2 Points | 4 Points | Minimum 15 visible characters and 8 letters, 2-minute per-user cooldown, no immediate duplicate text, max **10 paid messages per UTC day** |
| Qualifying voice presence | 5 Points per 10 minutes | 10 Points per 10 minutes | At least **two human participants** in the same voice channel; deafened, AFK-channel, bots and suppressed Stage listeners do not count |
| Staff-approved native Discord poll | 5 Points | 5 Points | One award per poll, 15 Points per UTC week, cannot earn again by changing or removing vote |
| One-time shop/post milestones | Unchanged | Unchanged | These do not consume repeatable activity limits |
| Staff giveaways/participation awards | Set by manager | Set by manager | Audited; do not consume repeatable activity limits |
| Invites | Not enabled yet | Not enabled yet | Remain Phase 3 |

**Combined repeatable cap**: a new member can earn up to **425 Points** across messages, voice, and approved polls during their first **seven days measured from guild join time**. Later, the cap is **225 Points per UTC Monday–Sunday week** across these activities. Message and voice rates are doubled only for the initial seven-day window; poll awards remain five Points. Newcomer window resets are not tied to a calendar Monday, so a person cannot reset the 425 cap halfway through their first week. Unclaimed voice intervals do not count while AM Isa is offline.

Every reward is an immutable Points ledger receipt plus a credit to the existing shop Points wallet in a MongoDB transaction. Message bodies and voice audio are **not stored or recorded**; only a SHA-256 hash of the most recently rewarded normalized message is stored for cooldown/duplicate checks.

## Enable and test on Replit only

1. Confirm Replit uses the **test bot token and test MongoDB database**. Run:
   ```bash
   git fetch origin
   git switch feature/points-earning
   git pull --ff-only origin feature/points-earning
   npm install
   node register-commands.js
   npm start
   ```
2. Message rewards need `ENABLE_MESSAGE_CONTENT_INTENT=1` in Replit **and** Message Content Intent toggled on for the same test application in the Discord Developer Portal (already enabled during Arclo observation). Voice tracking needs `GuildVoiceStates`, included in the updated bot code, not a separate privileged permission.
3. Run `/points-admin activity-toggle source:Messages only enabled:true` or `source:Messages and Voice enabled:true` to opt in. Both sources start **disabled**, so existing guilds do not start earning chat/voice Points merely by updating the code.
4. Run `/points-admin settings` to see toggles and rate/cap rules. Run `/points-admin activity-status member:<your member>` to check activity Points and remaining allowance.
5. In a normal test server text channel, send a non-command original sentence with at least 15 characters and eight letters (e.g. "Testing AM Isa message rewards today."). Wait a moment, then use `/points-admin history member:<you>` and the shop balance. Established member should earn **+2**; newly joined member within seven days earns **+4**.
6. Repeat the same message immediately: **no second reward**. Send a different sentence within two minutes: still **no reward**. After two minutes, a different qualifying message should earn again. Ten messages per UTC day is the maximum, even if the cooldown passes.
7. For voice, have **two human test members** join the same non-AFK voice channel without deafening themselves. At approximately ten qualifying minutes of bot uptime, each eligible member should earn **+5** (or +10 during the first seven days). Leaving the voice channel, being alone, or deafening stops accrual; no back-pay for offline or disqualified time. Individual qualifying minutes persist across bot restarts and are deduplicated.
8. Verify previously approved native poll credits remain unchanged. A **new** approved poll still awards +5 once, consumes the overall activity allowance, and respects the 15-per-week poll subcap. `/points-observe voters` still shows individual participants.
9. To stop chat or voice rewards: `/points-admin activity-toggle source:Messages and Voice enabled:false`. Existing earned Points are not removed.

**Testing notes:** Voice presence alone cannot prove a person is speaking; the two-person and deafening rules limit but do not eliminate coordinated idling. Message scoring is intentionally simple and should be tuned after seeing live test data. Invite rewards, general activity analytics, and production rollout remain separate work. Automatic rates are starting values, not a guarantee every member earns the weekly cap.

## Failure and repeat prevention

- Duplicate message IDs, same-hash consecutive rewarded messages and attempts before the two-minute cooldown cannot produce a second credit.
- A native Discord poll vote cannot pay twice even across restarts.
- A ten-minute voice block is keyed by a stable per-member, per-period identifier; eligible minute stamps are stored to prevent double counting during a restart.
- The shared activity cap, message daily limit and the wallet credit are transactional; retries cannot separately increase Points without a ledger record.
- All staff grants and manual giveaways continue to use the existing audited `/points-admin grant` or `/points-admin grant-multiple` workflow.
