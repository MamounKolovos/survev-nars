import { util } from "../../utils/util";
import { v2 } from "../../utils/v2";
import type { MapDef } from "../mapDefs";
import { MapId } from "../types/misc";
import { Main, type PartialMapDef } from "./baseDefs";

const mapDef: PartialMapDef = {
    mapId: MapId.Solos,
    desc: { name: "Solos", icon: "", buttonCss: "" },
    gameConfig: {
        planes: {
            timings: [],
        },
    },
    mapGen: {
        map: {
            baseWidth: 256,
            baseHeight: 256,
            scale: { small: 1.0, large: 1.0 },
            shoreInset: 10,
            grassInset: 10,
            rivers: {
                weights: [{ weight: 1, widths: [] }],
            },
        },
        customSpawnRules: {
            locationSpawns: [
                {
                    type: "club_complex_01",
                    pos: v2.create(25, 25),
                    retryOnFailure: true,
                },
            ],
        },
        densitySpawns: [
            {
                stone_01: 675,
                /*barrel_01: 5,
                silo_01: 2,
                crate_01: 0,
                crate_02: 0,
                crate_03: 0,
                bush_01: 0,
                cache_06: 0,
                tree_01: 250,
                hedgehog_01: 4,
                container_01: 4,
                container_02: 3,
                container_03: 4,
                container_04: 3,
                shack_01: 3,
                outhouse_01: 5, 
                loot_tier_1: 0,*/
                loot_tier_beach: 0, 
            },
        ],
        fixedSpawns: [
            {
                // warehouse_01: 1,
                // house_red_01: 1,
                house_red_02: 1,
                // barn_01: 1,
                // barn_02: 1,
                // hut_01: 0,
                // hut_02: 0, // spas hut
                // hut_03: 0, // scout hut
                // shack_03a: 2,
                // shack_03b: 2,
                // greenhouse_01: 0,
                // cache_01: 0,
                // cache_02: 0, // mosin tree
                // cache_07: 0,
                // bunker_structure_01: { odds: 0.05 },
                // bunker_structure_02: 1,
                // bunker_structure_03: 1,
                // bunker_structure_04: 1,
                // bunker_structure_05: 1,
                // warehouse_complex_01: 1,
                // chest_01: 1,
                // chest_03: { odds: 0.2 },
                // mil_crate_02: { odds: 0.25 },
                // tree_02: 3,
                // teahouse_complex_01su: 1,
                // stone_04: 0,
                // mansion_structure_01: 1,
                club_complex_01: 1,
            },
        ],
        randomSpawns: [],
    },
};

export const SolosMap = util.mergeDeep({}, Main, mapDef) as MapDef;
