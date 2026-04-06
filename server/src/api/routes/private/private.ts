import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "../..";
import { saveConfig } from "../../../../../config";
import { GameObjectDefs } from "../../../../../shared/defs/gameObjectDefs";
import { MapDefs } from "../../../../../shared/defs/mapDefs";
import { TeamModeToString } from "../../../../../shared/defs/types/misc";
import { TeamMode } from "../../../../../shared/gameConfig";
import { util } from "../../../../../shared/utils/util";
import { Config, serverConfigPath } from "../../../config";
import { type SaveGameBody, zUpdateRegionBody } from "../../../utils/types";
import { server } from "../../apiServer";
import {
    databaseEnabledMiddleware,
    privateMiddleware,
    validateParams,
} from "../../auth/middleware";
import { getRedisClient } from "../../cache";
import { leaderboardCache } from "../../cache/leaderboard";
import { db } from "../../db";
import {
    type MatchDataTable,
    itemsTable,
    matchDataTable,
    usersTable,
} from "../../db/schema";
import { MOCK_USER_ID } from "../user/auth/mock";
import { ModerationRouter, hashIp, logPlayerIPs } from "./ModerationRouter";

export const PrivateRouter = new Hono<Context>()
    .use(privateMiddleware)
    .route("/moderation", ModerationRouter)
    .post("/update_region", validateParams(zUpdateRegionBody), (c) => {
        const { regionId, data } = c.req.valid("json");

        server.updateRegion(regionId, data);
        return c.json({}, 200);
    })
    .post(
        "/set_game_mode",
        validateParams(
            z.object({
                index: z.number(),
                teamMode: z.nativeEnum(TeamMode).optional(),
                mapName: z.string().optional(),
                enabled: z.boolean().optional(),
            }),
        ),
        (c) => {
            const { index, mapName, teamMode, enabled } = c.req.valid("json");

            if (!MapDefs[mapName as keyof typeof MapDefs]) {
                return c.json({ error: "Invalid map name" }, 400);
            }

            if (!server.modes[index]) {
                return c.json({ error: "Invalid mode index" }, 400);
            }

            server.modes[index] = {
                mapName: (mapName ?? server.modes[index].mapName) as keyof typeof MapDefs,
                teamMode: teamMode ?? server.modes[index].teamMode,
                enabled: enabled ?? server.modes[index].enabled,
            };

            saveConfig(serverConfigPath, {
                modes: server.modes,
            });

            return c.json({}, 200);
        },
    )
    .post(
        "/toggle_captcha",
        validateParams(
            z.object({
                enabled: z.boolean(),
            }),
        ),
        (c) => {
            const { enabled } = c.req.valid("json");

            server.captchaEnabled = enabled;

            saveConfig(serverConfigPath, {
                captchaEnabled: enabled,
            });

            return c.json({ state: enabled }, 200);
        },
    )
    .post("/save_game", databaseEnabledMiddleware, async (c) => {
        const data = (await c.req.json()) as SaveGameBody;

        const matchData = data.matchData;

        if (!matchData.length) {
            return c.json({ error: "Empty match data" }, 400);
        }

        await leaderboardCache.invalidateCache(matchData);

        await db.insert(matchDataTable).values(matchData);
        await logPlayerIPs(matchData);
        server.logger.info(`Saved game data for ${matchData[0].gameId}`);

        await logMatchToDiscord(matchData);

        return c.json({}, 200);
    })
    .post(
        "/give_item",
        databaseEnabledMiddleware,
        validateParams(
            z.object({
                item: z.string(),
                slug: z.string(),
                source: z.string().default("daddy-has-privileges"),
            }),
        ),
        async (c) => {
            const { item, slug, source } = c.req.valid("json");

            const def = GameObjectDefs[item];

            if (!def) {
                return c.json({ error: "Invalid item type" }, 400);
            }

            const userId = await db.query.usersTable.findFirst({
                where: eq(usersTable.slug, slug),
                columns: {
                    id: true,
                },
            });

            if (!userId) {
                return c.json({ error: "User not found" }, 404);
            }

            const existing = await db.query.itemsTable.findFirst({
                where: and(eq(itemsTable.userId, userId.id), eq(itemsTable.type, item)),
                columns: {
                    type: true,
                },
            });

            if (existing) {
                return c.json({ error: "User already has item" }, 400);
            }

            await db.insert(itemsTable).values({
                userId: userId.id,
                type: item,
                source,
                timeAcquired: Date.now(),
            });

            return c.json({ success: true }, 200);
        },
    )
    .post(
        "/remove_item",
        databaseEnabledMiddleware,
        validateParams(
            z.object({
                item: z.string(),
                slug: z.string(),
            }),
        ),
        async (c) => {
            const { item, slug } = c.req.valid("json");

            const user = await db.query.usersTable.findFirst({
                where: eq(usersTable.slug, slug),
                columns: {
                    id: true,
                },
            });

            if (!user) {
                return c.json({ error: "User not found" }, 404);
            }

            await db
                .delete(itemsTable)
                .where(and(eq(itemsTable.userId, user.id), eq(itemsTable.type, item)));

            return c.json({ success: true }, 200);
        },
    )
    .post("/clear_cache", async (c) => {
        const client = await getRedisClient();
        await client.flushAll();
        return c.json({ success: true }, 200);
    })
    .post(
        "/test/insert_game",
        databaseEnabledMiddleware,
        validateParams(
            z.object({
                kills: z.number().catch(1),
            }),
        ),
        async (c) => {
            const data = c.req.valid("json");
            const matchData: MatchDataTable = {
                ...{
                    gameId: crypto.randomUUID(),
                    userId: MOCK_USER_ID,
                    createdAt: new Date(),
                    region: "na",
                    mapId: 0,
                    mapSeed: 9834567801234,
                    username: MOCK_USER_ID,
                    playerId: 9834,
                    teamMode: TeamMode.Solo,
                    teamCount: 4,
                    teamTotal: 25,
                    teamId: 7,
                    timeAlive: 842,
                    rank: 3,
                    died: true,
                    kills: 5,
                    damageDealt: 1247,
                    damageTaken: 862,
                    killerId: 18765,
                    killedIds: [12543, 13587, 14298, 15321, 16754],
                },
                ...data,
            };
            await leaderboardCache.invalidateCache([matchData]);
            await db.insert(matchDataTable).values(matchData);
            return c.json({ success: true }, 200);
        },
    );

type Team = {
    // id: number;
    players: Player[];
    rank: number;
};

type Player = {
    discordId: string;
    slug: string;
    username: string;

    /** ip used to find a game, supports ipv6 */
    apiIpHash: string;
    /** ip used to connect to game server, only supports ipv4 */
    gameIpHash: string;

    kills: number;
    damageDealt: number;
    timeAlive: number;
};

async function logMatchToDiscord(matchData: SaveGameBody["matchData"]): Promise<void> {
    if (
        !Config.matchLoggingWebhook ||
        !Config.secrets.DISCORD_CLIENT_ID ||
        !Config.secrets.DISCORD_SECRET_ID ||
        !matchData.every((p) => typeof p.userId == "string")
    )
        return;

    const userIds = matchData.map((p) => p.userId as string);

    const users = await db.query.usersTable.findMany({
        where: inArray(usersTable.id, userIds),
        columns: { id: true, authId: true, linkedDiscord: true, slug: true },
    });

    if (!users.every((u) => u.linkedDiscord)) return;

    // all players share these fields so it's ok to pull them out like this
    // assuming there's at least one player which is more or less guaranteed
    const gameData = {
        region: matchData[0].region,
        teamMode: matchData[0].teamMode,
        teamTotal: matchData[0].teamTotal,
        gameId: matchData[0].gameId,
        mapId: matchData[0].mapId,
    };

    const idToUser = new Map(users.map((u) => [u.id, u]));
    const idToTeam: Map<number, Team> = new Map();

    for (const playerData of matchData) {
        const userData = idToUser.get(playerData.userId as string)!;

        const player: Player = {
            discordId: userData.authId,
            slug: userData.slug,
            username: playerData.username,
            // rehashing is faster than selecting from ip_logs
            apiIpHash: hashIp(playerData.findGameIp),
            gameIpHash: hashIp(playerData.ip),
            kills: playerData.kills,
            damageDealt: playerData.damageDealt,
            timeAlive: playerData.timeAlive,
        };

        if (!idToTeam.has(playerData.teamId)) {
            idToTeam.set(playerData.teamId, { players: [], rank: playerData.rank });
        }
        idToTeam.get(playerData.teamId)!.players.push(player);
    }

    const teams = [...idToTeam.values()];

    const teamFields = teams.map((team) => {
        const playerBlocks = team.players.map((player) => {
            const minutes = Math.floor(player.timeAlive / 60);
            const secondsRemaining = Math.floor(player.timeAlive % 60)
                .toString()
                .padStart(2, "0");

            const ipDisplay =
                player.apiIpHash == player.gameIpHash
                    ? `ip \`${player.gameIpHash.slice(0, 8)}\``
                    : `api ip \`${player.apiIpHash.slice(0, 8)}\` • game ip \`${player.gameIpHash.slice(0, 8)}\``;

            return (
                `<@${player.discordId}>\n` +
                `┣ ${player.username} / ${player.slug}\n` +
                `┣ ${ipDisplay}\n` +
                `┗ kills \`${player.kills}\` • damage \`${player.damageDealt}\` • survived \`${minutes}:${secondsRemaining}\``
            );
        });

        return {
            name: `Rank #${team.rank}`,
            value: playerBlocks.join("\n"),
            inline: true,
        };
    });

    // much more vibrant color range than a default 0-255 rgb range
    const h = Math.random();
    const s = 0.7 + Math.random() * 0.3;
    const v = 0.8 + Math.random() * 0.2;
    const randomColor = util.rgbToInt(util.hsvToRgb(h, s, v));

    for (let i = 0; i < teamFields.length; i += 8) {
        const page = teamFields
            .slice(i, i + 8)
            .flatMap((field, j, page) =>
                j % 2 == 1 && j != page.length - 1
                    ? [field, { name: "\u200b", value: "\u200b", inline: false }]
                    : [field],
            );

        let embed;
        if (i == 0) {
            const mapName =
                Object.values(MapDefs).find((def) => def.mapId == gameData.mapId)?.desc
                    ?.name ?? "Unknown";
            const teamModeString = TeamModeToString[gameData.teamMode];
            const description =
                `**Region:** ${gameData.region}\n` +
                `**Map:** ${mapName}\n` +
                `**Team Mode:** ${teamModeString}\n` +
                `**Teams in Lobby:** ${gameData.teamTotal}\n`;
            embed = {
                title: "Match Results",
                description,
                color: randomColor,
                fields: page,
                timestamp: new Date().toISOString(),
                footer: { text: `Game ID: ${gameData.gameId}` },
            };
        } else {
            embed = {
                title: "Cont..",
                color: randomColor,
                fields: page,
                timestamp: new Date().toISOString(),
                footer: { text: `Game ID: ${gameData.gameId}` },
            };
        }

        try {
            const res = await fetch(Config.matchLoggingWebhook, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ embeds: [embed] }),
            });

            if (!res.ok) {
                const err = await res.json();
                console.error("Webhook error:", err);
            }
        } catch (err) {
            console.error("Failed to send webhook", err);
        }
    }
}

export type PrivateRouteApp = typeof PrivateRouter;
