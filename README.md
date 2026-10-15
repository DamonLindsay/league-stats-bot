# League Stats Bot

A serverless Discord bot that posts a nightly League of Legends leaderboard for my friend group.

Every evening at 7pm (Brisbane time) a scheduled Firebase Cloud Function looks up each tracked player through the Riot Games API, pulls their ranked tier and last 7 days of matches, ranks everyone, and draws the results onto an image card that it posts to a Discord channel.

## Features

- **Scheduled job:** runs automatically every day using Firebase's scheduler, with no server to maintain
- **Riot API integration:** account lookup, ranked tier and LP, and recent match history for each player
- **Separate leaderboards:** Summoner's Rift and ARAM are tracked and posted as separate cards
- **Ladder Points:** a custom score that rewards playing and winning, so the board isn't just about raw rank
- **Badges:** highest and lowest win rate, Ladder Hero and other titles, with tie handling
- **Generated image cards:** drawn server-side with canvas, with auto-shrinking text so rows never overflow
- **Rate limiting:** all Riot API calls are throttled globally to stay inside the API limits
- **Firestore:** the list of tracked players lives in a `friends` collection, so players can be added without a redeploy
- **Secrets:** the Riot API key and Discord webhook are stored as Firebase secrets, not in the code

## Tech stack

TypeScript, Firebase Cloud Functions (v2), Cloud Scheduler, Firestore, Riot Games API, Axios, `@napi-rs/canvas`, Discord webhooks

## Project structure

```
functions/src/
├── index.ts      # Scheduled function: fetch, rank and post
├── riot.ts       # Riot API client with global rate limiting
├── friends.ts    # Reads tracked players from Firestore
├── statsCard.ts  # Draws the leaderboard image
└── discord.ts    # Posts the image to a Discord webhook
```

## Running it yourself

1. Create a Firebase project and enable Firestore.
2. Add documents to a `friends` collection with each player's Riot ID and region.
3. Set the secrets:
   ```bash
   firebase functions:secrets:set RIOT_API_KEY
   firebase functions:secrets:set DISCORD_WEBHOOK_URL
   ```
4. Deploy:
   ```bash
   cd functions
   npm install
   firebase deploy --only functions
   ```

## Roadmap

Planned features and known issues are tracked in [backlog.md](backlog.md), including a `/register` slash command and KDA-weighted ranking.
