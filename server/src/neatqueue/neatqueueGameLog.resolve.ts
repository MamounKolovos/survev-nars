import type { NeatQueueGameLogConfig } from "../../../configType";
import { Config } from "../config";
import {
    type NeatQueueMatchEval,
    discordIdsFromNeatHistoryTeams,
    discordIdsFromNeatPlayerList,
    evaluateNeatQueueRoster,
} from "./neatqueueGameLog.match";

export type NeatQueueMatchInfo = {
    gameNum: number;
    guildId: string;
    source: "active" | "history";
    stage?: string;
    queueName?: string;
};

type NeatMatchPayload = {
    guild_id?: string;
    game_num?: number;
    stage?: string;
    players?: Array<{ id?: string | null }>;
};

type NeatHistoryEntry = {
    game?: string;
    time?: string;
    teams?: Array<Array<{ id?: string | null }>>;
    game_num?: number;
    guild_id?: string;
};

type Cand = {
    info: NeatQueueMatchInfo;
    eval: NeatQueueMatchEval;
    timeDeltaMs: number;
};

function isBetter(a: Cand, b: Cand): boolean {
    if (a.eval.overlap !== b.eval.overlap) return a.eval.overlap > b.eval.overlap;
    if (a.eval.extras !== b.eval.extras) return a.eval.extras < b.eval.extras;
    return a.timeDeltaMs < b.timeDeltaMs;
}

/**
 * NeatQueue history `time` is often `YYYY-MM-DD HH:MM:SS` with no timezone.
 * Use whichever interpretation (UTC vs local) is closer to `gameEndedAtMs`.
 */
export function parseNeatHistoryTimeBestDelta(
    time: string,
    gameEndedAtMs: number,
): { deltaMs: number } | null {
    const m = time.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    const h = +m[4];
    const mi = +m[5];
    const s = +m[6];
    const utcMs = Date.UTC(y, mo - 1, d, h, mi, s);
    const localMs = new Date(y, mo - 1, d, h, mi, s).getTime();
    const deltaMs = Math.min(
        Math.abs(utcMs - gameEndedAtMs),
        Math.abs(localMs - gameEndedAtMs),
    );
    return { deltaMs };
}

function buildNeatHistoryUrl(
    cfg: NeatQueueGameLogConfig,
    base: string,
    guildId: string,
    gameDiscordIds: Set<string>,
    gameEndedAtMs: number,
    applyServerFilters: boolean,
): string {
    const url = new URL(`${base}/api/v1/history/${encodeURIComponent(guildId)}`);
    url.searchParams.set("page", String(cfg.historyPage));
    url.searchParams.set("page_size", String(cfg.historyPageSize));
    url.searchParams.set("limit", String(cfg.historyLimit));
    url.searchParams.set("order", cfg.historyOrder);

    if (!applyServerFilters) {
        return url.toString();
    }

    if (cfg.historyFilterByPlayerIds !== false) {
        for (const id of gameDiscordIds) {
            if (/^\d{17,20}$/.test(id)) {
                url.searchParams.append("player_id", id);
            }
        }
    }

    if (cfg.historyFilterByDateRange !== false) {
        const start = new Date(gameEndedAtMs - cfg.historyDateRangeLookbackMs);
        const end = new Date(gameEndedAtMs + cfg.historyDateRangeEndBufferMs);
        url.searchParams.set("start_date", start.toISOString());
        url.searchParams.set("end_date", end.toISOString());
    }

    return url.toString();
}

async function fetchJson<T>(
    url: string,
    timeoutMs: number,
    label: string,
): Promise<T | undefined> {
    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
            if (Config.logging.debugLogs) {
                console.warn(
                    `[NeatQueue game log] ${label} HTTP ${res.status} ${res.statusText}`,
                );
            }
            return undefined;
        }
        return (await res.json()) as T;
    } catch (e) {
        if (Config.logging.debugLogs) {
            console.warn(`[NeatQueue game log] ${label} fetch error`, e);
        }
        return undefined;
    }
}

export type NeatQueueUserStub = {
    linkedDiscord: boolean;
    authId: string;
};

export function collectGameDiscordIdsForNeatQueue(
    players: Array<{ userId: string | null }>,
    userMap: Map<string, NeatQueueUserStub>,
    mockAuthId: string,
): Set<string> {
    const ids = new Set<string>();
    for (const p of players) {
        if (!p.userId) continue;
        const u = userMap.get(p.userId);
        if (u?.linkedDiscord && u.authId && u.authId !== mockAuthId) {
            ids.add(u.authId);
        }
    }
    return ids;
}

/**
 * Best-effort NeatQueue row for the ended game; returns undefined if disabled, no guild id,
 * too few linked Discord accounts, or no roster passes the overlap / extras rules.
 */
export async function resolveNeatQueueForGameLog(
    cfg: NeatQueueGameLogConfig,
    gameDiscordIds: Set<string>,
    gameEndedAtMs: number,
): Promise<NeatQueueMatchInfo | undefined> {
    if (!cfg.enabled) return undefined;
    const guildId = cfg.discordGuildId.trim();
    if (!guildId) return undefined;
    if (gameDiscordIds.size < cfg.minLinkedDiscordPlayers) return undefined;

    const base = cfg.baseUrl.replace(/\/$/, "");
    let best: Cand | undefined;

    const matchesUrl = `${base}/api/v1/matches/${encodeURIComponent(guildId)}`;
    const matchesPayload = await fetchJson<Record<string, NeatMatchPayload>>(
        matchesUrl,
        cfg.fetchTimeoutMs,
        "GET /matches",
    );

    if (matchesPayload) {
        const stages = new Set(cfg.activeMatchStages.map((s) => s.toUpperCase()));
        for (const m of Object.values(matchesPayload)) {
            if (m.game_num == null) continue;
            const stage = (m.stage ?? "").toUpperCase();
            if (stages.size > 0 && !stages.has(stage)) continue;

            const roster = discordIdsFromNeatPlayerList(m.players);
            const ev = evaluateNeatQueueRoster(gameDiscordIds, roster, cfg);
            if (!ev.ok) continue;

            const cand: Cand = {
                info: {
                    gameNum: m.game_num,
                    guildId: m.guild_id ?? guildId,
                    source: "active",
                    stage: m.stage,
                },
                eval: ev,
                timeDeltaMs: 0,
            };
            if (!best || isBetter(cand, best)) best = cand;
        }
    }

    const filtersRequested =
        cfg.historyFilterByPlayerIds !== false || cfg.historyFilterByDateRange !== false;

    let historyUrl = buildNeatHistoryUrl(
        cfg,
        base,
        guildId,
        gameDiscordIds,
        gameEndedAtMs,
        true,
    );
    let historyPayload = await fetchJson<{ data?: NeatHistoryEntry[] }>(
        historyUrl,
        cfg.fetchTimeoutMs,
        "GET /history",
    );

    if (
        cfg.historyFallbackIfFilteredEmpty &&
        filtersRequested &&
        !historyPayload?.data?.length
    ) {
        historyUrl = buildNeatHistoryUrl(
            cfg,
            base,
            guildId,
            gameDiscordIds,
            gameEndedAtMs,
            false,
        );
        historyPayload = await fetchJson<{ data?: NeatHistoryEntry[] }>(
            historyUrl,
            cfg.fetchTimeoutMs,
            "GET /history (fallback, no server filters)",
        );
    }

    if (historyPayload?.data) {
        const maxDev = cfg.historyMaxTimeDeviationMs;
        const skipTime = cfg.historySkipTimeMatch === true;
        for (let i = 0; i < historyPayload.data.length; i++) {
            const row = historyPayload.data[i];
            if (row.game_num == null) continue;

            let timeDeltaMs: number;
            if (skipTime) {
                timeDeltaMs = i;
            } else {
                if (!row.time) continue;
                const parsed = parseNeatHistoryTimeBestDelta(row.time, gameEndedAtMs);
                if (parsed == null) continue;
                timeDeltaMs = parsed.deltaMs;
                if (timeDeltaMs > maxDev) continue;
            }

            const roster = discordIdsFromNeatHistoryTeams(row.teams);
            const ev = evaluateNeatQueueRoster(gameDiscordIds, roster, cfg, {
                allowFullRosterSubset: true,
            });
            if (!ev.ok) continue;

            const cand: Cand = {
                info: {
                    gameNum: row.game_num,
                    guildId: row.guild_id ?? guildId,
                    source: "history",
                    queueName: row.game,
                },
                eval: ev,
                timeDeltaMs,
            };
            if (!best || isBetter(cand, best)) best = cand;
        }
    }

    if (!best?.info && cfg.enabled && Config.logging.debugLogs) {
        const m = matchesPayload ? Object.keys(matchesPayload).length : "fetch failed";
        const h = historyPayload?.data?.length ?? "no data";
        console.warn(
            `[NeatQueue game log] no match (guild ${guildId}); linkedDiscord=${gameDiscordIds.size}; activeMatches=${m}; historyRows=${h}`,
        );
    }

    return best?.info;
}
