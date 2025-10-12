import { util } from "../../utils/util";
import type { MapDef } from "../mapDefs";
import { MapId } from "../types/misc";
import type { PartialMapDef } from "./baseDefs";
import { ForcedLoot } from "./forcedLootDefs";

const mapDef: PartialMapDef = {
    mapId: MapId.ForcedLoot2,
    desc: { name: "Fair Loot", icon: "", buttonCss: "" },
};

export const ForcedLoot2 = util.mergeDeep({}, ForcedLoot, mapDef) as MapDef;
