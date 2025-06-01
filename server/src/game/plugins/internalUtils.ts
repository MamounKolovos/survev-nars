import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import type { MeleeDef } from "../../../../shared/defs/gameObjects/meleeDefs";
import { OutfitDefs } from "../../../../shared/defs/gameObjects/outfitDefs";
import type { ThrowableDef } from "../../../../shared/defs/gameObjects/throwableDefs";
import { MapObjectDefs } from "../../../../shared/defs/mapObjectDefs";
import type { ObstacleDef } from "../../../../shared/defs/mapObjectsTyping";
import { GameConfig } from "../../../../shared/gameConfig";
import * as net from "../../../../shared/net/net";
import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { collider } from "../../../../shared/utils/collider";
import { util } from "../../../../shared/utils/util";
import { v2 } from "../../../../shared/utils/v2";
import { type TimerManager, createSimpleSegment } from "../../utils/pluginUtils";
import type { GameMap } from "../map";
import type { Loot } from "../objects/loot";
import type { Player } from "../objects/player";
import type { GamePlugin } from "../pluginManager";

function setPlayerAnonymous(player: Player) {
    const outfitTypes = Object.entries(OutfitDefs)
        .filter(
            ([type, def]) =>
                !def.noDrop && !def.noDropOnDeath && !def.obstacleType && !def.ghillie,
        )
        .map(([type, def]) => type);
    player.outfit = util.randomElem(outfitTypes);
}

function resizeMap(map: GameMap, widthDelta: number, heightDelta: number) {
    map.width += widthDelta;
    map.height += heightDelta;

    map.msg.width = map.width;
    map.msg.height = map.height;

    map.mapStream.stream.index = 0;
    map.mapStream.serializeMsg(net.MsgType.Map, map.msg);

    for (const player of map.game.playerBarn.players) {
        if (player.disconnected) continue;
        player.sendData(map.mapStream.getBuffer());
    }
}

export function attachGracePeriod(
    plugin: GamePlugin & { timerManager: TimerManager },
    gracePeriod: number,
    canJoinPeriod: number,
) {
    plugin.hook("game:canJoin", (hookPoint) => {
        if (plugin.game.startedTime > canJoinPeriod) return false;

        return hookPoint.original;
    });

    plugin.on("gameStarted", (event, ctx) => {
        const countdownStart = 5; //start countdown at x seconds remaining
        plugin.timerManager.setTimeout(() => {
            plugin.timerManager.countdown(
                countdownStart,
                1,
                (i) => {
                    plugin.game.playerBarn.addKillFeedLine(-1, [
                        createSimpleSegment(`${i} seconds left`, "white"),
                    ]);
                },
                () => {
                    plugin.game.playerBarn.addKillFeedLine(-1, [
                        createSimpleSegment("round started!", "white"),
                    ]);
                },
            );
            ctx.unregister();
        }, gracePeriod - countdownStart);
    });

    const lastInputs: Map<
        Player,
        { moveLeft: boolean; moveRight: boolean; moveUp: boolean; moveDown: boolean }
    > = new Map();
    plugin.on("playerWillInput", (event, ctx) => {
        if (plugin.game.startedTime > gracePeriod) {
            ctx.unregister();
            return;
        }
        const { player, msg } = event.data;
        lastInputs.set(player, {
            moveLeft: msg.moveLeft,
            moveRight: msg.moveRight,
            moveUp: msg.moveUp,
            moveDown: msg.moveDown,
        });
        msg.moveLeft = false;
        msg.moveRight = false;
        msg.moveUp = false;
        msg.moveDown = false;
    });

    plugin.on("gameStarted", (event, ctx) => {
        plugin.timerManager.setTimeout(() => {
            for (const [player, msg] of lastInputs) {
                player.moveLeft = msg.moveLeft;
                player.moveRight = msg.moveRight;
                player.moveUp = msg.moveUp;
                player.moveDown = msg.moveDown;
            }
            ctx.unregister();
        }, gracePeriod);
    });

    plugin.on("playerWillTakeDamage", (event, ctx) => {
        if (plugin.game.startedTime > gracePeriod) {
            ctx.unregister();
            return;
        }
        event.cancel();
        event.stopPropagation();
    });
}

export function attachLootDisabler(plugin: GamePlugin) {
    //destroys spawned loot
    plugin.on("mapCreated", (event, ctx) => {
        for (const loot of plugin.game.lootBarn.loots) {
            loot.destroy();
        }
    });

    //prevent obstacles with loot from dropping it
    plugin.on("obstacleDeathBeforeEffects", (event, ctx) => {
        const { obstacle, params } = event.data;
        const def = MapObjectDefs[obstacle.type] as ObstacleDef;

        if (def.loot.length != 0) {
            event.cancel();
        }
    });
}

export function attachTimerManagerUpdate(
    plugin: GamePlugin & { timerManager: TimerManager },
) {
    plugin.on("gameUpdate", (event, ctx) => {
        const { game, dt } = event.data;
        plugin.timerManager.update(dt);
    });
}

export function attachKillRewards(
    plugin: GamePlugin,
    healthAndBoostReward = true,
    reloadReward = true,
) {
    if (healthAndBoostReward) {
        plugin.on("playerDidDie", (event, ctx) => {
            const { player, params } = event.data;
            if (params.source?.__type !== ObjectType.Player) return;

            const killer = params.source;
            if (killer.group) {
                const groupAliveCount = killer.group.livingPlayers.length;
                const bonus = 25 - groupAliveCount * 5;
                killer.health += bonus;
                killer.boost += bonus;
            } else {
                killer.health += 25;
                killer.boost += 25;
            }
        });
    }

    if (reloadReward) {
        plugin.on("playerDidDie", (event, ctx) => {
            const { player, params } = event.data;
            if (params.source?.__type !== ObjectType.Player) return;

            const killer = params.source;
            for (let i = 0; i < 2; i++) {
                const gun = killer.weapons[i];
                if (!gun.type) continue;
                const gunDef = GameObjectDefs[gun.type] as GunDef;
                const halfClip = Math.ceil(gunDef.maxClip / 2);
                if (gun.ammo < halfClip) {
                    gun.ammo = halfClip;
                    killer.weapsDirty = true;
                }
            }
        });
    }
}

export function attachCustomQuickSwitch(plugin: GamePlugin, customSwitchDelay: number) {
    plugin.on("playerWillSwitchIdx", (event, ctx) => {
        const { player, idx, cancelAction, cancelSlowdown, forceSwitch, changeCooldown } =
            event.data;

        event.cancel();

        const curWeaponDef = GameObjectDefs[player.activeWeapon] as
            | GunDef
            | MeleeDef
            | ThrowableDef;

        const weaponManager = player.weaponManager;

        weaponManager.player.cancelAnim();

        if (cancelSlowdown) {
            weaponManager.player.shotSlowdownTimer = 0;
        }
        weaponManager.bursts.length = 0;
        weaponManager.meleeAttacks.length = 0;
        weaponManager.scheduledReload = false;

        weaponManager.player.recoilTicker = 0;

        const curWeapon = weaponManager.weapons[weaponManager.curWeapIdx];
        const nextWeapon = weaponManager.weapons[idx];
        let effectiveSwitchDelay = 0;

        if (curWeapon.type && nextWeapon.type && changeCooldown) {
            // ensure that player is still holding both weapons (didnt drop one)
            const nextWeaponDef = GameObjectDefs[weaponManager.weapons[idx].type] as
                | GunDef
                | MeleeDef
                | ThrowableDef;

            const swappingToGun = nextWeaponDef.type == "gun";

            effectiveSwitchDelay = customSwitchDelay;

            if (
                swappingToGun &&
                // @ts-expect-error All combinations of non-identical non-zero values (including undefined)
                //                  give NaN or a number not equal to 1, meaning that weaponManager correctly checks
                //                  for two identical non-zero numerical deploy groups
                curWeaponDef.deployGroup / nextWeaponDef.deployGroup === 1
            ) {
                effectiveSwitchDelay = nextWeaponDef.switchDelay;
            }

            if (curWeapon.cooldown < 0) {
                nextWeapon.cooldown = effectiveSwitchDelay;
            }
        }

        weaponManager.lastWeaponIdx = weaponManager.curWeapIdx;
        weaponManager.curWeapIdx = idx;
        if (cancelAction) {
            weaponManager.player.cancelAction();
        }

        weaponManager.player.wearingPan = false;
        if (
            weaponManager.weapons[GameConfig.WeaponSlot.Melee].type === "pan" &&
            weaponManager.activeWeapon !== "pan"
        ) {
            weaponManager.player.wearingPan = true;
        }

        if (
            GameConfig.WeaponType[idx] === "gun" &&
            weaponManager.weapons[idx].ammo == 0
        ) {
            weaponManager.scheduleReload(effectiveSwitchDelay);
        }

        if (idx === weaponManager.curWeapIdx && GameConfig.WeaponSlot[idx] == "gun") {
            weaponManager.offHand = false;
        }

        weaponManager.player.setDirty();
        weaponManager.player.weapsDirty = true;
    });
}

export function attachLootPingNotification(
    plugin: GamePlugin,
    notifCooldown: number,
    maxPingToItemDist: number,
) {
    //key is player id, value is last time a successful item ping notif was sent by said player
    const lastItemPingNotif: Record<number, number> = {};
    plugin.on("pingDidOccur", (event) => {
        const { playerId, pos, type, isPing, itemType } = event.data.ping;
        if (type !== "ping_help") return;
        if (playerId === 0) return;
        if (!pos) return;
        const player = plugin.game.objectRegister.getById(playerId) as Player;
        if (v2.distance(pos, player.pos) > player.zoom) return;
        const currentTime = player.timeAlive;
        if (currentTime - lastItemPingNotif[playerId] < notifCooldown) return;

        const objs = plugin.game.grid
            .intersectCollider(collider.createCircle(pos, maxPingToItemDist))
            .filter(
                (obj): obj is Loot =>
                    obj.__type == ObjectType.Loot &&
                    obj.layer === player.layer &&
                    v2.distance(pos, obj.pos) < maxPingToItemDist,
            );
        if (objs.length === 0) return;

        let minDist = 9999;
        let closestItemType = "";
        for (const obj of objs) {
            const d = v2.distance(obj.pos, pos);
            if (d < minDist) {
                minDist = d;
                closestItemType = obj.type;
            }
        }

        if (!closestItemType) return;
        const itemName = (GameObjectDefs[closestItemType] as GunDef).name;
        const text = `${player.name} pinged a ${itemName}`;
        const segments = [createSimpleSegment(text, "#B4A3FC")];

        plugin.game.playerBarn.addKillFeedLine(player.groupId, segments);
        lastItemPingNotif[playerId] = currentTime;
    });
}
