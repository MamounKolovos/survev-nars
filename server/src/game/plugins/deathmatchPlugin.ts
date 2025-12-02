import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import { MapObjectDefs } from "../../../../shared/defs/mapObjectDefs";
import type { ObstacleDef } from "../../../../shared/defs/mapObjectsTyping";
import { MapId } from "../../../../shared/defs/types/misc";
import { GameConfig, GasMode } from "../../../../shared/gameConfig";
import * as net from "../../../../shared/net/net";
import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { type Collider, coldet } from "../../../../shared/utils/coldet";
import { collider } from "../../../../shared/utils/collider";
import { math } from "../../../../shared/utils/math";
import { assert, util } from "../../../../shared/utils/util";
import { v2 } from "../../../../shared/utils/v2";
import { TimerManager, createSimpleSegment } from "../../utils/pluginUtils";
import type { Game } from "../game";
import type { Player } from "../objects/player";
import { GamePlugin } from "../pluginManager";
import { attachCustomQuickSwitch, attachGracePeriod } from "./internalUtils";

const CUSTOM_SWITCH_DELAY = 0.205;

const GRACE_PERIOD = 10;
const CAN_JOIN_PERIOD = 30;

assert(
    GRACE_PERIOD <= CAN_JOIN_PERIOD,
    "players should be able to join the game while the grace period is still active",
);

// the amount of seconds left in the grace period timer when it shows up in the killfeed
const GRACE_PERIOD_COUNTDOWN_START = 5;

assert(
    GRACE_PERIOD_COUNTDOWN_START <= GRACE_PERIOD,
    "the grace period countdown must appear while the grace period is still active",
);

const RESPAWN_DELAY = 5;

// seconds remaining when respawn countdown begins in the killfeed
const RESPAWN_COUNTDOWN_START = 3;

// how long to wait after a player dies before deleting dead body
const DESTROY_DEAD_BODY_DELAY = 20;

type WinCondition =
    // Game ends when any team reaches this kill count.
    | { kind: "killThreshold"; targetKills: number }
    // Game ends when the timer expires.
    | {
          kind: "timeLimit";
          // Total duration of the round in seconds.
          duration: number;
          // Seconds remaining when the final countdown begins in the killfeed.
          countdownStart: number;
          // Interval, in seconds, between countdown messages shown in the killfeed.
          countdownInterval: number;
      };

// const WIN_CONDITION: WinCondition = { kind: "killThreshold", targetKills: 3 };
const WIN_CONDITION: WinCondition = {
    kind: "timeLimit",
    duration: 60 * 3,
    countdownStart: 30,
    countdownInterval: 10,
};
// const WIN_CONDITION: WinCondition = {
//     kind: "timeLimit",
//     duration: 10,
//     countdownStart: 10,
//     countdownInterval: 1,
// };

if (WIN_CONDITION.kind == "timeLimit") {
    assert(
        WIN_CONDITION.duration >= GRACE_PERIOD,
        "game cannot end before grace period is over",
    );
    assert(
        WIN_CONDITION.countdownStart <= WIN_CONDITION.duration,
        "countdownStart must not exceed total duration",
    );
}

const GAS_RAD_INITIAL = 50;
const GAS_RAD_DELTA = 10;
const GAS_DURATION_DELTA = 5;
const GAS_DAMAGE = 30;

// how long an obstacle waits after being destroyed before regrowing
// has parent building (e.g. club toilets)
const OBSTACLE_REGROW_DELAY_PARENT = 15;
// doesn't have parent building (e.g. isolated obstacles)
const OBSTACLE_REGROW_DELAY_NOPARENT = 20;

type DeepPartial<T> = T extends object
    ? {
          [P in keyof T]?: DeepPartial<T[P]>;
      }
    : T;

type Loadout = Omit<typeof GameConfig.player.defaultItems, "weapons"> & {
    //undefined is def.maxClip
    weapons: [
        { type: string | (() => string); ammo?: number },
        { type: string | (() => string); ammo?: number },
        { type: string | (() => string); ammo: 0 },
        { type: string | (() => string); ammo: 0 },
    ];
};

function createLoadout<T extends Loadout>(extension: DeepPartial<T>): T {
    const emptyLoadout: Loadout = {
        weapons: [
            { type: "", ammo: 0 },
            { type: "", ammo: 0 },
            { type: "fists", ammo: 0 },
            { type: "", ammo: 0 },
        ],
        outfit: "outfitBase",
        backpack: "backpack00",
        helmet: "",
        chest: "",
        scope: "1xscope",
        perks: [] as Array<{ type: string; droppable?: boolean }>,
        inventory: {
            "9mm": 0,
            "762mm": 0,
            "556mm": 0,
            "12gauge": 0,
            "50AE": 0,
            "308sub": 0,
            flare: 0,
            "45acp": 0,
            frag: 0,
            smoke: 0,
            strobe: 0,
            mirv: 0,
            snowball: 0,
            potato: 0,
            bandage: 0,
            healthkit: 0,
            soda: 0,
            painkiller: 0,
            "1xscope": 1,
            "2xscope": 0,
            "4xscope": 0,
            "8xscope": 0,
            "15xscope": 0,
        },
    };
    return util.mergeDeep(emptyLoadout, extension || {});
}

//non weapons defaults
const defaultGearLoadout = createLoadout({
    backpack: "backpack03",
    helmet: "helmet02",
    chest: "chest02",
    scope: "4xscope",
    perks: [{ type: "endless_ammo", droppable: false }],
    inventory: {
        "2xscope": 1,
        "4xscope": 1,
        bandage: 10,
        healthkit: 1,
        soda: 2,
        painkiller: 0,
    },
});

const tiers = {
    tier_sprays: [
        { name: "ak47", count: 1, weight: 1 },
        { name: "hk416", count: 1, weight: 1 },
    ],
    tier_snipers: [
        { name: "blr", count: 1, weight: 1 },
        { name: "scout_elite", count: 1, weight: 1 },
    ],
};

const loadouts: Loadout[] = [
    createLoadout({
        ...defaultGearLoadout,
        weapons: [
            { type: "spas12", ammo: undefined },
            {
                type: () => util.weightedRandom(tiers["tier_sprays"]).name,
                ammo: undefined,
            },
            { type: "fists", ammo: 0 },
            { type: "", ammo: 0 },
        ],
    }),
    createLoadout({
        ...defaultGearLoadout,
        weapons: [
            { type: "m870", ammo: undefined },
            {
                type: () => util.weightedRandom(tiers["tier_snipers"]).name,
                ammo: undefined,
            },
            { type: "fists", ammo: 0 },
            { type: "", ammo: 0 },
        ],
    }),
];

function applyLoadout(player: Player, loadout: Loadout) {
    for (let i = 0; i < loadout.weapons.length; i++) {
        const weapon = loadout.weapons[i];
        const type = weapon.type instanceof Function ? weapon.type() : weapon.type;
        const ammo =
            weapon.ammo ??
            player.weaponManager.getTrueAmmoStats(GameObjectDefs[type] as GunDef)
                .trueMaxClip;

        player.weaponManager.setWeapon(i, type, ammo);
    }

    const perkTypes = [...player.perkTypes];
    for (const perk of perkTypes) {
        player.removePerk(perk);
    }

    if (loadout.perks.length) {
        for (const perk of loadout.perks) {
            player.addPerk(perk.type, perk.droppable);
        }
        player.setDirty();
    }

    player.helmet = loadout.helmet;
    player.chest = loadout.chest;
    player.backpack = loadout.backpack;
    player.scope = loadout.scope;

    Object.assign(player.inventory, loadout.inventory);

    // need to fill inventory before showing next throwable
    player.weaponManager.showNextThrowable();

    player.inventoryDirty = true;
    player.weapsDirty = true;
}

function attachGasResizer(
    plugin: GamePlugin,
    gasRadInitial: number,
    gasRadDelta: number,
    gasDurationDelta: number,
    gasDamage: number,
) {
    const gas = plugin.game.gas;
    plugin.on("gameCreated", (event, ctx) => {
        gas._running = true;
        gas.mode = GasMode.Waiting;
        gas.stage = 1;
        gas.duration = 0;
        gas.damage = gasDamage;

        gas.radOld = gasRadInitial;
        gas.radNew = gasRadInitial;
        gas.currentRad = gasRadInitial;
    });

    plugin.on("gasWillAdvance", (event, ctx) => {
        const { gas } = event.data;
        event.cancel();
    });

    plugin.on("gameUpdate", (event, ctx) => {
        const { game, dt } = event.data;

        if (gas.gasT >= 1) {
            gas.mode = GasMode.Waiting;
            gas.duration = 0;
            gas.radOld = gas.currentRad;
            gas.radNew = gas.currentRad;
            gas.dirty = true;
        }
    });

    plugin.on("playerDidJoin", (event, ctx) => {
        const { player } = event.data;

        // only increase zone size once per group
        if (
            player.group &&
            player.group.players.filter((p) => !p.disconnected).length > 1
        )
            return;

        if (gas.mode == GasMode.Waiting) {
            gas._gasTicker = 0;
            gas.duration += gasDurationDelta;
        } else {
            if (gas.radNew < gas.radOld) {
                //decreasing
                gas.radOld = gas.radNew;
                gas._gasTicker += gasDurationDelta - gas._gasTicker;
            } else {
                gas.duration += gasDurationDelta;
            }
        }
        gas.radNew += gasRadDelta;
        gas.mode = GasMode.Moving;

        gas.dirty = true;
        gas.timeDirty = true;
    });

    plugin.on("playerDisconnect", (event, ctx) => {
        const { player } = event.data;

        // only decrease zone size once per group
        if (
            player.group &&
            player.group.players.filter((p) => !p.disconnected).length > 0
        )
            return;

        if (gas.mode == GasMode.Waiting) {
            gas._gasTicker = 0;
            gas.duration += gasDurationDelta;
        } else {
            if (gas.radNew < gas.radOld) {
                //decreasing
                gas.duration -= gasDurationDelta;
            } else {
                gas.radOld = gas.radNew;
                gas._gasTicker += gasDurationDelta - gas._gasTicker;
            }
        }
        gas.radNew -= gasRadDelta;
        gas.mode = GasMode.Moving;

        gas.dirty = true;
        gas.timeDirty = true;
    });
}

function endGameByKillCount(game: Game) {
    const rankedTeams = Object.values(
        game.playerBarn.players
            .filter((p) => !p.disconnected)
            //aggregate team kills
            .reduce(
                (acc, p) => {
                    acc[p.teamId] ??= { teamId: p.teamId, kills: 0 };
                    acc[p.teamId].kills += p.kills;
                    return acc;
                },
                {} as Record<number, { teamId: number; kills: number }>,
            ),
    ).sort((a, b) => b.kills - a.kills); //descending

    for (const p of game.playerBarn.players) {
        if (p.disconnected) continue;

        const gameOverMsg = new net.GameOverMsg();

        const statsArr: net.PlayerStatsMsg["playerStats"][] =
            game.modeManager.getGameoverPlayers(p);
        gameOverMsg.playerStats = statsArr;

        const teamRank = rankedTeams.findIndex((t) => t.teamId == p.teamId) + 1;
        gameOverMsg.teamRank = teamRank;
        gameOverMsg.teamId = p.teamId;
        // 99% sure rankedTeams is guaranteed to be non empty
        gameOverMsg.winningTeamId = rankedTeams[0].teamId;
        gameOverMsg.gameOver = true;
        p.msgsToSend.push({
            type: net.MsgType.GameOver,
            msg: gameOverMsg,
        });

        for (const spectator of p.spectators) {
            spectator.msgsToSend.push({
                type: net.MsgType.GameOver,
                msg: gameOverMsg,
            });
        }
    }

    game.over = true;

    // send win emoji after 1 second
    game.playerBarn.sendWinEmoteTicker = 1;
    game.stopTicker = 2;

    game.updateData();
}

function addToInventory(player: Player, type: string, amount: number) {
    if (!player.bagSizes[type]) return;
    const backpackLevel = player.getGearLevel(player.backpack);
    const spaceLeft = player.bagSizes[type][backpackLevel] - player.inventory[type];
    player.inventory[type] += math.clamp(amount, 0, spaceLeft);
    player.inventoryDirty = true;
}

export default class DeathmatchPlugin extends GamePlugin {
    timerManager = new TimerManager();

    override initListeners(): void {
        if (this.game.map.mapId != MapId.Deathmatch) return;

        this.on("gameUpdate", (event, ctx) => {
            const { game, dt } = event.data;
            this.timerManager.update(dt);
        });

        //for debugging purposes
        // when i want the round to start instantly while grace period is disabled
        // this.hook("gmm:isGameStarted", (hookPoint) => {
        //     const { gmm } = hookPoint.data;
        //     return gmm.aliveCount() > 1;
        // });

        attachGracePeriod(
            this,
            GRACE_PERIOD,
            CAN_JOIN_PERIOD,
            GRACE_PERIOD_COUNTDOWN_START,
        );

        attachCustomQuickSwitch(this, CUSTOM_SWITCH_DELAY);

        // deathmatch specific listeners below

        //destroys spawned loot
        this.on("mapCreated", (event, ctx) => {
            for (const loot of this.game.lootBarn.loots) {
                loot.destroy();
            }
        });

        this.on("obstacleDeathBeforeEffects", (event, ctx) => {
            const { obstacle, params } = event.data;

            event.cancel();

            const def = MapObjectDefs[obstacle.type] as ObstacleDef;
            obstacle.health = obstacle.healthT = 0;
            obstacle.dead = true;
            obstacle.setDirty();

            obstacle.scale = obstacle.minScale;
            obstacle.updateCollider();

            // do this on demand for performance reasons
            // obstacles that have never been broken before have no reason to be dynamic
            obstacle.makeDynamic();
            obstacle.regrowTicker = obstacle.parentBuilding
                ? OBSTACLE_REGROW_DELAY_PARENT
                : OBSTACLE_REGROW_DELAY_NOPARENT;

            if (def.createSmoke) {
                this.game.smokeBarn.addEmitter(obstacle.pos, obstacle.layer);
            }

            if (def.explosion) {
                this.game.explosionBarn.addExplosion(
                    def.explosion,
                    obstacle.pos,
                    obstacle.layer,
                    {
                        ...params,
                        gameSourceType: "",
                        mapSourceType: obstacle.type,
                    },
                );
            }

            obstacle.parentBuilding?.obstacleDestroyed(obstacle);

            if (obstacle.isWall) {
                const objs = this.game.grid.intersectGameObject(obstacle);

                for (let i = 0; i < objs.length; i++) {
                    const obj = objs[i];
                    if (obj.__type !== ObjectType.Obstacle) continue;
                    if (obj.dead) continue;
                    if (!util.sameLayer(obstacle.layer, obj.layer)) continue;

                    let collision: Collider | undefined = undefined;
                    if (obj.isDoor) {
                        collision = collider.createCircle(obj.pos, 0.5);
                    } else if (obj.type.includes("window_open")) {
                        collision = obj.collider;
                    }
                    if (!collision) continue;

                    if (coldet.test(obstacle.collider, collision)) {
                        obj.kill(params);
                    }
                }
            }
        });

        this.on("playerWillDropItem", (event, ctx) => {
            const { player, dropMsg, itemDef } = event.data;
            event.cancel();
        });

        attachGasResizer(
            this,
            GAS_RAD_INITIAL,
            GAS_RAD_DELTA,
            GAS_DURATION_DELTA,
            GAS_DAMAGE,
        );

        this.on("playerWillGetDowned", (event, ctx) => {
            const { player, params } = event.data;
            event.cancel();
            player.kill(params);
        });

        if (WIN_CONDITION.kind == "timeLimit") {
            this.on("gameStarted", (event, ctx) => {
                this.timerManager.setTimeout(() => {
                    endGameByKillCount(this.game);
                }, WIN_CONDITION.duration);

                this.timerManager.setTimeout(() => {
                    this.timerManager.countdown(
                        WIN_CONDITION.countdownStart,
                        WIN_CONDITION.countdownInterval,
                        (i) => {
                            this.game.playerBarn.addKillFeedLine(-1, [
                                createSimpleSegment(`round ends in `, "white"),
                                createSimpleSegment(`${i}`, "red"),
                                createSimpleSegment(` seconds`, "white"),
                            ]);
                        },
                        () => {
                            this.game.playerBarn.addKillFeedLine(-1, [
                                createSimpleSegment("ROUND OVER", "red"),
                            ]);
                        },
                    );
                }, WIN_CONDITION.duration - WIN_CONDITION.countdownStart);
            });
        }

        this.on("playerDidJoin", (event, ctx) => {
            const { player } = event.data;

            player.boost = 100;
            player.health = 100;

            applyLoadout(player, util.randomElem(loadouts));
        });

        this.on("playerWillDie", (event, ctx) => {
            const { player, params } = event.data;

            event.cancel();
            player.dead = true;

            player.boost = 0;
            player.boostDirty = true;

            player.setDirty();

            player.shootStart = false;
            player.shootHold = false;
            player.actionType = GameConfig.Action.None;
            player.actionSeq++;
            player.hasteType = GameConfig.HasteType.None;
            player.hasteSeq++;
            player.animType = GameConfig.Anim.None;
            player.animSeq++;
            player.weaponManager.throwThrowable();

            player.shotSlowdownTimer = 0;

            //clears loadout
            applyLoadout(player, createLoadout({}));

            const killMsg = new net.KillMsg();
            killMsg.damageType = params.damageType;
            killMsg.itemSourceType = params.gameSourceType ?? "";
            killMsg.mapSourceType = params.mapSourceType ?? "";
            killMsg.targetId = player.__id;
            killMsg.killed = true;

            if (params.source && params.source.__type == ObjectType.Player) {
                const killer = params.source;
                player.killedBy = killer;

                if (killer !== player && killer.teamId !== player.teamId) {
                    killer.killedIds.push(player.matchDataId);
                    killer.kills++;

                    if (killer.isKillLeader) {
                        player.game.playerBarn.killLeaderDirty = true;
                    }

                    if (killer.hasPerk("takedown")) {
                        killer.health += 25;
                        killer.boost += 25;
                        killer.giveHaste(GameConfig.HasteType.Takedown, 3);
                    }

                    if (killer.role === "woods_king") {
                        player.game.playerBarn.addMapPing("ping_woodsking", player.pos);
                    }
                }
                killMsg.killerId = killer.__id;
                killMsg.killCreditId = killer.__id;
                killMsg.killerKills = killer.kills;

                if (killer.group) {
                    const groupAliveCount = killer.group.livingPlayers.length;
                    const bonus = 25 - groupAliveCount * 5;
                    killer.health += bonus;
                    killer.boost += bonus;
                } else {
                    killer.health += 25;
                    killer.boost += 25;
                }

                addToInventory(killer, "impulse", 1);
                if (!killer.weapons[GameConfig.WeaponSlot.Throwable].type) {
                    killer.weaponManager.showNextThrowable();
                }
                addToInventory(killer, "bandage", 5);
                addToInventory(killer, "healthkit", 1);
                addToInventory(killer, "soda", 1);

                // loop over all slots to make it generic i guess
                for (let i = 0; i < GameConfig.WeaponSlot.Count; i++) {
                    if (GameConfig.WeaponType[i] != "gun") continue;
                    const gun = killer.weapons[i];
                    if (!gun.type) continue;
                    const gunDef = GameObjectDefs[gun.type] as GunDef;
                    const halfClip = Math.ceil(gunDef.maxClip / 2);
                    if (gun.ammo < halfClip) {
                        gun.ammo = halfClip;
                        killer.weapsDirty = true;
                    }
                }
            }

            this.game.broadcastMsg(net.MsgType.Kill, killMsg);

            if (player.role) {
                const roleMsg = new net.RoleAnnouncementMsg();
                roleMsg.role = player.role;
                roleMsg.assigned = false;
                roleMsg.killed = true;
                roleMsg.playerId = player.__id;
                roleMsg.killerId = params.source?.__id ?? 0;
                this.game.broadcastMsg(net.MsgType.RoleAnnouncement, roleMsg);
            }

            if (this.game.map.mapDef.gameMode.killLeaderEnabled) {
                const killLeader = this.game.playerBarn.killLeader;

                let killLeaderKills = 0;

                if (killLeader && !killLeader.dead) {
                    killLeaderKills = killLeader.kills;
                }

                const newKillLeader = this.game.playerBarn.getPlayerWithHighestKills();
                if (
                    killLeader !== newKillLeader &&
                    params.source &&
                    newKillLeader === params.source &&
                    newKillLeader.kills > killLeaderKills
                ) {
                    if (killLeader && killLeader.role === "the_hunted") {
                        killLeader.removeRole();
                    }

                    params.source.promoteToKillLeader();
                }
            }

            this.game.deadBodyBarn.addDeadBody(
                player.pos,
                player.__id,
                player.layer,
                params.dir,
            );

            this.timerManager.setTimeout(() => {
                this.game.deadBodyBarn.removeDeadBody(player.__id);
            }, DESTROY_DEAD_BODY_DELAY);

            // end game before respawn logic gets a chance to run
            if (
                params.source &&
                params.source.__type == ObjectType.Player &&
                WIN_CONDITION.kind == "killThreshold" &&
                params.source.kills >= WIN_CONDITION.targetKills
            ) {
                endGameByKillCount(this.game);
                return;
            }

            //dont respawn disconnected players
            if (!player.disconnected) {
                this.timerManager.setTimeout(() => {
                    this.timerManager.countdown(
                        RESPAWN_COUNTDOWN_START,
                        1,
                        (i) => {
                            this.game.playerBarn.addKillFeedLine(player.__id, [
                                createSimpleSegment(`${i} seconds left`, "white"),
                            ]);
                        },
                        () => {
                            this.game.playerBarn.addKillFeedLine(player.__id, [
                                createSimpleSegment("respawned!", "white"),
                            ]);
                        },
                    );
                }, RESPAWN_DELAY - RESPAWN_COUNTDOWN_START);

                this.timerManager.setTimeout(() => {
                    player.dead = false;
                    player.setDirty();

                    player.boost = 100;
                    player.health = 100;

                    applyLoadout(player, util.randomElem(loadouts));

                    v2.set(
                        player.pos,
                        // undefined because players dont respawn next to teammates in deathmatch
                        this.game.map.getSpawnPos(undefined, undefined),
                    );

                    this.game.grid.updateObject(player);
                    // make sure player doesn't spawn in bunker or something
                    player.layer = 0;
                }, RESPAWN_DELAY);
            }
        });
    }
}
