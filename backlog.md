# Backlog

Ideas and known issues for future development, not yet scheduled.

## Known Issues

- **ARAM: Mayhem not tracked** — the correct queue ID for Mayhem is still unknown.
  `710` was tried and turned out to be Ranked 5s (Limited Time Mode), not Mayhem.
  Custom lobby games may report `queueId: 0` regardless of actual mode, meaning
  queueId alone might not be enough — may need to also check `gameMode` and/or
  `mapId` from match data. Needs proper investigation with real Mayhem match
  logs before attempting another fix.

## Planned Features

- **KDA-weighted ranking** — currently KDA only breaks ties in win rate.
  Should factor into ranking directly (e.g. a blended score), not just as a
  tiebreaker. Needs the group to agree on a weighting that feels fair before
  implementing.

- **Don't crown "worst performer" for 0 games played** — currently anyone with
  0 games this week can still be tagged worst performer if they have the
  lowest win rate (0%). Should be excluded from `worstRowIndex` eligibility,
  same pattern as the "all tied" guard already in place.

- **Interactive bot commands** — move from a pure webhook to a real Discord
  Application/Bot with an Interactions Endpoint. First target: a `/register`
  slash command so friends can add themselves to Firestore instead of manual
  console entry. Needs: Discord bot application setup, signature verification,
  a new `onRequest` Cloud Function.

- **Average CS per game** — available in Match-V5 participant data. Needs a
  design decision first: a flat average will make supports look artificially
  low compared to laners. Consider showing per-role, excluding supports, or
  just accepting the number as imperfect/contextual.
