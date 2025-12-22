import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import { MapId } from "../../../../shared/defs/types/misc";
import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { TimerManager, createSimpleSegment } from "../../utils/pluginUtils";
import type { Player } from "../objects/player";
import { GamePlugin } from "../pluginManager";
import {
    attachCustomGasDamage,
    attachCustomQuickSwitch,
    attachGracePeriod,
    attachLootDisabler,
    attachMovingGas,
    attachTimerManagerUpdate,
} from "./internalUtils";

const GRACE_PERIOD = 5;
const CUSTOM_SWITCH_DELAY = 0.205;

export default class Solos1v1Plugin extends GamePlugin {
    timerManager = new TimerManager();

    override initListeners(): void {
        if (this.game.map.mapId !== MapId.Solos) return;
        if (this.game.teamMode !== 1) return;

        attachTimerManagerUpdate(this);

        attachGracePeriod(this, GRACE_PERIOD, GRACE_PERIOD, GRACE_PERIOD);

        attachLootDisabler(this);

        attachCustomQuickSwitch(this, CUSTOM_SWITCH_DELAY);

        attachCustomGasDamage(
            this,
            (dmg: number, sec: number, stage: number) =>
                dmg * (1 + Math.min(sec, 20) / 10),
        );

        attachMovingGas(this, {
            firstMovingZone: 4,
            stationaryZoneRadiusMultiplier: 0.55,
            movingZoneRadiusMultiplier: 0.8,
            damages: [5, 5, 5, 10],
            initWaitTime: 100,
            minWaitTime: 20,
            waitTimeDecrement: 20,
            initMovingTime: 30,
            minMovingTime: 15,
            movingTimeDecrement: 5,
            movingZoneOffset: 1,
            minRadius: 10,
        });

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
                this.game.playerBarn.addKillFeedLine(event.data.player.__id, [
                    createSimpleSegment(
                        `${params.source.name} had ${Math.round(params.source.health)} health remaining`,
                        "white",
                    ),
                ]);
                makeReady(params.source);
            }
        });
        this.on("playerWasRevived", (event) => {
            makeReady(event.data.player);
        });

        this.on("gameStarted", (event) => {
            for (const p of this.game.playerBarn.livingPlayers) {
                if (p.disconnected) {
                    continue;
                }
                this.game.playerBarn.addKillFeedLine(-1, [
                    createSimpleSegment(`${p.name} is in the game`, "white"),
                ]);
                this.game.playerBarn.addMapPing("ping_woodsking", p.pos);
            }
        });

        this.on("playerDidJoin", (event) => {
            const player = event.data.player;
            player.weapons[3].type = "frag";
            player.inventory["bandage"] = 99;
            player.inventory["soda"] = 99;
            player.inventory["painkiller"] = 99;
            player.inventory["healthkit"] = 15;
            player.inventory["frag"] = 3;
            player.inventory["impulse"] = 99;
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

            const floorLoot = [
                "mac10",
                "mp5",
                "m39",
                "l86",
                "ot38_dual",
                "mp220",
                "m1014",
                "spas12",
                "m870",
                "mosin",
                "model94",
                "model94",
                "scout_elite",
                "sv98",
                "sv98",
                "blr",
                "blr",
                "garand",
                "garand",
                "pkp",
                "m249",
                "qbb97",
                "dp28",
                "m4a1",
                "scorpion",
                "grozas",
                "ak47",
                "hk416",
                "scar",
                "mk12",
                "deagle_dual",
                "famas",
                "an94",
                "bar",
                "p30l_dual",
                "vector",
                "m9_dual",
                "saiga",
                "chest01",
                "helmet01",
                "helmet02",
                "impulse_gloves",
            ];
            for (const g of floorLoot) {
                player.game.lootBarn.addLootWithoutAmmo(g, player.pos, player.layer, 1);
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

    if (p.inventory["frag"] === 0) {
        p.weapons[3].type = "frag";
    }
    p.inventory["frag"] = 3;
    p.inventory["impulse"] = 99;

    p.weapsDirty = true;
    p.inventoryDirty = true;
    p.boostDirty = true;
    p.healthDirty = true;
}
