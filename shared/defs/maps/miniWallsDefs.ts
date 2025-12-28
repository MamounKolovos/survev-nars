import { v2 } from "../../utils/v2";
import type { MapDef } from "../mapDefs";
import { MapId } from "../types/misc";

// @NOTE: Entries defined as single-element arrays, like fixedSpawns: [{ }],
// are done this way so that util.mergeDeep(...) will function as expected
// when used by derivative maps.
//
// Arrays are not mergeable, so the derived map will always redefine all
// elements if that property is set.

export const MiniWalls: MapDef = {
    mapId: MapId.MiniWalls,
    desc: { name: "Mini Walls", icon: "", buttonCss: "" },
    assets: {
        audio: [
            { name: "club_music_01", channel: "ambient" },
            { name: "club_music_02", channel: "ambient" },
            { name: "ambient_steam_01", channel: "ambient" },
            { name: "log_11", channel: "sfx" },
            { name: "log_12", channel: "sfx" },
            { name: "snowball_01", channel: "sfx" },
        ],
        // snow because impulses use snowball textures
        atlases: ["gradient", "loadout", "shared", "main", "snow"],
    },
    biome: {
        colors: {
            background: 0x20536e,
            water: 0x3282ab,
            waterRipple: 0xb3f0ff,
            beach: 0xcdb35b,
            riverbank: 0x905e24,
            grass: 0x80af49,
            underground: 0x1b0d03,
            playerSubmerge: 0x2b8ca4,
            playerGhillie: 0x83af50,
        },
        valueAdjust: 1,
        sound: { riverShore: "sand" },
        particles: { camera: "" },
        tracerColors: {},
        airdrop: {
            planeImg: "map-plane-01.img",
            planeSound: "plane_01",
            airdropImg: "map-chute-01.img",
        },
    },
    gameMode: {
        maxPlayers: 80,
        killLeaderEnabled: false,
        factionMode: true,
        factions: 2,
    },
    gameConfig: {
        planes: {
            timings: [],
            crates: [
                { name: "airdrop_crate_01", weight: 10 },
                { name: "airdrop_crate_02", weight: 1 },
            ],
        },
        bagSizes: {},
        bleedDamage: 2,
        bleedDamageMult: 1,
    },
    /* STRIP_FROM_PROD_CLIENT:START */
    // NOTE: this loot table is not the original one so its not accurate
    // ? are guesses based on statistics
    // ! are uncertain data based on leak
    lootTable: {},
    mapGen: {
        map: {
            baseWidth: 400,
            baseHeight: 400,
            scale: { small: 1, large: 1 },
            extension: 0,
            shoreInset: 20,
            grassInset: 20,
            rivers: {
                lakes: [],
                weights: [
                    { weight: 1, widths: [] },
                    // { weight: 0.1, widths: [4] },
                    // { weight: 0.15, widths: [8] },
                    // { weight: 0.25, widths: [8, 4] },
                    // { weight: 0.21, widths: [16] },
                    // { weight: 0.09, widths: [16, 8] },
                    // { weight: 0.2, widths: [16, 8, 4] },
                    // {
                    //     weight: 1e-4,
                    //     widths: [16, 16, 8, 6, 4],
                    // },
                ],
                smoothness: 0.1,
                spawnCabins: false,
                masks: [],
            },
        },
        places: [
            {
                name: ":)",
                pos: v2.create(0.5, 0.5),
            },
        ],
        bridgeTypes: {
            medium: "bridge_md_structure_01",
            large: "bridge_lg_structure_01",
            xlarge: "",
        },
        customSpawnRules: {
            locationSpawns: [
                // {
                //     // type: "club_complex_01",
                //     // pos: v2.create(0.5, 0.5),
                //     // rad: 150,
                //     // retryOnFailure: true,
                // },
            ],
            placeSpawns: [],
        },
        densitySpawns: [
            {
                stone_01: 800,
                barrel_01: 20,
                silo_01: 0,
                crate_01: 0,
                crate_02: 0,
                crate_03: 0,
                bush_01: 0,
                cache_06: 0,
                tree_01: 400,
                hedgehog_01: 0,
                hedgehog_02: 25,
                container_01: 0,
                container_02: 0,
                container_03: 0,
                container_04: 0,
                shack_01: 0,
                outhouse_01: 5,
                loot_tier_1: 0,
                loot_tier_beach: 0,
            },
        ],
        fixedSpawns: [
            {
                // small is spawn count for solos and duos, large is spawn count for squads
                // warehouse_01: 2,
                // // house_red_01: { small: 2, large: 4 },
                // house_red_02: { small: 2, large: 3 },
                // barn_01: { small: 2, large: 2 },
                // barn_02: 1,
                // hut_01: 1,
                // hut_02: 1, // spas hut
                // hut_03: 1, // scout hut
                // shack_03a: 2,
                // shack_03b: { small: 2, large: 3 },
                // greenhouse_01: 1,
                // cache_01: 1,
                // cache_02: 0, // mosin tree
                // cache_07: 1,
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
                // teahouse_complex_01su: {
                //     small: 2,
                //     large: 3,
                // },
                // stone_04: 1,
                // club_complex_01: 1,
            },
        ],
        randomSpawns: [
            {
                spawns: ["mansion_structure_01", "police_01", "bank_01"],
                choose: 0,
            },
        ],
        spawnReplacements: [{}],
        importantSpawns: [],
    },
    /* STRIP_FROM_PROD_CLIENT:END */
};

type DeepPartial<T> = T extends object
    ? {
          [P in keyof T]?: DeepPartial<T[P]>;
      }
    : T;

export type PartialMapDef = DeepPartial<MapDef>;
