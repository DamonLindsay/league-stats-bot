import { setGlobalOptions } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { getPuuid, getRankByPuuid } from "./riot";
import { postToDiscord } from "./discord";

setGlobalOptions({ maxInstances: 10 });

const riotApiKey = defineSecret("RIOT_API_KEY")
const discordWebhookUrl = defineSecret("DISCORD_WEBHOOK_URL");

interface Friend {
    discordName: string;
    gameName: string;
    tagLine: string;
    platform: string;
    regionalCluster: string;
}

// Hardcoded friend list for v1 - swap to Firestore later
// Self-serve sign-up instead of manually editting code.
const friends: Friend[] = [
    {
        discordName: "Damonides",
        gameName: "Damonides",
        tagLine: "GYATT",
        platform: "oc1",
        regionalCluster: "asia",
    },
    {
        discordName: "CynicalDahlia",
        gameName: "Cynical Dahlia",
        tagLine: "OC",
        platform: "oc1",
        regionalCluster: "asia"
    },
    {
        discordName: "Benevolence",
        gameName: "Benevolence",
        tagLine: "Benee",
        platform: "oc1",
        regionalCluster: "asia"
    },
    {
        discordName: "Camzar",
        gameName: "Cazara",
        tagLine: "zonk",
        platform: "oc1",
        regionalCluster: "asia"
    },
    {
        discordName: "JordsPords",
        gameName: "Jordspords",
        tagLine: "2101",
        platform: "oc1",
        regionalCluster: "asia"
    }
];

export const dailyLeagueStats = onSchedule(
    {
        schedule: "every day 09:00",
        timeZone: "Australia/Brisbane",
        secrets: [riotApiKey, discordWebhookUrl],
    },
    async () => {
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
                    lines.push(`**${friend.discordName}**: Unranked`);
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