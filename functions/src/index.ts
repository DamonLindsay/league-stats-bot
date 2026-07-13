import { setGlobalOptions } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { getPuuid, getRankByPuuid, getRecentStats } from "./riot";
import { postImageToDiscord } from "./discord";
import { getFriends } from "./friends";
import { generateStatsCard, StatsCardRow } from "./statsCard"
import { initializeApp } from "firebase-admin/app";

initializeApp();

setGlobalOptions({ maxInstances: 10 });

const riotApiKey = defineSecret("RIOT_API_KEY")
const discordWebhookUrl = defineSecret("DISCORD_WEBHOOK_URL");

export const dailyLeagueStats = onSchedule(
    {
        schedule: "every day 19:00",
        timeZone: "Australia/Brisbane",
        secrets: [riotApiKey, discordWebhookUrl],
    },
    async () => {
        const friends = await getFriends();
        const rows: StatsCardRow[] = [];

        for (const friend of friends) {
            try {
                const puuid = await getPuuid(
                    friend.gameName,
                    friend.tagLine,
                    friend.regionalCluster,
                    riotApiKey.value()
                );

                const ranks = await getRankByPuuid(
                    puuid,
                    friend.platform,
                    riotApiKey.value()
                );

                const soloQueue = ranks.find(
                    (r) => r.queueType === "RANKED_SOLO_5x5"
                );

                if (soloQueue) {
                    rows.push({
                        discordName: friend.discordName,
                        statusLabel: "RANKED SOLO/DUO",
                        record: `${soloQueue.wins}W - ${soloQueue.losses}L`,
                        winRate: Math.round(
                            (soloQueue.wins / (soloQueue.wins + soloQueue.losses)) * 100
                        ),
                        kda: "-",
                        highlight: `${soloQueue.tier} ${soloQueue.rank} · ${soloQueue.leaguePoints} LP`,
                    });
                } else {
                    const stats = await getRecentStats(
                        puuid,
                        friend.matchRegionalCluster,
                        riotApiKey.value(),
                        7
                    );

                    if (stats) {
                        rows.push({
                            discordName: friend.discordName,
                            statusLabel: `LAST 7 DAYS · ${stats.gamesPlayed} GAMES`,
                            record: `${stats.wins}W - ${stats.losses}L`,
                            winRate: stats.winRate,
                            kda: `${stats.avgKills} / ${stats.avgDeaths} / ${stats.avgAssists}`,
                            highlight: `Most played: ${stats.mostPlayedChampion}`,
                        });
                    } else {
                        rows.push({
                            discordName: friend.discordName,
                            statusLabel: "LAST 7 DAYS",
                            record: "0W - 0L",
                            winRate: 0,
                            kda: "-",
                            highlight: "No games played",
                        });
                    }
                }
            } catch (error) {
                logger.error(`Failed to fetch stats for ${friend.discordName}`, error);
                rows.push({
                    discordName: friend.discordName,
                    statusLabel: "ERROR",
                    record: "-",
                    winRate: 0,
                    kda: "-",
                    highlight: "Couldn't fetch stats",
                });
            }
        }
        const imageBuffer = generateStatsCard(rows);
        await postImageToDiscord(
            discordWebhookUrl.value(),
            imageBuffer,
            "weekly-league-report.png"
        );
    }
);