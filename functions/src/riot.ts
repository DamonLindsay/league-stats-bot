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

interface MatchParticipant {
    puuid: string;
    championName: string;
    win: boolean;
    kills: number;
    deaths: number;
    assists: number;
}

interface MatchInfo {
    info: {
        queueId: number;
        participants: MatchParticipant[];
    };
}

/**
 * Fetches the player's most recent match and returns their personal
 * result from it (champion, win/loss, KDA).  Works for any queue type
 * (normals, ARAM ranked), unlike getRanjkByPuuid which only covers
 * ranked queues.
 */
export async function getMostRecentMatch(
    puuid: string,
    regionalCluster: string,
    apiKey: string
): Promise<MatchParticipant | null> {
    const idsUrl = `https://${regionalCluster}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?count=1`;

    const idsResponse = await axios.get<string[]>(idsUrl, {
        headers: { "X-Riot-Token": apiKey },
    });

    if (idsResponse.data.length === 0) {
        return null;
    }

    const matchId = idsResponse.data[0];
    const matchUrl = `https://${regionalCluster}.api.riotgames.com/lol/match/v5/matches/${matchId}`;

    const matchResponse = await axios.get<MatchInfo>(matchUrl, {
        headers: { "X-Riot-Token": apiKey },
    });

    const participant = matchResponse.data.info.participants.find(
        (p) => p.puuid === puuid
    );

    return participant ?? null;
}