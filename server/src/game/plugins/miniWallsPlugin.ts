import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import { MapObjectDefs } from "../../../../shared/defs/mapObjectDefs";
import type { ObstacleDef } from "../../../../shared/defs/mapObjectsTyping";
import { TeamColor } from "../../../../shared/defs/maps/factionDefs";
import { MapId } from "../../../../shared/defs/types/misc";
import { GameConfig, GasMode } from "../../../../shared/gameConfig";
import * as net from "../../../../shared/net/net";
import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { type Collider, coldet } from "../../../../shared/utils/coldet";
import { collider } from "../../../../shared/utils/collider";
import { math } from "../../../../shared/utils/math";
import { util } from "../../../../shared/utils/util";
import { type Vec2, v2 } from "../../../../shared/utils/v2";
import { TimerManager, createSimpleSegment } from "../../utils/pluginUtils";
import type { Game } from "../game";
import type { Obstacle } from "../objects/obstacle";
import type { Player } from "../objects/player";
import { GamePlugin } from "../pluginManager";
import { attachCustomQuickSwitch, attachGracePeriod } from "./internalUtils";

const BED_OBSTACLE_TYPE = "vat_03";

const CUSTOM_SWITCH_DELAY = 0.205;

const DESTROY_DEAD_BODY_DELAY = 7;

const GRACE_PERIOD = 8;

const validNadeTypes = ["", "frag", "mirv", "impulse"] as const;

type Loadout = {
    primary: string | (() => string);
    secondary: string | (() => string);
    melee: string | (() => string);
    nadeType: string | (() => string);
    nadeCount: number;
    chestLevel: number;
    helmetLevel: number;
};

const TeamColorToString: Record<TeamColor, string> = {
    [TeamColor.Red]: "red",
    [TeamColor.Blue]: "blue",
};

const TeamNumbers: TeamColor[] = [1, 2];

type Bed = {
    obstacleRef: Obstacle;
    color: TeamColor;
    broken: boolean;
};

const AUTO_BED_BREAK_DELAY = 10; //(minutes) how long from game start to automatically break both beds
const ZONE_CLOSE_DURATION = 10; //(minutes) how long the zone takes to finally close after it starts moving when auto_bed_break_delay times out

// how long an obstacle waits after being destroyed before regrowing
const OBSTACLE_REGROW_DELAY = 15;

const PLAYABLE_WIDTH = 300;
const PLAYABLE_HEIGHT = 120;
const BED_DIST_FROM_WALL = 60; //might not actually be where the bed is, but just where its generating and stuff idk
const BED_COVER_OFFSET = PLAYABLE_WIDTH / 2 - BED_DIST_FROM_WALL; //offset from center in the x axis
const BED_OFFSET = BED_COVER_OFFSET - 10;

export default class MiniWallsPlugin extends GamePlugin {
    timerManager = new TimerManager();
    beds!: Record<TeamColor, Bed>;

    override initListeners(): void {
        if (this.game.map.mapId != MapId.MiniWalls) return;

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

        attachGracePeriod(this, GRACE_PERIOD, GRACE_PERIOD, GRACE_PERIOD);

        modifyGas(this);

        attachCustomQuickSwitch(this, CUSTOM_SWITCH_DELAY);

        //destroys spawned loot
        this.on("mapCreated", (event, ctx) => {
            for (const loot of this.game.lootBarn.loots) {
                loot.destroy();
            }
        });

        this.on("obstacleDeathBeforeEffects", (event, ctx) => {
            const { obstacle, params } = event.data;

            for (const n of TeamNumbers) {
                if (this.beds[n].obstacleRef.__id === obstacle.__id) {
                    bedBroken(this.beds[n], this.game);
                    return;
                }
            }

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
            obstacle.regrowTicker = OBSTACLE_REGROW_DELAY;
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

        this.on("playerWillGetDowned", (event, ctx) => {
            const { player, params } = event.data;
            event.cancel();
            player.kill(params);
        });

        this.on("playerWillDie", (event, ctx) => {
            const { player, params } = event.data;

            for (const n of TeamNumbers) {
                if (player.teamId === n && this.beds[n].broken) {
                    return;
                }
            }

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

            // so inputs don't carry over into the next life
            player.moveLeft = false;
            player.moveRight = false;
            player.moveUp = false;
            player.moveDown = false;

            //clears loadout

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

                killer.health += 40;
                killer.boost = 100;

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

            //dont respawn disconnected players
            if (!player.disconnected) {
                this.timerManager.setTimeout(() => {
                    respawnPlayer(player);
                }, getRespawnDelay(player));
            }
        });

        this.on("obstacleWillTakeDamage", (event, ctx) => {
            const { obstacle, params } = event.data;
            if (obstacle.type !== BED_OBSTACLE_TYPE) {
                return;
            }
            if (!params.amount) {
                event.cancel();
                return;
            }
            if (
                !params.weaponSourceType ||
                GameObjectDefs[params.weaponSourceType].type !== "melee"
            ) {
                event.cancel();
                return;
            }

            if (!params.source || params.source.__type != ObjectType.Player) {
                event.cancel();
                return;
            }
            const p = params.source as Player;

            for (const n of TeamNumbers) {
                if (obstacle.__id === this.beds[n].obstacleRef.__id) {
                    if (p.teamId === n) {
                        event.cancel();
                    } else {
                        bedWillTakeDamage(this.beds[n], this.game, params.amount);
                    }
                }
            }
        });

        this.on("gameStarted", (event, ctx) => {
            const players = event.data.game.playerBarn.livingPlayers;
            for (const player of players) {
                respawnPlayer(player);
            }
            this.timerManager.setTimeout(() => {
                this.breakBeds();
            }, AUTO_BED_BREAK_DELAY * 60);
        });

        this.on("mapWillCreate", (event, ctx) => {
            const game = event.data.map.game;
            handleMapGeneration(game, this);
            const redBed = this.game.map.genObstacle(
                BED_OBSTACLE_TYPE,
                v2.add(this.game.map.center, v2.create(-BED_OFFSET, 0)),
                0,
                0,
            ) as Obstacle;
            const blueBed = this.game.map.genObstacle(
                BED_OBSTACLE_TYPE,
                v2.add(this.game.map.center, v2.create(BED_OFFSET, 0)),
                0,
                2,
            ) as Obstacle;

            this.beds = {
                [TeamColor.Red]: {
                    obstacleRef: redBed,
                    color: TeamColor.Red,
                    broken: false,
                },
                [TeamColor.Blue]: {
                    obstacleRef: blueBed,
                    color: TeamColor.Blue,
                    broken: false,
                },
            };
        });
    }

    breakBeds() {
        for (const bed of Object.values(this.beds)) {
            if (bed.broken) {
                continue;
            }
            const obs = bed.obstacleRef;
            bed.broken = true;
            obs.kill({
                damageType: GameConfig.DamageType.Gas,
                dir: v2.create(0, 0),
            });
            bedBroken(bed, this.game);
        }
    }
}

function handleMapGeneration(game: Game, plugin: GamePlugin) {
    game.planeBarn.specialAirdrop.dropped = true;
    // generateBedCover(
    //     game,
    //     v2.add(game.map.center, v2.create(-BED_COVER_OFFSET, 0)),
    //     Math.PI / 2,
    // );
    // generateBedCover(
    //     game,
    //     v2.add(game.map.center, v2.create(BED_COVER_OFFSET, 0)),
    //     -Math.PI / 2,
    // );

    generateBorders(game);
}

function generateBorders(game: Game) {
    const center = game.map.center;
    const ydiff = PLAYABLE_HEIGHT / 2;
    const xdiff = PLAYABLE_WIDTH / 2;
    const idk = 50;
    //top and bottom walls from center going outwards in both directions
    for (let i = 0; i < idk; i++) {
        generateOneWall(game, v2.add(center, v2.create(i * 3.5, ydiff)), 1);
        generateOneWall(game, v2.add(center, v2.create(i * -3.5, ydiff)), 1);
        generateOneWall(game, v2.add(center, v2.create(i * 3.5, -ydiff)), 1);
        generateOneWall(game, v2.add(center, v2.create(i * -3.5, -ydiff)), 1);
    }

    //left and right walls
    for (let i = 0; i < idk; i++) {
        generateOneWall(game, v2.add(center, v2.create(xdiff, i * 3.5)), 0);
        generateOneWall(game, v2.add(center, v2.create(xdiff, -i * 3.5)), 0);
        generateOneWall(game, v2.add(center, v2.create(-xdiff, i * 3.5)), 0);
        generateOneWall(game, v2.add(center, v2.create(-xdiff, -i * 3.5)), 0);
    }
}

function generateBedCover(game: Game, center: Vec2, facingDir: number) {
    const radius = 30;
    //facingdir for centermost thingy relative to center, in radians, 0 is up and goes clockwise
    const spread = Math.PI / 2; //radian diff between outermost and center
    const resolution = 20; //roughly half of the number of total circles
    const numToSkip = 0; //leave the centermost thingys open
    for (let i = numToSkip; i < resolution; i++) {
        generateOneBigVat(
            game,
            v2.add(
                center,
                v2.create(
                    radius * Math.sin(facingDir + (i * spread) / resolution),
                    radius * Math.cos(facingDir + (i * spread) / resolution),
                ),
            ),
        );
        generateOneBigVat(
            game,
            v2.add(
                center,
                v2.create(
                    radius * Math.sin(facingDir - (i * spread) / resolution),
                    radius * Math.cos(facingDir - (i * spread) / resolution),
                ),
            ),
        );
    }
}

function respawnPlayer(player: Player) {
    player.dead = false;
    player.setDirty();
    player.health = 100;

    giveGear(player);

    v2.set(player.pos, getPlayerSpawnPos(player));

    player.game.grid.updateObject(player);
    // make sure player doesn't spawn in bunker or something
    player.layer = 0;
}

function giveGear(player: Player) {
    player.backpack = "backpack02";
    player.inventory["bandage"] = 15;
    player.inventory["soda"] = 10;
    player.inventory["painkiller"] = 3;
    player.inventory["healthkit"] = 3;
    if (!player.hasPerk("endless_ammo")) {
        player.addPerk("endless_ammo", false);
    }
    player.inventory["2xscope"] = 1;
    player.inventory["4xscope"] = 1;
    player.scope = "4xscope";
    player.boost = 100;

    const loadout = getNewLoadout();

    player.chest = `chest0${loadout.chestLevel}`;
    player.helmet = `helmet0${loadout.helmetLevel}`;

    const primary: string =
        loadout.primary instanceof Function ? loadout.primary() : loadout.primary;
    const secondary: string =
        loadout.secondary instanceof Function ? loadout.secondary() : loadout.secondary;
    const melee: string =
        loadout.melee instanceof Function ? loadout.melee() : loadout.melee;
    const nadeType: string =
        loadout.nadeType instanceof Function ? loadout.nadeType() : loadout.nadeType;

    player.weaponManager.setWeapon(
        GameConfig.WeaponSlot.Primary,
        primary,
        (GameObjectDefs[primary] as GunDef).maxClip,
    );
    player.weaponManager.setWeapon(
        GameConfig.WeaponSlot.Secondary,
        secondary,
        (GameObjectDefs[secondary] as GunDef).maxClip,
    );

    player.weaponManager.setWeapon(GameConfig.WeaponSlot.Melee, melee, 0);

    for (const nt of validNadeTypes) {
        player.inventory[nt] = 0;
    }
    if (nadeType !== "" && loadout.nadeCount > 0) {
        player.inventory[nadeType] = loadout.nadeCount;
    }

    player.weaponManager.showNextThrowable();
    player.boostDirty = true;
    player.zoomDirty = true;
    player.weapsDirty = true;
    player.inventoryDirty = true;
    player.setDirty();
}

const player_spawn_space = 5; //space from walls
const player_spawn_variance = 5; //x axis
function getPlayerSpawnPos(player: Player): Vec2 {
    const verticalOffset = util.randomInt(
        -PLAYABLE_HEIGHT / 2 + player_spawn_space,
        PLAYABLE_HEIGHT / 2 - player_spawn_space,
    );
    const horizontalOffset =
        PLAYABLE_WIDTH / 2 -
        player_spawn_space -
        util.randomInt(0, player_spawn_variance);
    return v2.add(
        player.game.map.center,
        v2.create(
            player.teamId === TeamColor.Red ? -horizontalOffset : horizontalOffset,
            verticalOffset,
        ),
    );
}

function generateOneBigVat(game: Game, pos: Vec2) {
    game.map.genAuto("vat_02", pos, 0, 0);
}
function generateOneWall(game: Game, pos: Vec2, rotation: number) {
    game.map.genAuto("brick_wall_test", pos, 0, math.radToOri(rotation));
}

function getNewLoadout(): Loadout {
    return util.weightedRandom(loadouts).loadout;
}

function getRespawnDelay(player: Player): number {
    return 8;
}

function bedBroken(bed: Bed, game: Game) {
    const colorString = TeamColorToString[bed.color];
    bed.broken = true;
    game.playerBarn.addKillFeedLine(-1, [
        createSimpleSegment(
            `${colorString.toUpperCase()} BED HAS BEEN BROKEN`,
            colorString,
        ),
    ]);
}

function shouldBedDamageBeNotified(oldHP: number, newHP: number) {
    if (newHP < 0) {
        return false;
    }
    if (newHP < 100) {
        return true;
    }
    if (Math.floor(oldHP / 100) > Math.floor(newHP / 100)) {
        return true;
    }
    return false;
}

function bedWillTakeDamage(bed: Bed, game: Game, dmg: number) {
    const oldHealth = bed.obstacleRef.health;
    const newHealth = oldHealth - dmg;
    if (shouldBedDamageBeNotified(oldHealth, newHealth)) {
        game.playerBarn.addKillFeedLine(-1, [
            createSimpleSegment(
                `${TeamColorToString[bed.color]} bed is on ${Math.round(newHealth)} HP`,
                TeamColorToString[bed.color],
            ),
        ]);
    }
}

function modifyGas(plugin: GamePlugin) {
    const gas = plugin.game.gas;
    plugin.on("gameStarted", (event, ctx) => {
        gas.mode = GasMode.Inactive;
        gas._running = false; //its already false but im braindead so here we are
        gas.stage = 0;
    });

    plugin.on("gasWillAdvance", (event, ctx) => {
        event.cancel();
        const { gas } = event.data;
        if (gas.stage === 0) {
            gas.stage = 1;
            gas.mode = GasMode.Waiting;
            gas._running = true;
            gas.duration = AUTO_BED_BREAK_DELAY * 60;
            gas.dirty = true;
            gas.timeDirty = true;
            plugin.game.updateData();
            return;
        }
        if (gas.stage === 1) {
            gas.stage = 2;
            gas.duration = ZONE_CLOSE_DURATION * 60;
            gas._running = true;
            gas.mode = GasMode.Moving;
            gas.posNew = plugin.game.map.center;
            gas.radNew = 0;
            gas._gasTicker = 0;
            gas.gasT = 0;
            gas.dirty = true;
            gas.timeDirty = true;
            plugin.game.updateData();
            return;
        }
    });
}

function getRandomRifle(): string {
    return util.weightedRandom([
        { weight: 2, gun: "m4a1" },
        { weight: 2, gun: "grozas" },
        { weight: 2, gun: "scorpion" },
        { weight: 1, gun: "ak47" },
        { weight: 1, gun: "hk416" },
    ]).gun;
}

function baseNadeType(): string {
    return util.weightedRandom([
        { weight: 5, t: "" },
        { weight: 3, t: "frag" },
        { weight: 1, t: "impulse" },
        { weight: 1, t: "mirv" },
    ]).t;
}

function baseMeleeType(): string {
    return util.weightedRandom([
        { weight: 85, t: "" },
        { weight: 3, t: "stonehammer" },
        { weight: 5, t: "machete" },
        // {weight: 5, t: "impulse_gloves"},
        { weight: 3, t: "hook" },
        { weight: 3, t: "katana" },
        { weight: 1, t: "naginata" },
    ]).t;
}

const loadouts = [
    {
        weight: 1,
        loadout: {
            primary: "sv98",
            secondary: "sv98",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 2,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "spas12",
            secondary: "sv98",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 2,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "m870",
            secondary: "sv98",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "mosin",
            secondary: "mosin",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 2,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "spas12",
            secondary: "mosin",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 2,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "m870",
            secondary: "mosin",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "blr",
            secondary: "blr",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "spas12",
            secondary: "blr",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "m870",
            secondary: "blr",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "scout_elite",
            secondary: "scout_elite",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "spas12",
            secondary: "scout_elite",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "m870",
            secondary: "scout_elite",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "garand",
            secondary: "garand",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "spas12",
            secondary: "garand",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "m870",
            secondary: "garand",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "spas12",
            secondary: "model94",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 3,
            helmetLevel: 2,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "m870",
            secondary: "model94",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 3,
            helmetLevel: 2,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "spas12",
            secondary: "famas",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 3,
            helmetLevel: 2,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "m870",
            secondary: "famas",
            melee: baseMeleeType,
            nadeType: "impulse",
            nadeCount: 1,
            chestLevel: 3,
            helmetLevel: 2,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "sv98",
            secondary: "qbb97",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "spas12",
            secondary: "qbb97",
            melee: baseMeleeType,
            nadeType: baseNadeType,
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "m870",
            secondary: "qbb97",
            melee: baseMeleeType,
            nadeType: "impulse",
            nadeCount: 1,
            chestLevel: 3,
            helmetLevel: 3,
        },
    },
    {
        weight: 3,
        loadout: {
            primary: "sv98",
            secondary: getRandomRifle,
            melee: baseMeleeType,
            nadeType: "impulse",
            nadeCount: 1,
            chestLevel: 3,
            helmetLevel: 3,
        },
    },
    {
        weight: 3,
        loadout: {
            primary: "spas12",
            secondary: getRandomRifle,
            melee: baseMeleeType,
            nadeType: "impulse",
            nadeCount: 1,
            chestLevel: 3,
            helmetLevel: 3,
        },
    },
    {
        weight: 3,
        loadout: {
            primary: "m870",
            secondary: getRandomRifle,
            melee: baseMeleeType,
            nadeType: "impulse",
            nadeCount: 2,
            chestLevel: 3,
            helmetLevel: 3,
        },
    },
    {
        weight: 1,
        loadout: {
            primary: "spas12",
            secondary: "saiga",
            melee: baseMeleeType,
            nadeType: "impulse",
            nadeCount: 1,
            chestLevel: 2,
            helmetLevel: 3,
        },
    },
];
