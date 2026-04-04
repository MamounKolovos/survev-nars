/**
 * Match-end logs for Discord: builds an embed payload and POSTs to a webhook URL.
 * Kept separate from {@link logErrorToWebhook} so game logs stay optional, use a
 * different channel, and can evolve (embeds vs plain content) without mixing concerns.
 */
import { TeamMode } from "../../../shared/gameConfig";

export type GameLogPlayerRow = {
    username: string;
    userId: string | null;
    teamId: number;
    rank: number;
    kills: number;
    damageDealt: number;
    damageTaken: number;
    timeAlive: number;
};

function formatStatsLine(p: GameLogPlayerRow): string {
    return `(${p.kills} Kills - ${p.damageDealt} Dmg Dealt - ${p.damageTaken} Dmg Taken - ${p.timeAlive}s Alive - Rank ${p.rank})`;
}

function buildEmbedTitle(teamMode: TeamMode, players: GameLogPlayerRow[]): string {
    const winner = players.find((p) => p.rank === 1);
    if (!winner) {
        return "Match ended";
    }
    if (teamMode === TeamMode.Solo) {
        return `${winner.username} Won The Round`;
    }
    return `TEAM ${winner.teamId + 1} Won The Round`;
}

function buildEmbedDescription(
    mapName: string,
    region: string,
    teamCount: number,
    teamMode: TeamMode,
    players: GameLogPlayerRow[],
): string {
    const lines: string[] = [
        `Map: **${mapName}**`,
        `Region: **${region}**`,
        `Teams in Lobby: **${teamCount}**`,
        "",
    ];

    if (teamMode === TeamMode.Solo) {
        const sorted = [...players].sort((a, b) => a.rank - b.rank);
        for (const p of sorted) {
            lines.push(`**${p.username}**${p.rank === 1 ? " 🏆" : ""}`);
            lines.push(`**IGN:** ${p.username}`);
            lines.push(`**Discord:** ${p.userId ? p.username : "Guest"}`);
            lines.push(`*${formatStatsLine(p)}*`);
            lines.push("");
        }
        return lines.join("\n").trimEnd();
    }

    const teamIds = [...new Set(players.map((p) => p.teamId))].sort((a, b) => a - b);

    for (const teamId of teamIds) {
        const teamPlayers = players.filter((p) => p.teamId === teamId);
        const teamRank = Math.min(...teamPlayers.map((p) => p.rank));
        const isWinner = teamRank === 1;
        const label = `TEAM ${teamId + 1}${isWinner ? " 🏆" : ""}`;
        lines.push(`**${label}**`);
        for (const p of teamPlayers) {
            lines.push(`**IGN:** ${p.username}`);
            lines.push(`**Discord:** ${p.userId ? p.username : "Guest"}`);
            lines.push(`*${formatStatsLine(p)}*`);
            lines.push("");
        }
    }

    return lines.join("\n").trimEnd();
}

/**
 * Fire-and-forget safe: catches errors and does not throw.
 */
export async function sendGameEndDiscordLog(
    webhookUrl: string | undefined,
    args: {
        gameId: string;
        mapName: string;
        region: string;
        teamMode: TeamMode;
        players: GameLogPlayerRow[];
    },
): Promise<void> {
    if (!webhookUrl) {
        return;
    }

    const { gameId, mapName, region, teamMode, players } = args;
    if (players.length < 2) {
        return;
    }

    const teamCount = new Set(players.map((p) => p.teamId)).size;

    const embed = {
        title: buildEmbedTitle(teamMode, players),
        description: buildEmbedDescription(mapName, region, teamCount, teamMode, players),
        color: 0x3498db,
        footer: {
            text: `Game ID: ${gameId}`,
        },
    };

    try {
        await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                embeds: [embed],
            }),
            signal: AbortSignal.timeout(8000),
        });
    } catch (err) {
        console.error("Failed to send game log to Discord webhook", err);
    }
}
