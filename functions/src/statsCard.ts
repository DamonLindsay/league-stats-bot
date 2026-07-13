import { createCanvas } from "@napi-rs/canvas"

export interface StatsCardRow {
    discordName: string;
    statusLabel: string; // e.g. "RANKED SOLO/DUO" or "LAST 7 DAYS"
    record: string; // e.g. "4W - 6L"
    winRate: number; // 0-100, drives the accent color
    kda: string; // e.g. "9-0 / 4.1 / 6.4"
    highlight: string; //e.g. "GOLD II - 45 LP" or "Most played: Nasus"
}

const WIDTH = 1000;
const HEADER_HEIGHT = 130;
const ROW_HEIGHT = 100;
const PADDING = 30;

/**
 * Renders a dark, scoreboard-style PNG summarizing each player's stats.
 * Returns a PNG buffer ready to be uploaded as a Discord attachment.
 */

export function generateStatsCard(rows: StatsCardRow[]): Buffer {
    const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT + PADDING;
    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, WIDTH, height);

    // Header
    ctx.fillStyle = "#e6c88c";
    ctx.font = "bold 40px sans-serif";
    ctx.fillText("WEEKLY LEAGUE REPORT", PADDING, 65);

    ctx.fillStyle = "#8b949e";
    ctx.font = "20px sans-serif";
    ctx.fillText("Last 7 Days", PADDING, 95);

    // Rows
    rows.forEach((row, index) => {
        const y = HEADER_HEIGHT + index * ROW_HEIGHT;
        const accentColor = row.winRate >= 50 ? "#3fb950" : "#f85149";

        // Row background
        ctx.fillStyle = index % 2 === 0 ? "#161b22" : "#0d1117";
        ctx.fillRect(PADDING, y, WIDTH - PADDING * 2, ROW_HEIGHT - 10);

        // Accent bar
        ctx.fillStyle = accentColor;
        ctx.fillRect(PADDING, y, 6, ROW_HEIGHT - 10);

        // Name
        ctx.fillStyle = "#f0f6fc";
        ctx.font = "bold 26px sans-serif";
        ctx.fillText(row.discordName, PADDING + 30, y + 35);

        // Status label
        ctx.fillStyle = "#8b949e";
        ctx.font = "16px sans-serif";
        ctx.fillText(row.statusLabel, PADDING + 30, y + 60);

        // Record + win rate
        ctx.fillStyle = accentColor;
        ctx.font = "bold 24px sans-serif";
        ctx.fillText(`${row.record} (${row.winRate}%)`, PADDING + 350, y + 40);

        // KDA
        ctx.fillStyle = "#c9d1d9";
        ctx.font = "20px sans-serif";
        ctx.fillText(`KDA: ${row.kda}`, PADDING + 350, y + 70);

        //Highlight (right-aligned)
        ctx.fillStyle = "#e6c88c";
        ctx.font = "bold 20px sans-serif";
        const highlightWidth = ctx.measureText(row.highlight).width;
        ctx.fillText(row.highlight, WIDTH - PADDING - 20 - highlightWidth, y + 50);
    });

    return canvas.toBuffer("image/png")
}