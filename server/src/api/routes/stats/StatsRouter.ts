import { eq, lt } from "drizzle-orm";
import { Hono } from "hono";
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

StatsRouter.get("/replay/:gameId", databaseEnabledMiddleware, async (c) => {
    const gameId = c.req.param("gameId");

    try {
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
    } catch (e) {
        return c.json({ error: "Invalid game id" }, 400);
    }
});

export async function purgeReplays() {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await db.delete(replaysTable).where(lt(replaysTable.createdAt, oneWeekAgo));
}
