import type { NeatQueueGameLogConfig } from "../../../configType";

export type NeatQueueMatchEval = {
    ok: boolean;
    overlap: number;
    neatSize: number;
    extras: number;
};

export function discordIdsFromNeatPlayerList(
    players: Array<{ id?: string | null }> | undefined,
): Set<string> {
    const s = new Set<string>();
    if (!players) return s;
    for (const p of players) {
        if (p.id) s.add(p.id);
    }
    return s;
}

export function discordIdsFromNeatHistoryTeams(
    teams: Array<Array<{ id?: string | null }>> | undefined,
): Set<string> {
    const s = new Set<string>();
    if (!teams) return s;
    for (const team of teams) {
        for (const p of team) {
            if (p?.id) s.add(p.id);
        }
    }
    return s;
}

export function evaluateNeatQueueRoster(
    gameDiscordIds: Set<string>,
    neatDiscordIds: Set<string>,
    cfg: NeatQueueGameLogConfig,
    /** History `teams` often list the full queue; active `players` usually does not. */
    options?: { allowFullRosterSubset: boolean },
): NeatQueueMatchEval {
    const neatSize = neatDiscordIds.size;
    if (neatSize < 2) {
        return { ok: false, overlap: 0, neatSize, extras: 0 };
    }

    let overlap = 0;
    for (const id of neatDiscordIds) {
        if (gameDiscordIds.has(id)) overlap++;
    }

    let extras = 0;
    for (const id of gameDiscordIds) {
        if (!neatDiscordIds.has(id)) extras++;
    }
    if (extras > cfg.maxGamePlayersNotOnNeatQueueRoster) {
        return { ok: false, overlap, neatSize, extras };
    }

    const ratio = overlap / neatSize;
    if (ratio + 1e-9 >= cfg.minOverlapRatio) {
        return { ok: true, overlap, neatSize, extras };
    }

    if (options?.allowFullRosterSubset === true) {
        const allLinkedInGameOnNeatRoster =
            gameDiscordIds.size > 0 &&
            [...gameDiscordIds].every((id) => neatDiscordIds.has(id));
        if (allLinkedInGameOnNeatRoster) {
            return { ok: true, overlap, neatSize, extras };
        }
    }

    return { ok: false, overlap, neatSize, extras };
}
