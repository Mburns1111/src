# Phase 3 — Test and deployment checks

AM Isa uses GitHub, Replit for testing, and Wispbyte for production. A GitHub merge is **not** a Wispbyte deployment.

## Continuous integration (read-only)

- `.github/workflows/bot-ci.yml` checks pushes to `main`, `fix/**`, `feature/**`, and pull requests targeting `main`.
- Both Node.js 20 (Replit) and Node.js 22 (Wispbyte) are tested.
- CI uses `npm ci --ignore-scripts`, `npm run preflight -- --static`, `npm run check:source`, and `npm test`.
- CI never receives bot/database secrets, starts the bot, registers commands, migrates data, or deploys.
- The older listing-development workflow no longer duplicates the pull-request suite.

## Replit (development only)

Check that local edits are committed or otherwise preserved before switching branches.

```bash
git fetch origin
git switch fix/phase-3-operational-reliability
git pull --ff-only origin fix/phase-3-operational-reliability
npm install
npm run check:source
npm test
npm run preflight
```

`npm run preflight` validates locally without connecting to Discord/Mongo or printing environment values. Use `npm start` only with the correct test Discord application and test database.

## Slash-command registration

`npm run preflight -- --register` checks `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and optional `DISCORD_GUILD_ID` without needing MongoDB. It **does not register commands**.

`node register-commands.js` is a separate live write that updates Discord application commands. Never run it with production credentials merely to test the Phase 3 branch.

## Wispbyte deployment checklist (approval required)

1. Inspect Wispbyte branch and deployed commit (`git rev-parse --short HEAD` if Git is installed), Node version and startup settings.
2. Privately verify `DISCORD_TOKEN` and `MONGODB_URI`; do not print secret values. Run the read-only `npm run preflight`.
3. Back up MongoDB before any deployment that changes persistent data.
4. Run `npm run check:source` and `npm test` on the exact release revision.
5. Deploy/restart Wispbyte **only with explicit approval**; verify Discord READY and smoke-test profiles, house/outfit cards, shop interactions, and Points.
6. If behavior breaks, stop the rollout and use the last verified revision/backup process. Avoid destructive resets or unsupervised database migrations.

## Boundaries

- A passing preflight checks the presence/shape of configuration only, not token validity or live service reachability.
- Environment-variable values and MongoDB passwords are never logged by preflight.
- Replit bot startup does not prove Wispbyte has updated; compare commit IDs independently.
