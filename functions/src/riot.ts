import axios from "axios";
import * as logger from "firebase-functions/logger";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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

const QUEUE_NORMAL_DRAFT = 400;
const QUEUE_RANKED_SOLO_DUO = 420;
const QUEUE_NORMAL_BLIND = 430;
const QUEUE_RANKED_FLEX = 440;
const QUEUE_RANKED_5S_LIMITED = 710;  // Ranked 5s, limited-time mode - Rift-style, not aram

const QUEUE_ARAM = 450;

const RIFT_QUEUE_IDS = [
    QUEUE_NORMAL_DRAFT,
    QUEUE_RANKED_SOLO_DUO,
    QUEUE_NORMAL_BLIND,
    QUEUE_RANKED_FLEX,
    QUEUE_RANKED_5S_LIMITED,
];

const ARAM_QUEUE_IDS = [
    QUEUE_ARAM,
];

export interface CategorizedStats {
    rift: RecentStatsSummary | null;
    aram: RecentStatsSummary | null;
}

export interface RecentStatsSummary {
    gamesPlayed: number;
    wins: number;
    losses: number;
    winRate: number;
    avgKills: number;
    avgDeaths: number;
    avgAssists: number;
    mostPlayedChampion: string;
}

/**
 * Aggregates a player's match history over the last N days, split into
 * two categories: Summoners Rift (normals + ranked combined) and ARAM.
 * Categorization happens client-side using each match's queueID, since
 * Riot's queue filter only accepts one queue per API call and we don't
 * want to fetch the match list twice.
 */
export async function getRecentStats(
    puuid: string,
    regionalCluster: string,
    apiKey: string,
    days: number
): Promise<CategorizedStats> {
    const startTime = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

    const idsUrl = `https://${regionalCluster}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?startTime=${startTime}&count=100`;

    const idsResponse = await axios.get<string[]>(idsUrl, {
        headers: { "X-Riot-Token": apiKey },
    });

    const matchIds = idsResponse.data;
    
    logger.info(`Found ${matchIds.length} total matches for puuid ${puuid}`);

    const riftParticipants: MatchParticipant[] = [];
    const aramParticipants: MatchParticipant[] = [];

    for (const matchId of matchIds) {
        await sleep(100);

        const matchUrl = `https://${regionalCluster}.api.riotgames.com/lol/match/v5/matches/${matchId}`;

        const matchResponse = await axios.get<MatchInfo>(matchUrl, {
            headers: { "X-Riot-Token": apiKey },
        });

        const participant = matchResponse.data.info.participants.find(
            (p) => p.puuid === puuid
        );

        if (!participant) {
            continue;
        }

        const queueId = matchResponse.data.info.queueId;

        logger.info(`Match ${matchId} has queueID ${queueId}`);

        if (RIFT_QUEUE_IDS.includes(queueId)) {
            riftParticipants.push(participant);
        } else if (ARAM_QUEUE_IDS.includes(queueId)) {
            aramParticipants.push(participant);
        }
        // Other queue types go here (e.g. ARAM: Mayhem, Arena) are intentionally
        // not categorized here - not currently supported by this bot.
    }

    return {
        rift: summarize(riftParticipants),
        aram: summarize(aramParticipants),
    };
}

function summarize(participants: MatchParticipant[]): RecentStatsSummary | null {
    if (participants.length === 0) {
        return null;
    }

    const wins = participants.filter((p) => p.win).length;
    const totalKills = participants.reduce((sum, p) => sum + p.kills, 0);
    const totalDeaths = participants.reduce((sum, p) => sum + p.deaths, 0);
    const totalAssists = participants.reduce((sum, p) => sum + p.assists, 0);

    const championCounts: Record<string, number> = {};
    for (const p of participants) {
        championCounts[p.championName] = (championCounts[p.championName] || 0) + 1;
    }

    const mostPlayedChampion = Object.entries(championCounts).sort(
        (a, b) => b[1] - a[1]
    )[0][0];

    return {
        gamesPlayed: participants.length,
        wins,
        losses: participants.length - wins,
        winRate: Math.round((wins / participants.length) * 100),
        avgKills: Math.round((totalKills / participants.length) * 10) / 10,
        avgDeaths: Math.round((totalDeaths / participants.length) * 10) / 10,
        avgAssists: Math.round((totalAssists / participants.length) * 10) / 10,
        mostPlayedChampion,
    };
}
