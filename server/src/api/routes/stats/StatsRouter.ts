import { zValidator } from "@hono/zod-validator";
import { eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { databaseEnabledMiddleware } from "../../auth/middleware";
import { db } from "../../db";
import { replaysTable } from "../../db/schema";
import { leaderboardRouter } from "./leaderboard";
import { matchDataRouter } from "./match_data";
import { matchHistoryRouter } from "./match_history";
import { UserStatsRouter } from "./user_stats";

export const StatsRouter = new Hono();

StatsRouter.route("/user_stats", UserStatsRouter);
StatsRouter.route("/match_history", matchHistoryRouter);
StatsRouter.route("/match_data", matchDataRouter);
StatsRouter.route("/leaderboard", leaderboardRouter);

StatsRouter.get(
    "/replay/:gameId/redirect",
    databaseEnabledMiddleware,
    zValidator(
        "param",
        z.object({
            gameId: z.string().uuid(),
        }),
    ),
    async (c) => {
        const { gameId } = c.req.valid("param");

        const replay = await db.query.replaysTable.findFirst({
            where: eq(replaysTable.gameId, gameId),
            columns: {
                version: true,
            },
        });

        if (!replay) {
            return c.json({ error: "No replay exists for that game id" }, 404);
        }

        return c.json({
            url: `https://v${replay.version}.survev-nars.pages.dev/?replay=${gameId}`,
        });
    },
);

StatsRouter.get(
    "/replay/:gameId",
    databaseEnabledMiddleware,
    zValidator(
        "param",
        z.object({
            gameId: z.string().uuid(),
        }),
    ),
    async (c) => {
        const { gameId } = c.req.valid("param");

        const replay = await db.query.replaysTable.findFirst({
            where: eq(replaysTable.gameId, gameId),
            columns: {
                data: true,
            },
        });

        if (!replay) {
            return c.json({ error: "No replay exists for that game id" }, 404);
        }

        c.header("Content-Type", "application/octet-stream");
        return c.body(replay.data);
    },
);

export async function purgeReplays() {
    const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    await db.delete(replaysTable).where(lt(replaysTable.createdAt, threeWeeksAgo));
}
