import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import { MapObjectDefs } from "../../../../shared/defs/mapObjectDefs";
import type { ObstacleDef } from "../../../../shared/defs/mapObjectsTyping";
import { MapId } from "../../../../shared/defs/types/misc";
import { GameConfig, GasMode, TeamMode } from "../../../../shared/gameConfig";
import * as net from "../../../../shared/net/net";
import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { type Collider, coldet } from "../../../../shared/utils/coldet";
import { collider } from "../../../../shared/utils/collider";
import { math } from "../../../../shared/utils/math";
import { assert, util } from "../../../../shared/utils/util";
import { v2 } from "../../../../shared/utils/v2";
import { TimerManager, createSimpleSegment } from "../../utils/pluginUtils";
import type { DamageParams } from "../objects/gameObject";
import type { Player } from "../objects/player";
import { GamePlugin } from "../pluginManager";
import { attachCustomQuickSwitch, attachGracePeriod } from "./internalUtils";

const CUSTOM_SWITCH_DELAY = 0.205;

const GRACE_PERIOD = 15;
const CAN_JOIN_PERIOD = 15;

assert(
    GRACE_PERIOD <= CAN_JOIN_PERIOD,
    "players should be able to join the game while the grace period is still active",
);

// the amount of seconds left in the grace period timer when it shows up in the killfeed
const GRACE_PERIOD_COUNTDOWN_START = 10;

assert(
    GRACE_PERIOD_COUNTDOWN_START <= GRACE_PERIOD,
    "the grace period countdown must appear while the grace period is still active",
);

const RESPAWN_DELAY = 5;

// seconds remaining when respawn countdown begins in the killfeed
const RESPAWN_COUNTDOWN_START = 3;

assert(
    RESPAWN_COUNTDOWN_START <= RESPAWN_DELAY,
    "the respawn delay countdown must appear while the respawn is still active",
);

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

//TODO: inline this instead of using Omit
type Loadout = Omit<typeof GameConfig.player.defaultItems, "weapons"> & {
    //undefined is def.maxClip
    weapons: [
        { type: string | (() => string); ammo?: number },
        { type: string | (() => string); ammo?: number },
        { type: string | (() => string); ammo: 0 },
        { type: string | (() => string); ammo: 0 },
    ];
    role: string;
    weight: number;
};

const EMPTY_LOADOUT: Loadout = {
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
        impulse: 0,
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
    //TODO: does not work as expected currently since kill leader (the_hunted)
    // overrides any role you start out with
    role: "",
    weight: 1,
};

function extendLoadout(base: Loadout, patch: DeepPartial<Loadout>): Loadout {
    return util.mergeDeep(structuredClone(base), patch);
}

//non weapons defaults
const DEFAULT_GEAR_LOADOUT = extendLoadout(EMPTY_LOADOUT, {
    backpack: "backpack03",
    helmet: "helmet03",
    chest: "chest02",
    scope: "4xscope",
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
        { name: "mp5", count: 1, weight: 1.2 },
        { name: "famas", count: 1, weight: 1.2 },
    ],
    tier_snipers: [
        { name: "blr", count: 1, weight: 1 },
        { name: "scout_elite", count: 1, weight: 1 },
        { name: "model94", count: 1, weight: 0.3 },
    ],
};

const loadouts: Loadout[] = [
    extendLoadout(DEFAULT_GEAR_LOADOUT, {
        weapons: [
            { type: "spas12", ammo: undefined },
            {
                type: () => util.weightedRandom(tiers["tier_sprays"]).name,
                ammo: undefined,
            },
            { type: "fists", ammo: 0 },
            { type: "", ammo: 0 },
        ],
        perks: [{ type: "endless_ammo", droppable: false }],
        weight: 1,
    }),
    extendLoadout(DEFAULT_GEAR_LOADOUT, {
        weapons: [
            { type: "m870", ammo: undefined },
            {
                type: () => util.weightedRandom(tiers["tier_snipers"]).name,
                ammo: undefined,
            },
            { type: "impulse_gloves", ammo: 0 },
            { type: "", ammo: 0 },
        ],
        perks: [{ type: "endless_ammo", droppable: false }],
        weight: 1,
    }),
    extendLoadout(DEFAULT_GEAR_LOADOUT, {
        weapons: [
            { type: "model94", ammo: undefined },
            { type: "deagle", ammo: undefined },
            { type: "fists", ammo: 0 },
            { type: "frag", ammo: 0 },
        ],
        perks: [{ type: "endless_ammo", droppable: false }],
        inventory: {
            frag: 1,
        },
        weight: 0.5,
    }),
    extendLoadout(DEFAULT_GEAR_LOADOUT, {
        weapons: [
            { type: "mp220", ammo: undefined },
            { type: "m249", ammo: undefined },
            { type: "fists", ammo: 0 },
            { type: "", ammo: 0 },
        ],
        perks: [{ type: "endless_ammo", droppable: false }],
        weight: 0.2,
    }),
    extendLoadout(DEFAULT_GEAR_LOADOUT, {
        weapons: [
            { type: "mosin", ammo: undefined },
            { type: "bugle", ammo: undefined },
            { type: "fists", ammo: 0 },
            { type: "impulse", ammo: 0 },
        ],
        perks: [
            { type: "endless_ammo", droppable: false },
            { type: "inspiration", droppable: false },
        ],
        inventory: {
            impulse: 2,
        },
        weight: 0.1,
    }),
    extendLoadout(DEFAULT_GEAR_LOADOUT, {
        weapons: [
            { type: "m870", ammo: undefined },
            { type: "p30l", ammo: undefined },
            { type: "impulse_gloves", ammo: 0 },
            { type: "", ammo: 0 },
        ],
        perks: [{ type: "endless_ammo", droppable: false }],
        weight: 0.7,
    }),
    extendLoadout(DEFAULT_GEAR_LOADOUT, {
        weapons: [
            { type: "dp28", ammo: undefined },
            { type: "vector", ammo: undefined },
            { type: "fists", ammo: 0 },
            { type: "", ammo: 0 },
        ],
        perks: [{ type: "endless_ammo", droppable: false }],
        inventory: {
            mirv: 1,
        },
        weight: 0.5,
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

    const perks = [...player.perks];
    for (const perk of perks) {
        // hunted can only be removed when player loses "the_hunted" role
        if (perk.type == "hunted") continue;

        player.removePerk(perk.type);
    }

    if (loadout.perks.length) {
        for (const perk of loadout.perks) {
            player.addPerk(perk.type, perk.droppable);
        }
        player.setDirty();
    }

    if (loadout.role) {
        player.promoteToRole(loadout.role);
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
        // if (
        //     player.group &&
        //     player.group.players.filter((p) => !p.disconnected).length > 1
        // )
        //     return;

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
        // if (
        //     player.group &&
        //     player.group.players.filter((p) => !p.disconnected).length > 0
        // )
        //     return;

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

function addToInventory(player: Player, type: string, amount: number) {
    if (!player.bagSizes[type]) return;
    const backpackLevel = player.getGearLevel(player.backpack);
    const spaceLeft = player.bagSizes[type][backpackLevel] - player.inventory[type];
    player.inventory[type] += math.clamp(amount, 0, spaceLeft);
    player.inventoryDirty = true;
}

function resolveKiller(player: Player, params: DamageParams): Player | undefined {
    if (params.source && params.source.__type == ObjectType.Player) {
        return params.source;
    }

    // attribute gas deaths to the last attacker to prevent evading kill credit
    if (params.damageType == GameConfig.DamageType.Gas && player.lastDamagedBy) {
        return player.lastDamagedBy;
    }

    return undefined;
}

class GracePeriod {
    private ticker = 0;
    active = false;

    constructor(public plugin: GamePlugin & { timerManager: TimerManager }) {}

    update(dt: number) {
        if (!this.active) return;

        this.ticker -= dt;
        if (this.ticker <= 0) {
            this.active = false;
            this.ticker = 0;
        }
    }

    start(duration: number, onComplete?: () => void) {
        // can't start a grace period if one is already in progress
        if (this.active) return;
        this.active = true;
        this.ticker = duration;
        this.plugin.timerManager.countdown(
            duration,
            1,
            (i) => {
                this.plugin.game.playerBarn.addKillFeedLine(-1, [
                    createSimpleSegment(`${i} seconds left`, "white"),
                ]);
            },
            onComplete,
        );
    }
}

export default class DeathmatchPlugin extends GamePlugin {
    timerManager = new TimerManager();

    gracePeriod = new GracePeriod(this);
    overtime = false;

    respawnTimerIds: Set<number> = new Set();

    handleNormalDeath(player: Player, params: DamageParams) {
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

        if (player.weaponManager.cookingThrowable) {
            player.weaponManager.throwThrowable(true);
        }

        player.shotSlowdownTimer = 0;

        // so inputs don't carry over into the next life
        player.moveLeft = false;
        player.moveRight = false;
        player.moveUp = false;
        player.moveDown = false;

        //clears loadout
        applyLoadout(player, EMPTY_LOADOUT);

        const killMsg = new net.KillMsg();
        killMsg.damageType = params.damageType;
        killMsg.itemSourceType = params.gameSourceType ?? "";
        killMsg.mapSourceType = params.mapSourceType ?? "";
        killMsg.targetId = player.__id;
        killMsg.killed = true;

        const killer = resolveKiller(player, params);

        if (killer) {
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

            killer.health += 40;
            killer.boost += 25;

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

        if (this.game.map.mapDef.gameMode.killLeaderEnabled) {
            const killLeader = this.game.playerBarn.killLeader;

            let killLeaderKills = 0;

            // `player.kill() also checks !dead here but we don't care about that
            if (killLeader) {
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

        //dont respawn disconnected players
        if (!player.disconnected) {
            const respawnTimerDisplayId = this.timerManager.setTimeout(() => {
                this.respawnTimerIds.delete(respawnTimerDisplayId);
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
            this.respawnTimerIds.add(respawnTimerDisplayId);

            const respawnTimerId = this.timerManager.setTimeout(() => {
                this.respawnTimerIds.delete(respawnTimerId);
                player.dead = false;
                player.setDirty();

                player.boost = 100;
                player.health = 100;

                applyLoadout(player, util.randomElem(loadouts));

                v2.set(
                    player.pos,
                    // undefined because players dont respawn next to teammates when not in overtime
                    this.game.map.getSpawnPos(undefined, undefined),
                );

                this.game.grid.updateObject(player);
                // make sure player doesn't spawn in bunker or something
                player.layer = 0;
            }, RESPAWN_DELAY);
            this.respawnTimerIds.add(respawnTimerId);
        }
    }

    handleTransitionDeath(player: Player) {
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

        player.group?.checkPlayers();

        if (player.weaponManager.cookingThrowable) {
            player.weaponManager.throwThrowable(true);
        }

        player.shotSlowdownTimer = 0;

        // so inputs don't carry over into the next life
        player.moveLeft = false;
        player.moveRight = false;
        player.moveUp = false;
        player.moveDown = false;

        this.game.playerBarn.aliveCountDirty = true;
        this.game.playerBarn.livingPlayers.splice(
            this.game.playerBarn.livingPlayers.indexOf(player),
            1,
        );

        //clears loadout
        applyLoadout(player, EMPTY_LOADOUT);

        if (player.isKillLeader) {
            this.game.playerBarn.killLeader = undefined;
            this.game.playerBarn.killLeaderDirty = true;
            player.isKillLeader = false;

            if (player.role === "the_hunted") {
                player.removeRole();
            }
        }
    }

    handleOvertimeDeath(player: Player, params: DamageParams) {
        if (!this.overtime) return;

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

        player.group?.checkPlayers();

        if (player.weaponManager.cookingThrowable) {
            player.weaponManager.throwThrowable(true);
        }

        player.shotSlowdownTimer = 0;

        // so inputs don't carry over into the next life
        player.moveLeft = false;
        player.moveRight = false;
        player.moveUp = false;
        player.moveDown = false;

        this.game.playerBarn.aliveCountDirty = true;
        this.game.playerBarn.livingPlayers.splice(
            this.game.playerBarn.livingPlayers.indexOf(player),
            1,
        );

        // this array is exclusively used to send gameover msgs for a traditional last man standing mode
        // which is why this is the only death method that pushes to it
        this.game.playerBarn.killedPlayers.push(player);

        //clears loadout
        applyLoadout(player, EMPTY_LOADOUT);

        const killMsg = new net.KillMsg();
        killMsg.damageType = params.damageType;
        killMsg.itemSourceType = params.gameSourceType ?? "";
        killMsg.mapSourceType = params.mapSourceType ?? "";
        killMsg.targetId = player.__id;
        killMsg.killed = true;

        const killer = resolveKiller(player, params);

        if (killer) {
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

            killer.health += 40;
            killer.boost += 25;

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

        this.game.deadBodyBarn.addDeadBody(
            player.pos,
            player.__id,
            player.layer,
            params.dir,
        );

        this.timerManager.setTimeout(() => {
            this.game.deadBodyBarn.removeDeadBody(player.__id);
        }, DESTROY_DEAD_BODY_DELAY);

        // overtime is a tranditional last man standing fight
        // so we can take advantage of the default game end methods
        if (this.game.modeManager.shouldGameEnd()) {
            this.game.modeManager.handleGameEnd();
            this.game.over = true;

            // send win emoji after 1 second
            this.game.playerBarn.sendWinEmoteTicker = 1;
            this.game.stopTicker = 2;

            this.game.updateData();
            return;
        }
    }

    sendGameOverMsg(
        player: Player,
        teamRank: number,
        winningTeamId: number,
        gameOver: boolean,
    ) {
        if (player.disconnected) return;

        const gameOverMsg = new net.GameOverMsg();

        const statsArr: net.PlayerStatsMsg["playerStats"][] =
            this.game.modeManager.getGameoverPlayers(player);
        gameOverMsg.playerStats = statsArr;

        gameOverMsg.teamRank = teamRank;
        gameOverMsg.teamId = player.teamId;
        gameOverMsg.winningTeamId = winningTeamId;
        gameOverMsg.gameOver = gameOver;
        player.msgsToSend.push({
            type: net.MsgType.GameOver,
            msg: gameOverMsg,
        });

        for (const spectator of player.spectators) {
            spectator.msgsToSend.push({
                type: net.MsgType.GameOver,
                msg: gameOverMsg,
            });
        }
    }

    override initListeners(): void {
        if (this.game.map.mapId != MapId.Deathmatch) return;

        this.on("gameUpdate", (event, ctx) => {
            const { game, dt } = event.data;
            this.timerManager.update(dt);
            this.gracePeriod.update(dt);
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

        this.on("playerWillTakeDamage", (event, ctx) => {
            if (!this.gracePeriod.active) return;

            event.cancel();
            event.stopPropagation();
        });

        this.on("playerWillInput", (event, ctx) => {
            if (!this.gracePeriod.active) return;

            const { msg } = event.data;

            msg.touchMoveActive = false;
            msg.touchMoveDir = v2.create(0, 0);
            msg.moveLeft = false;
            msg.moveRight = false;
            msg.moveUp = false;
            msg.moveDown = false;
        });

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
                    // safety check
                    if (this.game.playerBarn.players.length == 0) {
                        return;
                    }

                    for (const id of this.respawnTimerIds) {
                        this.timerManager.clearTimer(id);
                    }

                    if (this.game.teamMode == TeamMode.Solo) {
                        const rankedPlayers = this.game.playerBarn.players.sort(
                            (a, b) => b.kills - a.kills,
                        );

                        const topKills = rankedPlayers[0].kills;
                        let i = 0;
                        while (
                            i < rankedPlayers.length &&
                            rankedPlayers[i].kills == topKills
                        ) {
                            i++;
                        }

                        const overtimeContenders = rankedPlayers.slice(0, i);
                        const eliminated = rankedPlayers.slice(i);

                        const winner =
                            overtimeContenders.length == 1
                                ? overtimeContenders[0]
                                : undefined;

                        for (const player of eliminated) {
                            this.handleTransitionDeath(player);

                            const teamRank =
                                rankedPlayers.findIndex(
                                    (p) => p.teamId == player.teamId,
                                ) + 1;
                            this.sendGameOverMsg(
                                player,
                                teamRank,
                                winner ? winner.teamId : 0,
                                !!winner,
                            );
                        }

                        if (winner) {
                            this.sendGameOverMsg(winner, 1, winner.teamId, true);
                            this.game.over = true;

                            // send win emoji after 1 second
                            this.game.playerBarn.sendWinEmoteTicker = 1;
                            this.game.stopTicker = 2;

                            this.game.updateData();
                            return;
                        }

                        for (const player of overtimeContenders) {
                            if (player.disconnected) {
                                this.handleTransitionDeath(player);
                            }
                        }
                    } else {
                        const groupsRankedByKills = this.game.playerBarn.groups
                            .map((group) => ({
                                group,
                                kills: group.players.reduce((acc, p) => acc + p.kills, 0),
                            }))
                            .sort((a, b) => b.kills - a.kills);

                        const topKills = groupsRankedByKills[0].kills;
                        let i = 0;
                        while (
                            i < groupsRankedByKills.length &&
                            groupsRankedByKills[i].kills == topKills
                        ) {
                            i++;
                        }

                        const rankedGroups = groupsRankedByKills.map((g) => g.group);

                        const overtimeContenders = rankedGroups.slice(0, i);
                        const eliminated = rankedGroups.slice(i);

                        const winner =
                            overtimeContenders.length == 1
                                ? overtimeContenders[0]
                                : undefined;

                        for (const group of eliminated) {
                            const teamRank =
                                rankedGroups.findIndex(
                                    (g) => g.groupId == group.groupId,
                                ) + 1;

                            for (const player of group.players) {
                                this.handleTransitionDeath(player);
                                this.sendGameOverMsg(
                                    player,
                                    teamRank,
                                    winner ? winner.groupId : 0,
                                    !!winner,
                                );
                            }
                        }

                        if (winner) {
                            for (const player of winner.players) {
                                this.sendGameOverMsg(player, 1, winner.groupId, true);
                            }
                            this.game.over = true;

                            // send win emoji after 1 second
                            this.game.playerBarn.sendWinEmoteTicker = 1;
                            this.game.stopTicker = 2;

                            this.game.updateData();
                            return;
                        }

                        for (const group of overtimeContenders) {
                            for (const player of group.players) {
                                if (player.disconnected) {
                                    this.handleTransitionDeath(player);
                                }
                            }
                        }
                    }

                    for (const player of this.game.playerBarn.livingPlayers) {
                        player.health = 100;
                        player.boost = 100;

                        player.layer = 0;

                        v2.set(
                            player.pos,
                            this.game.map.getSpawnPos(player.group, undefined),
                        );

                        this.game.grid.updateObject(player);
                    }

                    this.overtime = true;

                    // the countdown is just so players have time to reset
                    // overtime technically starts immediately
                    this.gracePeriod.start(10, () => {
                        this.game.playerBarn.addKillFeedLine(-1, [
                            createSimpleSegment("overtime started!", "white"),
                        ]);
                    });
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

            applyLoadout(player, util.weightedRandom(loadouts));
        });

        this.on("playerWillDie", (event, ctx) => {
            const { player, params } = event.data;

            event.cancel();

            if (this.overtime) {
                this.handleOvertimeDeath(player, params);
            } else {
                this.handleNormalDeath(player, params);
            }
        });
    }
}
