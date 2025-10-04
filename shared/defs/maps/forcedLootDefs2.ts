import { util } from "../../utils/util";
import type { MapDef } from "../mapDefs";
import { MapId } from "../types/misc";
import type { PartialMapDef } from "./baseDefs";
import { ForcedLoot } from "./forcedLootDefs";

const mapDef: PartialMapDef = {
    mapId: MapId.ForcedLoot2,
    desc: { name: "Fair Loot", icon: "", buttonCss: "" },
    mapGen: {
        map: {
            baseWidth: 312,
            baseHeight: 312,
            scale: { small: 1.3, large: 1.3 },
            shoreInset: 10,
            grassInset: 10,
            rivers: {
                weights: [
                    { weight: 1, widths: [4] },
                    // { weight: 1, widths: [8] },
                ],
                spawnCabins: true,
            },
        },
        customSpawnRules: {
            locationSpawns: [],
        },
        densitySpawns: [
            {
                stone_01: 700,
                barrel_01: 5,
                silo_01: 3,
                crate_01: 0,
                crate_02: 0,
                crate_03: 0,
                bush_01: 0,
                cache_06: 0,
                tree_01: 200,
                hedgehog_01: 4,
                container_01: 4,
                container_02: 3,
                container_03: 4,
                container_04: 3,
                shack_01: 3,
                outhouse_01: 5,
                loot_tier_1: 0,
                loot_tier_beach: 0,
            },
        ],
    }
};

export const ForcedLoot2 = util.mergeDeep({}, ForcedLoot, mapDef) as MapDef;
        