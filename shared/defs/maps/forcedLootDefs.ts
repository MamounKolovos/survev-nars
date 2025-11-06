import { GameConfig } from "../../gameConfig";
import { util } from "../../utils/util";
import type { MapDef } from "../mapDefs";
import { MapId } from "../types/misc";
import { Main, type PartialMapDef } from "./baseDefs";

const mapDef: PartialMapDef = {
    mapId: MapId.ForcedLoot,
    desc: { name: "Fair Loot", icon: "", buttonCss: "" },
    gameConfig: {
        planes: {
            timings: [
                {
                    circleIdx: 2,
                    wait: 0,
                    options: { type: GameConfig.Plane.Airdrop },
                },
                {
                    circleIdx: 3,
                    wait: 0,
                    options: { type: GameConfig.Plane.Airdrop },
                },
            ],
        },
    },
    mapGen: {
        map: {
            baseWidth: 256,
            baseHeight: 256,
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
                stone_01: 586,
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
        fixedSpawns: [
            {
                //barn_01: 1,
                // barn_02: 1,
                hut_01: 0,
                hut_02: 0, // spas hut
                hut_03: 0, // scout hut
                shack_03a: 2,
                shack_03b: 2,
                greenhouse_01: 0,
                cache_01: 0,
                cache_02: 0, // mosin tree
                cache_07: 0,
                // bunker_structure_01: { odds: 0.05 },
                //bunker_structure_02: 1,
                // bunker_structure_03: 1,
                // bunker_structure_04: 1,
                // bunker_structure_05: 1,
                // warehouse_complex_01: 1,
                // chest_01: 1,
                // chest_03: { odds: 0.2 },
                // mil_crate_02: { odds: 0.25 },
                // tree_02: 3,
                // teahouse_complex_01su: 1,
                stone_04: 0,
                //mansion_structure_01: 1,
                // club_complex_01: 1,
            },
        ],
        randomSpawns: [
            {
                spawns: ["police_01", "bank_01"],
                choose: 1,
            },
            {
                spawns: [
                    "club_complex_01",
                    "mansion_structure_01",
                    "bunker_structure_02",
                ],
                choose: 2,
            },
            {
                spawns: ["house_red_02", "house_red_01", "saloon_01"],
                choose: 2,
            },
            {
                spawns: ["warehouse_01", "warehouse_02", "barn_01"],
                choose: 2,
            },
            {
                spawns: ["statue_03", "statue_03", "statue_04", "statue_04", "silo_01", "silo_01", "silo_01"],
                choose: 5,
            },
        ],
    },
};

export const ForcedLoot = util.mergeDeep({}, Main, mapDef) as MapDef;
