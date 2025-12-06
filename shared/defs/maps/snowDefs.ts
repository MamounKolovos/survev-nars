import { util } from "../../utils/util";
import type { MapDef } from "../mapDefs";
import type { PartialMapDef } from "./baseDefs";

const mapDef: PartialMapDef = {
    assets: {
        audio: [
            { name: "snowball_01", channel: "sfx" },
            { name: "snowball_02", channel: "sfx" },
            { name: "plane_02", channel: "sfx" },
            { name: "bells_01", channel: "ui" },
            { name: "snowball_pickup_01", channel: "ui" },
        ],
        atlases: ["gradient", "loadout", "shared", "snow"],
    },
    biome: {
        colors: {
            background: 0x93639,
            water: 0xc4d51,
            waterRipple: 0xb3f0ff,
            beach: 0xcdb35b,
            riverbank: 0x905e24,
            grass: 0xbdbdbd,
            underground: 0x1b0d03,
            playerSubmerge: 0x2b8ca4,
            playerGhillie: 0xbbbbbb, // surviv never had a snow color for the ghillie at all, i checked, so keeping this value. - Leia
        },
        particles: { camera: "falling_snow_fast" },
        airdrop: {
            planeImg: "map-plane-01x.img",
            planeSound: "plane_02",
            airdropImg: "map-chute-01x.img",
        },
        frozenSprites: ["player-snow-01.img", "player-snow-02.img", "player-snow-03.img"],
    },
    mapGen: {
        spawnReplacements: [
            {
                bank_01: "bank_01x",
                barn_01: "barn_01x",
                bridge_lg_01: "bridge_lg_01x",
                cabin_01: "cabin_01x",
                container_01: "container_01x",
                greenhouse_01: "greenhouse_02",
                house_red_01: "house_red_01x",
                house_red_02: "house_red_02x",
                hut_01: "hut_01x",
                hut_02: "hut_02x",
                mansion_01: "mansion_01x",
                outhouse_01: "outhouse_01x",
                police_01: "police_01x",
                shack_01: "shack_01x",
                shack_02: "shack_02x",
                shack_03a: "shack_03x",
                warehouse_01: "warehouse_01x",
                warehouse_02: "warehouse_02x",
                bush_01: "bush_01x",
                bush_07: "bush_07x",
                chest_03: "chest_03x",
                crate_01: "crate_01x",
                crate_02: "crate_02x",
                stone_01: "stone_01x",
                stone_03: "stone_03x",
                table_01: "table_01x",
                table_02: "table_02x",
                table_03: "table_03x",
                tree_01: "tree_10",
                mil_crate_02: "mil_crate_03",
            },
        ],
    },
    /* STRIP_FROM_PROD_CLIENT:END */
};

export const Snow = util.mergeDeep({}, mapDef) as MapDef;
