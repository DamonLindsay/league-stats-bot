import axios from "axios";
import * as logger from "firebase-functions/logger";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Riot's personal API key allows 100 requests per 2 minutes app-wide. Pacing
// every request (account lookups, rank lookups, match IDs, match details -
// not just the match detail loop) to at least this far apart keeps the whole
// run under that limit; 429s are also retried as a safety net.
const RIOT_MIN_REQUEST_INTERVAL_MS = 1300;
const RIOT_MAX_RETRIES = 3;
let lastRiotRequestAt = 0;

async function riotGet<T>(url: string, apiKey: string, attempt = 0): Promise<T> {
    const wait = RIOT_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRiotRequestAt);
    if (wait > 0) {
        await sleep(wait);
    }

    try {
        const response = await axios.get<T>(url, {
            headers: { "X-Riot-Token": apiKey },
        });
        return response.data;
    } catch (error) {
        if (
            axios.isAxiosError(error) &&
            error.response?.status === 429 &&
            attempt < RIOT_MAX_RETRIES
        ) {
            const retryAfterSeconds = Number(error.response.headers["retry-after"]) || 5;
            logger.info(`Rate limited by Riot API, retrying in ${retryAfterSeconds}s`);
            await sleep(retryAfterSeconds * 1000);
            return riotGet<T>(url, apiKey, attempt + 1);
        }
        throw error;
    } finally {
        lastRiotRequestAt = Date.now();
    }
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

    const account = await riotGet<RiotAccount>(url, apiKey);

    return account.puuid;
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

    return riotGet<RankEntry[]>(url, apiKey);
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

    const matchIds = await riotGet<string[]>(idsUrl, apiKey);

    if (matchIds.length === 0) {
        return null;
    }

    const matchId = matchIds[0];
    const matchUrl = `https://${regionalCluster}.api.riotgames.com/lol/match/v5/matches/${matchId}`;

    const match = await riotGet<MatchInfo>(matchUrl, apiKey);

    const participant = match.info.participants.find(
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
    ladderPoints: number | null; // null if no ranked games were played this week
}

const RANKED_QUEUE_IDS = [
    QUEUE_RANKED_SOLO_DUO,
    QUEUE_RANKED_FLEX,
    QUEUE_RANKED_5S_LIMITED,
];

const LADDER_BASE_WIN = 12;
const LADDER_BASE_LOSS = -6;
const LADDER_STREAK_BONUS_PER_GAME = 2;
const LADDER_STREAK_BONUS_CAP = 10;
const LADDER_SLUMP_PENALTY_PER_GAME = 1;
const LADDER_SLUMP_PENALTY_CAP = 5;
const LADDER_KDA_MODIFIER_CAP = 6;

/**
 * Deterministic pseudo-random offset in [-3, 3], seeded from the match and
 * player. Keeps per-game Ladder Points from being back-solvable as a clean
 * linear formula from the public win/loss + KDA numbers, without making the
 * total feel random from one week to the next.
 */
function ladderJitter(matchId: string, puuid: string): number {
    let hash = 0;
    const seed = matchId + puuid;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    return (Math.abs(hash) % 7) - 3;
}

/**
 * Scores a single ranked match's contribution to Ladder Points: a base
 * win/loss value, a streak bonus/slump penalty based on consecutive results
 * up to and including this game, a modifier from that game's KDA, and a
 * small hidden jitter so the formula can't be reverse-engineered exactly.
 */
function scoreLadderMatch(
    matchId: string,
    puuid: string,
    result: MatchParticipant,
    currentStreak: number
): number {
    const base = result.win ? LADDER_BASE_WIN : LADDER_BASE_LOSS;

    const streakBonus = result.win
        ? Math.min(LADDER_STREAK_BONUS_PER_GAME * (currentStreak - 1), LADDER_STREAK_BONUS_CAP)
        : -Math.min(LADDER_SLUMP_PENALTY_PER_GAME * (currentStreak - 1), LADDER_SLUMP_PENALTY_CAP);

    const kda = result.deaths === 0
        ? result.kills + result.assists
        : (result.kills + result.assists) / result.deaths;
    const kdaModifier = Math.max(
        -LADDER_KDA_MODIFIER_CAP,
        Math.min(LADDER_KDA_MODIFIER_CAP, Math.round((kda - 3) * 1.5))
    );

    const jitter = ladderJitter(matchId, puuid);

    return base + streakBonus + kdaModifier + jitter;
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

    const matchIds = await riotGet<string[]>(idsUrl, apiKey);

    logger.info(`Found ${matchIds.length} total matches for puuid ${puuid}`);

    const riftParticipants: MatchParticipant[] = [];
    const aramParticipants: MatchParticipant[] = [];
    // Match IDs come back most-recent-first; kept in that order here and
    // reversed later so streaks can be computed oldest-to-newest.
    const rankedMatches: { matchId: string; participant: MatchParticipant }[] = [];

    for (const matchId of matchIds) {
        const matchUrl = `https://${regionalCluster}.api.riotgames.com/lol/match/v5/matches/${matchId}`;

        const match = await riotGet<MatchInfo>(matchUrl, apiKey);

        const participant = match.info.participants.find(
            (p) => p.puuid === puuid
        );

        if (!participant) {
            continue;
        }

        const queueId = match.info.queueId;

        logger.info(`Match ${matchId} has queueID ${queueId}`);

        if (RIFT_QUEUE_IDS.includes(queueId)) {
            riftParticipants.push(participant);
        } else if (ARAM_QUEUE_IDS.includes(queueId)) {
            aramParticipants.push(participant);
        }
        // Other queue types go here (e.g. ARAM: Mayhem, Arena) are intentionally
        // not categorized here - not currently supported by this bot.

        if (RANKED_QUEUE_IDS.includes(queueId)) {
            rankedMatches.push({ matchId, participant });
        }
    }

    let ladderPoints: number | null = null;
    if (rankedMatches.length > 0) {
        ladderPoints = 0;
        let streak = 0; // positive = win streak, negative = loss streak

        // Reverse to oldest-first so streaks accumulate in the order the
        // games were actually played.
        for (const { matchId, participant } of [...rankedMatches].reverse()) {
            streak = participant.win
                ? (streak > 0 ? streak + 1 : 1)
                : (streak < 0 ? streak - 1 : -1);

            ladderPoints += scoreLadderMatch(matchId, puuid, participant, Math.abs(streak));
        }
    }

    return {
        rift: summarize(riftParticipants),
        aram: summarize(aramParticipants),
        ladderPoints,
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
