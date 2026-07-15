import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
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
    highlight: string; //e.g. "GOLD II - 45 LP" or "Most played: Nasus"
    championId?: string; // e.g. "Nasus" - used to fetch the champion icon
}

const WIDTH = 1000;
const HEADER_HEIGHT = 130;
const ROW_HEIGHT = 100;
const PADDING = 30;

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

    // Find the top performer by win rate, to highlight on the card.
    const topWinRate = Math.max(...rows.map((r) => r.winRate));
    const topRowIndex = rows.findIndex((r) => r.winRate === topWinRate && r.winRate > 0);

    // Find the worst performer by win rate, to highlight on the card.
    // Skip entirely if everyone tied (e.g. everyone went undefeated).
    const worstWinRate = Math.min(...rows.map((r) => r.winRate));
    const allTied = topWinRate === worstWinRate;
    const worstRowIndex = allTied
        ? -1
        : rows.findIndex((r, i) => r.winRate === worstWinRate && i !== topRowIndex);

    // Rows
    rows.forEach((row, index) => {
        const y = HEADER_HEIGHT + index * ROW_HEIGHT;
        const accentColor = row.winRate >= 50 ? "#3fb950" : "#f85149";

        // Row background
        const isTopPerformer = index === topRowIndex;
        const isWorstPerformer = index === worstRowIndex;
        ctx.fillStyle = isTopPerformer
            ? "#2d2411"
            : isWorstPerformer
            ? "#2d1111"
            : index % 2 === 0
            ? "#161b22"
            : "#0d1117";
        ctx.fillRect(PADDING, y, WIDTH - PADDING * 2, ROW_HEIGHT - 10)

        // Accent bar
        ctx.fillStyle = isTopPerformer ? "#ffd700" : isWorstPerformer ? "#ff4444" : accentColor;
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

        if (isTopPerformer) {
            const nameWidth = ctx.measureText(row.discordName).width;
            ctx.fillStyle = "#ffd700";
            ctx.font = "bold 20px Oswald";
            ctx.fillText("TOP PERFORMER", PADDING + 30 + nameWidth + 15, y + 35)
        }

        if (isWorstPerformer) {
            const nameWidth = ctx.measureText(row.discordName).width;
            ctx.fillStyle = "#ff4444";
            ctx.font = "bold 20px Oswald";
            ctx.fillText("WORST PERFORMER", PADDING + 30 + nameWidth + 15, y + 35)
        }

        // Status label
        ctx.fillStyle = "#8b949e";
        ctx.font = "16px Oswald";
        ctx.fillText(row.statusLabel, PADDING + 30, y + 60);

        // Record + win rate
        ctx.fillStyle = accentColor;
        ctx.font = "bold 24px Oswald";
        ctx.fillText(`${row.record} (${row.winRate}%)`, PADDING + 350, y + 40);

        // KDA
        ctx.fillStyle = "#c9d1d9";
        ctx.font = "20px Oswald";
        ctx.fillText(`KDA: ${row.kda}`, PADDING + 350, y + 70);

        //Highlight (right-aligned, shifted left if there's an icon)
        const highlightRightEdge = icon ? WIDTH - PADDING - 20 - 64 - 15: WIDTH - PADDING - 20;
        ctx.fillStyle = "#e6c88c";
        ctx.font = "bold 20px Oswald";
        const highlightWidth = ctx.measureText(row.highlight).width;
        ctx.fillText(row.highlight, highlightRightEdge - highlightWidth, y + 50);
    });

    return canvas.toBuffer("image/png")
}