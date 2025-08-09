import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import type { LootSpawnDef } from "../../../../shared/defs/mapObjectsTyping";
import { MapId } from "../../../../shared/defs/types/misc";
import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { TimerManager } from "../../utils/pluginUtils";
import type { Player } from "../objects/player";
import { GamePlugin } from "../pluginManager";
import {
    attachCustomGasDamage,
    attachCustomQuickSwitch,
    attachDonutSpawner,
    attachGracePeriod,
    attachKillRewards,
    attachLootDisabler,
    attachLootPingNotification,
    attachMovingGas,
    attachObstacleDeathLoot,
    attachTimerManagerUpdate,
    autoLoot,
    tierLoot,
} from "./internalUtils";

const GRACE_PERIOD = 10;
const CUSTOM_SWITCH_DELAY = 0.205;

const obstacleToLoot: Record<string, LootSpawnDef[]> = {
    chest_04: [autoLoot("helmet03_grenadier", 1)],
    case_07: [tierLoot("tier_club_bonus", 1, 1)],
};

export default class MainPlugin extends GamePlugin {
    timerManager = new TimerManager();

    override initListeners(): void {
        if (this.game.map.mapId === MapId.ForcedLoot) return;
        if (this.game.map.mapId === MapId.ForcedLoot2) return;

        attachTimerManagerUpdate(this);

        attachGracePeriod(this, GRACE_PERIOD, GRACE_PERIOD, GRACE_PERIOD);

        attachMovingGas(this, {
            firstMovingZone: 4,
            stationaryZoneRadiusMultiplier: 0.55,
            movingZoneRadiusMultiplier: 0.8,
            damages: this.game.teamMode === 1 ? [5, 5, 5, 10] : [1, 2, 4, 6, 8, 10],
            initWaitTime: 100,
            minWaitTime: 20,
            waitTimeDecrement: 20,
            initMovingTime: 30,
            minMovingTime: 15,
            movingTimeDecrement: 5,
            movingZoneOffset: 1,
            minRadius: 10,
        });

        if (this.game.teamMode !== 2) {
            attachDonutSpawner(this, 0.75, 0.9);
        }

        attachCustomQuickSwitch(this, CUSTOM_SWITCH_DELAY);

        attachKillRewards(this, true, true);

        attachObstacleDeathLoot(this, obstacleToLoot);

        attachCustomGasDamage(
            this,
            (dmg: number, sec: number, stage: number) =>
                dmg * (1 + Math.min(sec, 20) / 10),
        );

        attachLootPingNotification(this, 2, 5);

        if (this.game.teamMode === 1) {
            attachLootDisabler(this);
            this.on("playerDidDie", (event) => {
                const params = event.data.params;
                if (params.source && params.source.__type === ObjectType.Player) {
                    makeReady(params.source);
                }
            });
            this.on("playerGotDowned", (event) => {
                const params = event.data.params;
                if (
                    params.source &&
                    params.source.__type === ObjectType.Player &&
                    params.source !== event.data.player
                ) {
                    makeReady(params.source);
                }
            });
            this.on("playerWasRevived", (event) => {
                makeReady(event.data.player);
            });
        }

        this.on("playerDidJoin", (event) => {
            const player = event.data.player;
            switch (this.game.teamMode) {
                case 4:
                    player.weapons[3].type = "frag";
                    player.inventory["frag"] = 2;
                    player.inventory["snowball"] = 0;
                    player.inventory["bandage"] = 5;
                    player.backpack = "backpack01";
                    break;
                case 2:
                    player.weaponManager.setWeapon(0, "spas12", 6);
                    player.weaponManager.setWeapon(1, "ak47", 30);
                    player.chest = "chest02";
                    player.helmet = "helmet02";
                    player.backpack = "backpack02";

                    player.addPerk("endless_ammo", false);
                    player.inventory["4xscope"] = 1;
                    player.inventory["2xscope"] = 1;
                    player.scope = "4xscope";

                    player.inventory["bandage"] = 5;
                    player.inventory["healthkit"] = 1;
                    player.inventory["soda"] = 2;
                    player.boost = 110;

                    player.weapons[3].type = "frag";
                    player.inventory["frag"] = 2;
                    break;
                case 1:
                    player.weapons[3].type = "frag";
                    player.inventory["bandage"] = 99;
                    player.inventory["soda"] = 99;
                    player.inventory["painkiller"] = 99;
                    player.inventory["healthkit"] = 15;
                    player.inventory["frag"] = 4;
                    player.addPerk("endless_ammo", false);
                    player.addPerk("self_revive", false);

                    player.backpack = "backpack02";
                    player.chest = "chest02";
                    player.helmet = "helmet03";
                    player.inventory["2xscope"] = 1;
                    player.inventory["4xscope"] = 1;
                
                    player.scope = "4xscope";
                    player.boost = 110;

                    player.weaponManager.setWeapon(0, "spas12", 6);
                    player.weaponManager.setWeapon(1, "mosin", 5);

                    const floorguns = [
                        "mac10",
                        "dp28",
                        "p30l_dual",
                        "an94",
                        "ak47",
                        "model94",
                        "garand",
                        "ot38_dual",
                        "saiga",
                        "famas",
                        "m870",
                        "scar",
                        "hk416",
                        "blr",
                        "deagle_dual",
                        "mp220",
                        "mk12",
                        "scout_elite",
                        "m1014"
                    ];
                    for (const g of floorguns) {
                        player.game.lootBarn.addLootWithoutAmmo(
                            g,
                            player.pos,
                            player.layer,
                            1,
                        );
                    }
                    break;
            }
        });
    }
}

function makeReady(p: Player) {
    p.health = 100;
    p.boost = 100;

    if (p.weapons[0].type) {
        p.weapons[0].ammo = (GameObjectDefs[p.weapons[0].type] as GunDef).maxClip;
    }
    if (p.weapons[1].type) {
        p.weapons[1].ammo = (GameObjectDefs[p.weapons[1].type] as GunDef).maxClip;
    }

    p.weapons[3].type = "frag";
    p.inventory["frag"] = 3;

    p.weapsDirty = true;
    p.inventoryDirty = true;
    p.boostDirty = true;
    p.healthDirty = true;
}
