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
        timeoutSeconds: 300,
        memory: "512MiB"
    },
    async () => {
        const friends = await getFriends();
        const riftRows: StatsCardRow[] = [];
        const aramRows: StatsCardRow[] = [];

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

                const { rift, aram } = await getRecentStats(
                    puuid,
                    friend.matchRegionalCluster,
                    riotApiKey.value(),
                    7
                );

                // Rift row - always built, even with no recent games,
                // since it's the "main" card everyone appears on.
                if (rift) {
                    const kdaRatio = rift.avgDeaths === 0
                        ? rift.avgKills + rift.avgAssists
                        : (rift.avgKills + rift.avgAssists) / rift.avgDeaths;

                    const rankSuffix = soloQueue
                        ? ` . ${soloQueue.tier} ${soloQueue.rank} (${soloQueue.leaguePoints} LP)`
                        : "";

                    riftRows.push({
                        discordName: friend.discordName,
                        statusLabel: `LAST 7 DAYS · ${rift.gamesPlayed} GAMES`,
                        record: `${rift.wins}W - ${rift.losses}L`,
                        winRate: rift.winRate,
                        kda: `${rift.avgKills} / ${rift.avgDeaths} / ${rift.avgAssists} (${Math.round(kdaRatio * 100) / 100} KDA)`,
                        kdaRatio: Math.round(kdaRatio * 100) / 100,
                        highlight: `Most played: ${rift.mostPlayedChampion}${rankSuffix}`,
                        championId: rift.mostPlayedChampion,
                    });
                } else {
                    riftRows.push({
                        discordName: friend.discordName,
                        statusLabel: "LAST 7 DAYS",
                        record: "0W - 0L",
                        winRate: 0,
                        kda: "-",
                        kdaRatio: 0,
                        highlight: soloQueue
                            ? `${soloQueue.tier} ${soloQueue.rank} (${soloQueue.leaguePoints} LP)`
                            : "No games played",
                    });
                }

                // ARAM row - only included if they actually played ARAM
                // this week, so the ARAM card doesn't fill up with
                // "no games" for people who never play it.
                if (aram) {
                    const kdaRatio = aram.avgDeaths === 0
                        ? aram.avgKills + aram.avgAssists
                        : (aram.avgKills + aram.avgAssists) / aram.avgDeaths;

                    aramRows.push({
                        discordName: friend.discordName,
                        statusLabel: `LAST 7 DAYS · ${aram.gamesPlayed} GAMES`,
                        record: `${aram.wins}W - ${aram.losses}L`,
                        winRate: aram.winRate,
                        kda: `${aram.avgKills} / ${aram.avgDeaths} / ${aram.avgAssists} (${Math.round(kdaRatio * 100) / 100} KDA)`,
                        kdaRatio: Math.round(kdaRatio * 100) / 100,
                        highlight: `Most played: ${aram.mostPlayedChampion}`,
                        championId: aram.mostPlayedChampion,
                    });
                }
            } catch (error) {
                logger.error(`Failed to fetch stats for ${friend.discordName}`, error);
                riftRows.push({
                    discordName: friend.discordName,
                    statusLabel: "ERROR",
                    record: "-",
                    winRate: 0,
                    kda: "-",
                    kdaRatio: 0,
                    highlight: "Couldn't fetch stats",
                });
            }
        }

        const sortRows = (rows: StatsCardRow[]) => {
            rows.sort((a, b) => {
                if (b.winRate !== a.winRate) {
                    return b.winRate - a.winRate;
                }
                return b.kdaRatio - a.kdaRatio;
            });
        };

        sortRows(riftRows);
        sortRows(aramRows);

        const riftImage = await generateStatsCard(riftRows, "SUMMONER'S RIFT REPORT");
        await postImageToDiscord(
            discordWebhookUrl.value(),
            riftImage,
            "weekly-rift-report.png"
        );

        if (aramRows.length > 0) {
            const aramImage = await generateStatsCard(aramRows, "ARAM REPORT");
            await postImageToDiscord(
                discordWebhookUrl.value(),
                aramImage,
                "weekly-aram-report.png"
            );
        }
    }
);