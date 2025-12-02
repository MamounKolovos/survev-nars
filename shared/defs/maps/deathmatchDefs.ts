import { util } from "../../utils/util";
import type { MapDef } from "../mapDefs";
import { MapId } from "../types/misc";
import { Main, type PartialMapDef } from "./baseDefs";

const mapDef: PartialMapDef = {
    mapId: MapId.Deathmatch,
    desc: {
        name: "Deathmatch",
    },
    /* STRIP_FROM_PROD_CLIENT:START */
    gameConfig: {
        planes: {
            timings: [],
            crates: [],
        },
    },
    mapGen: {
        map: {
            baseWidth: 400,
            baseHeight: 400,
            rivers: {
                lakes: [],
                weights: [{ weight: 1, widths: [] }],
                smoothness: 0.45,
                spawnCabins: true,
                masks: [],
            },
        },
    },
    gameMode: { sniperMode: true },
    /* STRIP_FROM_PROD_CLIENT:END */
};

export const Deathmatch = util.mergeDeep({}, Main, mapDef) as MapDef;
