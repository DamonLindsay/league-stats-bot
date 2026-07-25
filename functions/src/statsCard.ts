import { createCanvas, loadImage, GlobalFonts, SKRSContext2D } from "@napi-rs/canvas";
import axios from "axios";
import * as path from "path";

GlobalFonts.registerFromPath(
    path.join(__dirname, "..", "assets", "fonts", "Oswald-Bold.ttf"),
    "Oswald"
);

export interface StatsCardRow {
    discordName: string;
    statusLabel: string; // e.g. "RANKED SOLO/DUO" or "LAST 7 DAYS"
    record: string; // e.g. "4W - 6L"
    winRate: number; // 0-100, drives the accent color
    kda: string; // e.g. "9-0 / 4.1 / 6.4"
    kdaRatio: number; // numeric (kills + assists) / deaths, used for sort tiebreaking
    gamesPlayed: number; // used to exclude 0-game rows from top/worst performer
    rankLabel?: string; // e.g. "GOLD II - 45 LP", shown above championLabel
    championLabel: string; // e.g. "Most played: Nasus" or "No games played"
    championId?: string; // e.g. "Nasus" - used to fetch the champion icon
    ladderPoints?: number; // this week's Ladder Points total from ranked play, if any were earned
}

const WIDTH = 1000;
const HEADER_HEIGHT = 130;
const ROW_HEIGHT = 116;
const PADDING = 30;
const LEFT_COL_MAX_WIDTH = 250; // reserved width for record/KDA text
const RIGHT_COL_MAX_WIDTH = 220; // reserved width for rank/champion text
// These two columns are given fixed, non-overlapping widths so neither a long
// rank/champion string nor an inflated KDA can grow into the other's space.

function shrinkFontToFit(ctx: SKRSContext2D, text: string, fontSize: number, maxWidth: number): number {
    let size = fontSize;
    ctx.font = `bold ${size}px Oswald`;
    while (ctx.measureText(text).width > maxWidth && size > 12) {
        size -= 2;
        ctx.font = `bold ${size}px Oswald`;
    }
    return size;
}

/** Draws left-aligned text, shrinking the font so it can't overrun maxWidth. */
function fillTextLeftAligned(
    ctx: SKRSContext2D,
    text: string,
    x: number,
    y: number,
    fontSize: number,
    maxWidth: number
): void {
    shrinkFontToFit(ctx, text, fontSize, maxWidth);
    ctx.fillText(text, x, y);
}

/** Draws right-aligned text, shrinking the font so it can't overrun maxWidth. */
function fillTextRightAligned(
    ctx: SKRSContext2D,
    text: string,
    rightEdge: number,
    y: number,
    fontSize: number,
    maxWidth: number
): void {
    shrinkFontToFit(ctx, text, fontSize, maxWidth);
    const width = ctx.measureText(text).width;
    ctx.fillText(text, rightEdge - width, y);
}

interface Badge {
    label: string;
    color: string;
}

/**
 * Draws a row of colored badge labels left-to-right, shrinking the shared
 * font size (down to a floor) so any combination of titles a player earns
 * still fits without spilling into the record/KDA column.
 */
function fillBadgeRow(ctx: SKRSContext2D, badges: Badge[], x: number, y: number, maxWidth: number): void {
    if (badges.length === 0) {
        return;
    }

    const gap = 12;
    let size = 18;
    const totalWidth = () => {
        ctx.font = `bold ${size}px Oswald`;
        return badges.reduce((sum, b) => sum + ctx.measureText(b.label).width, 0) + gap * (badges.length - 1);
    };
    while (totalWidth() > maxWidth && size > 11) {
        size -= 1;
    }

    let cursorX = x;
    for (const badge of badges) {
        ctx.fillStyle = badge.color;
        ctx.fillText(badge.label, cursorX, y);
        cursorX += ctx.measureText(badge.label).width + gap;
    }
}

let cachedVersion: string | null = null;

/**
 * Fetches the current Data Dragon patch version, caching it for the
 * lifetime of this function instance to avoid refetching on every row 
 */
async function getDdragonVersion(): Promise<string> {
    if (cachedVersion) {
        return cachedVersion;
    }

    const response = await axios.get<string[]>(
        "https://ddragon.leagueoflegends.com/api/versions.json"
    );

    cachedVersion = response.data[0];
    return cachedVersion;
}

/**
 * Renders a dark, scoreboard-style PNG summarizing each player's stats.
 * Returns a PNG buffer ready to be uploaded as a Discord attachment.
 */
export async function generateStatsCard(rows: StatsCardRow[], title: string): Promise<Buffer> {
    const version = await getDdragonVersion();

    // Preload all champion icons first, since image loading is async
    // but the actual drawiong below needs to happen synchronously in order.
    const iconCache = new Map<string, Awaited<ReturnType<typeof loadImage>> | null>();

    for (const row of rows) {
        if (row.championId && !iconCache.has(row.championId)) {
            try {
                const iconUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${row.championId}.png`
                const image = await loadImage(iconUrl);
                iconCache.set(row.championId, image);
            } catch (error) {
                // Champion name might not match ddragon's internal ID
                // (e.g. Wukong -> MonkeyKing) - fail gracefully, no icon.
                iconCache.set(row.championId, null);
            }
        }
    }

    const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT + PADDING;
    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, WIDTH, height);

    // Header
    ctx.fillStyle = "#e6c88c";
    ctx.font = "bold 40px Oswald";
    ctx.fillText(title, PADDING, 65);

    ctx.fillStyle = "#8b949e";
    ctx.font = "20px Oswald";
    ctx.fillText("Last 7 Days", PADDING, 95);

    // Highest/lowest win rate badges are only drawn from players who actually
    // played a game this week - someone with 0 games hasn't performed, well or badly.
    const playedRows = rows.filter((r) => r.gamesPlayed > 0);

    const topWinRate = playedRows.length > 0
        ? Math.max(...playedRows.map((r) => r.winRate))
        : -1;
    const highestWinRateRowIndex = rows.findIndex(
        (r) => r.gamesPlayed > 0 && r.winRate === topWinRate && r.winRate > 0
    );

    // Skip the lowest win rate badge entirely if everyone tied (e.g. everyone went undefeated).
    const worstWinRate = playedRows.length > 0
        ? Math.min(...playedRows.map((r) => r.winRate))
        : -1;
    const allTied = topWinRate === worstWinRate;
    const lowestWinRateRowIndex = allTied
        ? -1
        : rows.findIndex((r, i) => r.gamesPlayed > 0 && r.winRate === worstWinRate && i !== highestWinRateRowIndex);

    // Ladder Hero goes to whoever earned the most Ladder Points this week -
    // only applies to cards that carry that field (the Rift card), and only
    // if someone actually earned points (nobody gets crowned for a flat 0).
    const rowsWithLadderPoints = rows.filter((r) => r.ladderPoints !== undefined);
    const maxLadderPoints = rowsWithLadderPoints.length > 0
        ? Math.max(...rowsWithLadderPoints.map((r) => r.ladderPoints as number))
        : -1;
    const ladderHeroRowIndex = maxLadderPoints > 0
        ? rows.findIndex((r) => r.ladderPoints === maxLadderPoints)
        : -1;

    // Rows
    rows.forEach((row, index) => {
        const y = HEADER_HEIGHT + index * ROW_HEIGHT;
        const accentColor = row.winRate >= 50 ? "#3fb950" : "#f85149";

        // Row background - Ladder Hero takes visual priority since it's the
        // headline title, then highest/lowest win rate, then the normal stripe.
        const isLadderHero = index === ladderHeroRowIndex;
        const isHighestWinRate = index === highestWinRateRowIndex;
        const isLowestWinRate = index === lowestWinRateRowIndex;
        ctx.fillStyle = isLadderHero
            ? "#241a33"
            : isHighestWinRate
            ? "#2d2411"
            : isLowestWinRate
            ? "#2d1111"
            : index % 2 === 0
            ? "#161b22"
            : "#0d1117";
        ctx.fillRect(PADDING, y, WIDTH - PADDING * 2, ROW_HEIGHT - 10)

        // Accent bar
        ctx.fillStyle = isLadderHero
            ? "#d2a8ff"
            : isHighestWinRate
            ? "#ffd700"
            : isLowestWinRate
            ? "#ff4444"
            : accentColor;
        ctx.fillRect(PADDING, y, 6, ROW_HEIGHT - 10);

        // Champion Icon
        const icon = row.championId ? iconCache.get(row.championId) : null;
        if (icon) {
            const iconSize = 64;
            const iconY = y + (ROW_HEIGHT - 10 - iconSize) / 2;
            ctx.drawImage(icon, WIDTH - PADDING - 20 - iconSize, iconY, iconSize, iconSize);
        }

        // Name
        ctx.fillStyle = "#f0f6fc";
        ctx.font = "bold 26px Oswald";
        ctx.fillText(row.discordName, PADDING + 30, y + 35);

        // Status label
        ctx.fillStyle = "#8b949e";
        ctx.font = "16px Oswald";
        ctx.fillText(row.statusLabel, PADDING + 30, y + 60);

        // Badges (a player can hold more than one title at once, e.g. Ladder
        // Hero and Highest Win Rate) - drawn on their own line so they never
        // have to compete with the name for space.
        const badges: Badge[] = [];
        if (isLadderHero) {
            badges.push({ label: "LADDER HERO", color: "#d2a8ff" });
        }
        if (isHighestWinRate) {
            badges.push({ label: "HIGHEST WIN RATE", color: "#ffd700" });
        }
        if (isLowestWinRate) {
            badges.push({ label: "LOWEST WIN RATE", color: "#ff4444" });
        }
        fillBadgeRow(ctx, badges, PADDING + 30, y + 90, 300);

        // Record + win rate
        ctx.fillStyle = accentColor;
        fillTextLeftAligned(ctx, `${row.record} (${row.winRate}%)`, PADDING + 350, y + 40, 24, LEFT_COL_MAX_WIDTH);

        // KDA
        ctx.fillStyle = "#c9d1d9";
        fillTextLeftAligned(ctx, `KDA: ${row.kda}`, PADDING + 350, y + 70, 20, LEFT_COL_MAX_WIDTH);

        // Ladder Points (ranked play only - absent for ARAM rows)
        if (row.ladderPoints !== undefined) {
            ctx.fillStyle = "#e6c88c";
            fillTextLeftAligned(
                ctx,
                `Ladder Points: ${row.ladderPoints}`,
                PADDING + 350,
                y + 96,
                18,
                LEFT_COL_MAX_WIDTH
            );
        }

        // Rank + champion (right-aligned, shifted left if there's an icon,
        // font auto-shrinks per line so long strings can't grow into the
        // record/KDA column)
        const rightEdge = icon ? WIDTH - PADDING - 20 - 64 - 15 : WIDTH - PADDING - 20;
        ctx.fillStyle = "#e6c88c";
        if (row.rankLabel) {
            fillTextRightAligned(ctx, row.rankLabel, rightEdge, y + 35, 18, RIGHT_COL_MAX_WIDTH);
            fillTextRightAligned(ctx, row.championLabel, rightEdge, y + 60, 18, RIGHT_COL_MAX_WIDTH);
        } else {
            fillTextRightAligned(ctx, row.championLabel, rightEdge, y + 50, 20, RIGHT_COL_MAX_WIDTH);
        }
    });

    return canvas.toBuffer("image/png")
}