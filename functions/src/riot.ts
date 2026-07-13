import axios from "axios";

interface RiotAccount {
    puuid: string;
    gameName: string;
    tagLine: string;
}

interface RankEntry {
    queueType: string;
    tier: string;
    rank: string;
    leaguePoints: number;
    wins: number;
    losses: number;
}

/**
 * Looks up a player's PUUID from their Riot ID (gameName#tagLine).
 * Uses the regional routing cluster (americas/europe/asia), not the
 * platform (na1/euw1) - Account-V1 is a regional-routed API.
 */
export async function getPuuid(
    gameName: string,
    tagLine: string,
    regionalCluster: string,
    apiKey: string
): Promise<string> {
    const url = `https://${regionalCluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
      gameName
    )}/${encodeURIComponent(tagLine)}`;

    const response = await axios.get<RiotAccount>(url, {
        headers: { "X-Riot-Token": apiKey },
    });

    return response.data.puuid;
}

/**
 * Fetches ranked stats for a player by PUUID.
 * Uses platform routing (na1/euw1/etc) - League-V4 is platform-routed,
 * unlike Account-V1 above.
 */
export async function getRankByPuuid(
    puuid: string,
    platform: string,
    apiKey: string
): Promise<RankEntry[]> {
    const url = `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;

    const response = await axios.get<RankEntry[]>(url, {
        headers: { "X-Riot-Token": apiKey }
    });

    return response.data;
}