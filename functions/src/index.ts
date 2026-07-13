import { setGlobalOptions } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { getPuuid, getRankByPuuid, getMostRecentMatch } from "./riot";
import { postToDiscord } from "./discord";
import { getFriends } from "./friends";
import { initializeApp } from "firebase-admin/app";

initializeApp();

setGlobalOptions({ maxInstances: 10 });

const riotApiKey = defineSecret("RIOT_API_KEY")
const discordWebhookUrl = defineSecret("DISCORD_WEBHOOK_URL");

export const dailyLeagueStats = onSchedule(
    {
        schedule: "every day 09:00",
        timeZone: "Australia/Brisbane",
        secrets: [riotApiKey, discordWebhookUrl],
    },
    async () => {
        const friends = await getFriends();
        const lines: string[] = [];

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
                    lines.push(
                        `**${friend.discordName}**: ${soloQueue.tier} ${soloQueue.rank} (${soloQueue.leaguePoints} LP) - ${soloQueue.wins}W ${soloQueue.losses}L`
                    );
                } else {
                    const recentMatch = await getMostRecentMatch(
                        puuid,
                        friend.matchRegionalCluster,
                        riotApiKey.value()
                    );

                    if (recentMatch) {
                        const result = recentMatch.win ? "Won": "Lost";
                        lines.push(
                            `**${friend.discordName}**: Unranked - last game: ${result} as ${recentMatch.championName} (${recentMatch.kills}/${recentMatch.deaths}/${recentMatch.assists})`
                        );
                    } else {
                        lines.push(`**${friend.discordName}**: Unranked - no recent matches found`)
                    }
                }
            } catch (error) {
                logger.error(`Failed to fetch stats for ${friend.discordName}`, error);
                lines.push(`**${friend.discordName}**: couldn't fetch stats`);
            }
        }
        const message = `📊 **Daily League Stats**\n${lines.join("\n")}`;
        await postToDiscord(discordWebhookUrl.value(), message);
    }
);