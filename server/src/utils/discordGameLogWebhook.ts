/**
 * Match-end logs for Discord: builds an embed payload and POSTs to a webhook URL.
 * Kept separate from {@link logErrorToWebhook} so game logs stay optional, use a
 * different channel, and can evolve (embeds vs plain content) without mixing concerns.
 */
import { TeamMode } from "../../../shared/gameConfig";
import { hashIp } from "./ipHash";

/** Same as mock auth placeholder in `api/routes/user/auth/mock.ts` */
const MOCK_AUTH_ID = "MOCK_USER_ID";
import { fetchApiServer } from "./serverHelpers";

export type GameLogPlayerRow = {
    username: string;
    userId: string | null;
    teamId: number;
    rank: number;
    kills: number;
    damageDealt: number;
    damageTaken: number;
    timeAlive: number;
    ip: string;
};

type UserLogInfo = {
    id: string;
    authId: string;
    linkedDiscord: boolean;
    linkedGoogle: boolean;
};

function formatStatsLine(p: GameLogPlayerRow): string {
    return `(${p.kills} Kills - ${p.damageDealt} Dmg Dealt - ${p.damageTaken} Dmg Taken - ${p.timeAlive}s Alive - Rank ${p.rank})`;
}

function formatAccountLine(p: GameLogPlayerRow, info: UserLogInfo | undefined): string {
    if (!p.userId) {
        return `**Account:** Guest`;
    }
    if (!info) {
        return `**Account:** \`${p.userId.slice(0, 12)}…\` (lookup failed)`;
    }
    if (info.authId === MOCK_AUTH_ID) {
        return `**Account:** Mock`;
    }
    if (info.linkedDiscord && info.authId) {
        return `**Discord:** <@${info.authId}>`;
    }
    if (info.linkedGoogle) {
        return `**Account:** Google`;
    }
    return `**Account:** \`${p.userId.slice(0, 12)}…\``;
}

function collectDiscordMentionIds(
    players: GameLogPlayerRow[],
    userMap: Map<string, UserLogInfo>,
): string[] {
    const ids = new Set<string>();
    for (const p of players) {
        if (!p.userId) continue;
        const u = userMap.get(p.userId);
        if (u?.linkedDiscord && u.authId && u.authId !== MOCK_AUTH_ID) {
            ids.add(u.authId);
        }
    }
    return [...ids];
}

async function fetchUserMap(
    userIds: (string | null)[],
): Promise<Map<string, UserLogInfo>> {
    const unique = [...new Set(userIds.filter((x): x is string => !!x?.length))];
    const out = new Map<string, UserLogInfo>();
    if (!unique.length) {
        return out;
    }

    const res = await fetchApiServer<{ userIds: string[] }, { users: UserLogInfo[] }>(
        "private/game_log_users",
        { userIds: unique },
    );
    if (!res?.users) {
        return out;
    }
    for (const u of res.users) {
        out.set(u.id, u);
    }
    return out;
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
    userMap: Map<string, UserLogInfo>,
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
            lines.push(
                formatAccountLine(p, p.userId ? userMap.get(p.userId) : undefined),
            );
            lines.push(`**IP hash:** \`${hashIp(p.ip)}\``);
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
            lines.push(
                formatAccountLine(p, p.userId ? userMap.get(p.userId) : undefined),
            );
            lines.push(`**IP hash:** \`${hashIp(p.ip)}\``);
            lines.push(`*${formatStatsLine(p)}*`);
            lines.push("");
        }
    }

    return lines.join("\n").trimEnd();
}

/**
 * Resolves OAuth-linked Discord IDs from the API, hashes IPs (same as moderation ip_logs),
 * fire-and-forget safe: catches errors and does not throw.
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

    let userMap = new Map<string, UserLogInfo>();
    try {
        userMap = await fetchUserMap(players.map((p) => p.userId));
    } catch {
        userMap = new Map();
    }

    const embed = {
        title: buildEmbedTitle(teamMode, players),
        description: buildEmbedDescription(
            mapName,
            region,
            teamCount,
            teamMode,
            players,
            userMap,
        ),
        color: 0x3498db,
        footer: {
            text: `Game ID: ${gameId}`,
        },
    };

    const mentionIds = collectDiscordMentionIds(players, userMap);
    const body: Record<string, unknown> = {
        embeds: [embed],
    };
    if (mentionIds.length > 0) {
        body.allowed_mentions = { users: mentionIds };
    }

    try {
        await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(8000),
        });
    } catch (err) {
        console.error("Failed to send game log to Discord webhook", err);
    }
}
