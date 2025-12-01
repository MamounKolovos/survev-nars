import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import type { MeleeDef } from "../../../../shared/defs/gameObjects/meleeDefs";
import { OutfitDefs } from "../../../../shared/defs/gameObjects/outfitDefs";
import type { ThrowableDef } from "../../../../shared/defs/gameObjects/throwableDefs";
import { MapObjectDefs } from "../../../../shared/defs/mapObjectDefs";
import type { LootSpawnDef, ObstacleDef } from "../../../../shared/defs/mapObjectsTyping";
import { DamageType, GameConfig, GasMode } from "../../../../shared/gameConfig";
import * as net from "../../../../shared/net/net";
import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { collider } from "../../../../shared/utils/collider";
import { math } from "../../../../shared/utils/math";
import { assert, util } from "../../../../shared/utils/util";
import { type Vec2, v2 } from "../../../../shared/utils/v2";
import { type TimerManager, createSimpleSegment } from "../../utils/pluginUtils";
import type { Game } from "../game";
import type { GameMap } from "../map";
import type { Gas } from "../objects/gas";
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
    countdownStart: number, //start countdown at x seconds remaining
) {
    assert(canJoinPeriod >= gracePeriod, "canJoinPeriod must be larger than gracePeriod");
    assert(
        countdownStart <= gracePeriod,
        "countdownStart must be smaller than gracePeriod",
    );
    const lastInputs: Map<
        Player,
        {
            touchMoveActive: boolean;
            touchMoveDir: Vec2;
            moveLeft: boolean;
            moveRight: boolean;
            moveUp: boolean;
            moveDown: boolean;
        }
    > = new Map();

    const restoreInputs = () => {
        for (const [player, msg] of lastInputs) {
            player.touchMoveActive = msg.touchMoveActive;
            player.touchMoveDir = msg.touchMoveDir;
            player.moveLeft = msg.moveLeft;
            player.moveRight = msg.moveRight;
            player.moveUp = msg.moveUp;
            player.moveDown = msg.moveDown;
        }
    };

    const gpEndCountdown = () => {
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
    };

    let elapsedTime = 0;
    let countdownScheduled = false;
    let inputsRestored = false;

    plugin.on("gameUpdate", (event, ctx) => {
        const { game, dt } = event.data;
        if (plugin.game.modeManager.aliveCount() <= 1) return;
        elapsedTime += dt;

        if (!countdownScheduled && elapsedTime >= gracePeriod - countdownStart) {
            gpEndCountdown();
            countdownScheduled = true;
        }

        if (!inputsRestored && elapsedTime > gracePeriod) {
            restoreInputs();
            inputsRestored = true;
        }

        if (elapsedTime > canJoinPeriod) {
            ctx.unregister();
        }
    });

    plugin.hook("gmm:isGameStarted", (hookPoint) => {
        return elapsedTime > gracePeriod;
    });

    plugin.hook("game:canJoin", (hookPoint) => {
        const { game } = hookPoint.data;

        return (
            game.aliveCount < game.map.mapDef.gameMode.maxPlayers &&
            !game.over &&
            elapsedTime <= canJoinPeriod
        );
    });

    plugin.on("playerWillInput", (event, ctx) => {
        if (elapsedTime > gracePeriod) {
            ctx.unregister();
            return;
        }
        const { player, msg } = event.data;
        lastInputs.set(player, {
            touchMoveActive: msg.touchMoveActive,
            touchMoveDir: msg.touchMoveDir,
            moveLeft: msg.moveLeft,
            moveRight: msg.moveRight,
            moveUp: msg.moveUp,
            moveDown: msg.moveDown,
        });
        msg.touchMoveActive = false;
        msg.touchMoveDir = v2.create(0, 0);
        msg.moveLeft = false;
        msg.moveRight = false;
        msg.moveUp = false;
        msg.moveDown = false;
    });

    plugin.on("playerWillTakeDamage", (event, ctx) => {
        if (elapsedTime > gracePeriod) {
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
    // prevent obstacles with loot from dropping it
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

        // ensure that player is still holding both weapons (didnt drop one)
        if (curWeapon.type && nextWeapon.type && changeCooldown) {
            const curWeaponDef = GameObjectDefs[player.activeWeapon] as
                | GunDef
                | MeleeDef
                | ThrowableDef;
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

            if (nextWeapon.cooldown < 0) {
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
                    (obj.layer === player.layer ||
                        obj.layer === 2 ||
                        player.layer === 2) &&
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

export function attachCustomGasDamage(
    plugin: GamePlugin,
    damageFunc: (baseDamage: number, seconds: number, stage: number) => number,
) {
    const secondsInZone: Record<number, number> = {};
    plugin.on("gameUpdate", (event) => {
        const { game, dt } = event.data;
        for (const p of game.playerBarn.players) {
            if (game.gas.isInGas(p.pos)) {
                const timeSinceLastDamage =
                    secondsInZone[p.__id] - Math.floor(secondsInZone[p.__id]);
                if (timeSinceLastDamage + dt > 1) {
                    p.damage({
                        damageType: DamageType.Gas,
                        amount: damageFunc(
                            game.gas.damage,
                            secondsInZone[p.__id],
                            game.gas.stage,
                        ),
                        dir: v2.create(1, 0),
                    });
                }
                secondsInZone[p.__id] += dt;
            } else {
                secondsInZone[p.__id] = 0;
            }
        }
    });

    plugin.on("gameCreated", (event) => {
        plugin.game.gas._damageTicker = -999999;
    });
}

export function spawnPlayer(
    player: Player,
    soloProvider: () => () => Vec2,
    groupLeaderProvider: () => () => Vec2,
    groupFollowerProvider: () => () => Vec2,
) {
    const getRandomSpawnPos = (getPos: () => Vec2) =>
        player.game.map.getRandomSpawnPos(getPos, player.group, player.team);

    const getSpawn = () => {
        //solos
        if (!player.group) {
            return getRandomSpawnPos(soloProvider());
        }

        //first player in group to join
        if (player.group.players[0] === player) {
            return getRandomSpawnPos(groupLeaderProvider());
        }

        //2nd, 3rd, or 4th player in group to join
        return getRandomSpawnPos(groupFollowerProvider());
    };

    v2.set(player.pos, getSpawn());
    player.game.grid.updateObject(player);
}

/**
 * Selects a point on a donut-shaped region (annulus) centered at `center` with inner radius `innerRadius` and outer radius `outerRadius`.
 * If `points` is empty, picks a random point on the donut.
 * Otherwise, picks the midpoint between the largest radian diff of adjacent point pairs in the `points` array,
 * with some random angular variance applied (up to `variance` degrees) and radius between `innerRadius` and `outerRadius`.
 */

export function donut(
    center: Vec2,
    innerRadius: number,
    outerRadius: number,
    points: Vec2[],
    variance: number,
): Vec2 {
    const randomRadius = util.random(innerRadius, outerRadius);
    const pointAt = (dir: Vec2) => {
        const randomAngle = util.random(-variance, variance);
        const noisyDir = v2.rotate(dir, math.deg2rad(randomAngle));
        return v2.add(center, v2.mul(noisyDir, randomRadius));
    };

    if (points.length == 0) {
        const dir = v2.randomUnit();
        return pointAt(dir);
    }

    if (points.length == 1) {
        const dir = v2.neg(v2.normalize(v2.sub(points[0], center)));
        return pointAt(dir);
    }

    const rads = points
        .map((p) => {
            const offset = v2.sub(p, center);
            return Math.atan2(offset.y, offset.x);
        })
        .sort((a, b) => a - b);

    let maxRadDiff = -Infinity;
    let startRad = 0;

    const TAU = 2 * Math.PI;
    for (let i = 0; i < rads.length; i++) {
        const j = (i + 1) % rads.length; // wraps to 0 after last point
        const radDiff = (rads[j] - rads[i] + TAU) % TAU;
        if (radDiff > maxRadDiff) {
            maxRadDiff = radDiff;
            startRad = rads[i];
        }
    }

    const midpointRad = (startRad + maxRadDiff / 2) % TAU;
    const dir = math.rad2Direction(midpointRad);
    return pointAt(dir);
}

/**
 * `innerRadiusScale` and `outerRadiusScale` are relative to the spawnable map size
 */
export function attachDonutSpawner(
    plugin: GamePlugin,
    innerRadiusScale: number,
    outerRadiusScale: number,
) {
    plugin.on("playerDidJoin", (event, ctx) => {
        const { player } = event.data;
        const map = plugin.game.map;

        const radius = (map.width - map.shoreInset) / 2;
        const innerRadius = radius * innerRadiusScale;
        const outerRadius = radius * outerRadiusScale;

        spawnPlayer(
            player,
            () => {
                const points = plugin.game.playerBarn.livingPlayers
                    .filter((p) => p != player)
                    .map((p) => p.pos);
                return () => donut(map.center, innerRadius, outerRadius, points, 0);
            },
            () => {
                const enemyGroups = plugin.game.playerBarn.groups.filter(
                    (g) => g != player.group && !g.allDeadOrDisconnected,
                );
                const points = enemyGroups
                    .map((g) => g.livingPlayers[0])
                    .map((p) => p.pos);
                return () => donut(map.center, innerRadius, outerRadius, points, 0);
            },
            () => {
                const rad = GameConfig.player.teammateSpawnRadius;
                const pos = player.group!.spawnPosition!;
                return () => v2.add(pos, util.randomPointInCircle(rad));
            },
        );
    });
}

export function tierLoot(
    tier: string,
    min: number,
    max: number,
    props?: LootSpawnDef["props"],
) {
    props = props || {};
    return {
        tier,
        min,
        max,
        props,
    };
}
export function autoLoot(type: string, count: number, props?: any) {
    props = props || {};
    return { type, count, props };
}

export function attachObstacleDeathLoot(
    plugin: GamePlugin,
    obstacleToLoot: Record<string, LootSpawnDef[]>,
) {
    plugin.on("obstacleDeathAfterEffects", (event, ctx) => {
        const { obstacle, params } = event.data;

        const loot = obstacleToLoot[obstacle.type];
        if (!loot) return;

        const def = MapObjectDefs[obstacle.type] as ObstacleDef;
        const lootPos = v2.copy(obstacle.pos);
        if (def.lootSpawn) {
            v2.set(
                lootPos,
                v2.add(obstacle.pos, v2.rotate(def.lootSpawn.offset, obstacle.rot)),
            );
        }

        for (const lootTierOrItem of loot) {
            if ("tier" in lootTierOrItem) {
                const count = util.randomInt(lootTierOrItem.min!, lootTierOrItem.max!);

                for (let i = 0; i < count; i++) {
                    const items = plugin.game.lootBarn.getLootTable(lootTierOrItem.tier!);

                    for (const item of items) {
                        plugin.game.lootBarn.addLoot(
                            item.name,
                            v2.add(lootPos, v2.mul(v2.randomUnit(), 0.2)),
                            obstacle.layer,
                            item.count,
                            undefined,
                            undefined, // undefined to use default push speed value
                            params.dir,
                            lootTierOrItem.props?.preloadGuns,
                        );
                    }
                }
            } else {
                plugin.game.lootBarn.addLoot(
                    lootTierOrItem.type!,
                    v2.add(lootPos, v2.mul(v2.randomUnit(), 0.2)),
                    obstacle.layer,
                    lootTierOrItem.count!,
                    undefined,
                    undefined,
                    params.dir,
                    lootTierOrItem.props?.preloadGuns,
                );
            }
        }
    });
}

export type CustomGasAdvanceParams = {
    firstMovingZone: number;
    stationaryZoneRadiusMultiplier: number;
    movingZoneRadiusMultiplier: number;
    damages: number[];
    initWaitTime: number;
    minWaitTime: number;
    waitTimeDecrement: number;
    initMovingTime: number;
    minMovingTime: number;
    movingTimeDecrement: number;
    movingZoneOffset: number; //dist from posold to posnew in units of radold
    minRadius: number; //snaps to 0 and closes directly in center when below this
};

export function attachMovingGas(plugin: GamePlugin, params: CustomGasAdvanceParams) {
    plugin.on("gasWillAdvance", (event) => {
        const gas = plugin.game.gas;
        event.cancel();
        customGasAdvance(gas, params);
    });
}

function customGasAdvance(g: Gas, params: CustomGasAdvanceParams) {
    g.stage++;
    g._running = true;

    if (g.stage & 1) {
        g.mode = GasMode.Waiting;
    } else {
        g.mode = GasMode.Moving;
    }

    const isMovingZone = g.circleIdx + 2 >= params.firstMovingZone;

    g.radOld = g.currentRad;
    if (g.mode === GasMode.Waiting) {
        g.radNew =
            g.radOld *
            (isMovingZone
                ? params.movingZoneRadiusMultiplier
                : params.stationaryZoneRadiusMultiplier);
    }
    if (g.radNew < params.minRadius) {
        g.radNew = 0;
    }

    g.duration =
        g.mode === GasMode.Moving
            ? Math.max(
                  params.initMovingTime - params.movingTimeDecrement * g.circleIdx,
                  params.minMovingTime,
              )
            : Math.max(
                  params.initWaitTime - params.waitTimeDecrement * (g.circleIdx + 1),
                  params.minWaitTime,
              );

    if (g.radOld === 0) {
        g._running = false;
    }

    g.damage =
        params.damages[Math.max(0, Math.min(params.damages.length - 1, g.circleIdx))];

    const circleIdxOld = g.circleIdx;

    if (g.mode === GasMode.Waiting) {
        g.posOld = v2.copy(g.posNew);

        if (g.radNew === 0) {
            g.posNew = g.posNew;
        } else if (!isMovingZone) {
            g.posNew = v2.add(g.posNew, util.randomPointInCircle(g.radOld - g.radNew));
        } else {
            g.posNew = v2.add(
                g.posNew,
                v2.mul(v2.randomUnit(), g.radOld * params.movingZoneOffset),
            );
        }

        const rad = g.radNew * 0.75; // ensure at least 75% of the safe zone will be inside map bounds
        g.posNew = math.v2Clamp(
            g.posNew,
            v2.create(rad, rad),
            v2.create(g.game.map.width - rad, g.game.map.height - rad),
        );

        g.currentPos = g.posOld;
        g.currentRad = g.radOld;
        g.circleIdx++;
    }

    if (g.circleIdx !== circleIdxOld) {
        if (g.game.map.factionMode) {
            if (g.circleIdx == 1) {
                const red = g.game.playerBarn.teams[0];
                const blue = g.game.playerBarn.teams[1];
                red.highestAliveCount = red.livingPlayers.length;
                blue.highestAliveCount = blue.livingPlayers.length;
            }
            g.handleSpecialAirdrop();
        }

        if (g.game.map.mapDef.gameConfig.roles) {
            g.game.playerBarn.scheduleRoleAssignments();
        }

        if (g.game.map.mapDef.gameConfig.unlocks) {
            g.game.map.scheduleUnlocks();
        }

        for (const plane of g.game.map.mapDef.gameConfig.planes.timings) {
            if (plane.circleIdx === g.circleIdx) {
                g.game.planeBarn.schedulePlane(plane.wait, plane.options);
            }
        }
    }

    g._gasTicker = 0;
    g.gasT = 0;
    g.dirty = true;
    g.timeDirty = true;
    g.game.updateData();
}
function getPingLocations(game: Game): Vec2[] {
    let locations: Vec2[] = [];

    for (const team of game.playerBarn.groups) {
        if (team.livingPlayers.length < 1) {
            continue;
        }
        locations.push(util.randomElem(team.livingPlayers).pos);
        for (const player of team.livingPlayers) {
            if (player.damageDealt > 0) {
                return [];
            }
        }
    }
    return locations;
}

export function attachLocationRevealer(
    plugin: GamePlugin & { timerManager: TimerManager },
    delay: number,
) {
    plugin.on("gameStarted", (event) => {
        const id = plugin.timerManager.setInterval(() => {
            const locations = getPingLocations(plugin.game);
            if (locations.length === 0) {
                plugin.timerManager.clearTimer(id);
            }
            for (const pos of locations) {
                if (!pos) {
                    continue;
                }
                plugin.game.playerBarn.addMapPing("ping_woodsking", pos);
            }
        }, delay);
    });
}
