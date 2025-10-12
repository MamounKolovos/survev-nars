import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import { MapId } from "../../../../shared/defs/types/misc";
import { DamageType, GameConfig } from "../../../../shared/gameConfig";
import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { collider } from "../../../../shared/utils/collider";
import { util } from "../../../../shared/utils/util";
import { v2 } from "../../../../shared/utils/v2";
import { TimerManager } from "../../utils/pluginUtils";
import type { Game } from "../game";
import type { Obstacle } from "../objects/obstacle";
import type { Player } from "../objects/player";
import { GamePlugin } from "../pluginManager";
import {
    attachCustomGasDamage,
    attachCustomQuickSwitch,
    attachDonutSpawner,
    attachGracePeriod,
    attachKillRewards,
    attachLocationRevealer,
    attachLootDisabler,
    attachLootPingNotification,
    attachMovingGas,
    attachTimerManagerUpdate,
} from "./internalUtils";

interface Loadout {
    vest: string;
    helmet: string;
    primary: string;
    secondary: string;
    melee: string;
    role: string;
}

const roleWeights = [
    { weight: 4, role: "" },
    { weight: 4, role: "medic" },
    { weight: 84, role: "recon" },
    { weight: 4, role: "grenadier" },
    { weight: 4, role: "lieutenant" },
];

const vestWeights = [
    { weight: 0, vest: "chest01" },
    { weight: 70, vest: "chest02" },
    { weight: 30, vest: "chest03" },
];

const helmetWeights = [
    { weight: 0, helmet: "helmet01" },
    { weight: 70, helmet: "helmet02" },
    { weight: 30, helmet: "helmet03" },
];

const primaryWeights = [
    { weight: 45, gun: "spas12" },
    { weight: 15, gun: "m870" },
    { weight: 40, gun: "" }, //primary will be turned into another secondary
];

const secondaryWeights = [
    { weight: 1, gun: "sv98" },
    { weight: 3, gun: "mosin" },
    { weight: 2, gun: "model94" },
    { weight: 2, gun: "scout_elite" },
    { weight: 4, gun: "blr" },
    { weight: 0.3, gun: "pkp" },
    { weight: 0.5, gun: "m249" },
    { weight: 2, gun: "qbb97" },
    { weight: 1, gun: "dp28" },
    { weight: 1, gun: "m4a1" },
    { weight: 1, gun: "scorpion" },
    { weight: 1, gun: "grozas" },
    { weight: 1, gun: "ak47" },
    { weight: 1, gun: "hk416" },
    { weight: 1, gun: "scar" },
    { weight: 1, gun: "garand" },
    { weight: 1, gun: "m1014" },
    { weight: 0.5, gun: "mk12" },
    { weight: 0.8, gun: "deagle_dual" },
    { weight: 0.3, gun: "saiga" },
    { weight: 1.5, gun: "famas" },
    { weight: 1.5, gun: "an94" },
    { weight: 1.5, gun: "bar" },
    { weight: 0.5, gun: "p30l_dual" },
    { weight: 0.001, gun: "awc" },
];

const meleeWeights = [
    { weight: 80, melee: "" },
    { weight: 7, melee: "machete" },
    { weight: 7, melee: "katana" },
    { weight: 4, melee: "stonehammer" },
    { weight: 1, melee: "hook" },
    { weight: 1, melee: "woodaxe" },
];
function getPrimaryBasedOnSecondary(secondary: string): string {
    const x = Math.random();
    switch (secondary) {
        case "sv98":
        case "mosin":
        case "m1014":
        case "scout_elite":
        case "blr": {
            if (x < 0.6) {
                return "spas12";
            }
            if (x < 0.7) {
                return "m870";
            }
            if (x < 0.8) {
                return util.weightedRandom(gt.bigClipSnipers).gun;
            }
            if (x < 0.82) {
                return "garand";
            }
            return util.weightedRandom(gt.anySprays).gun;
        }
        case "model94": {
            if (x < 0.2) {
                return "spas12";
            }
            if (x < 0.3) {
                return "m870";
            }
            if (x < 0.33) {
                return "garand";
            }
            if (x < 0.4) {
                return "model94";
            }
            return util.weightedRandom(gt.anySprays).gun;
        }
        case "dp28":
        case "qbb97": {
            if (Math.random() < 0.3) {
                return "spas12";
            }
        }
        case "m249":
        case "pkp": {
            if (x < 0.05) {
                return "spas12";
            }
            if (x < 0.7) {
                return "m870";
            }
            if (x < 0.75) {
                return "vector";
            }
            return util.weightedRandom(gt.rifles).gun;
        }
        case "famas":
        case "an94": {
            if (Math.random() < 0.4) {
                return "spas12";
            }
        }
        case "bar": {
            if (Math.random() < 0.4) {
                return "spas12";
            }
        }
        case "p30l_dual":
        case "deagle_dual":
        case "m4a1":
        case "scorpion":
        case "grozas":
        case "ak47":
        case "hk416":
        case "scar": {
            if (x < 0.25) {
                return util.weightedRandom(gt.rifles).gun;
            }
            if (x < 0.75) {
                return "spas12";
            }
            return "m870";
        }
        case "saiga": {
            return "spas12";
        }
        case "mk12": {
            if (x < 0.4) {
                return "m870";
            }
            if (x < 0.65) {
                return "spas12";
            }
            return util.weightedRandom(gt.rifles).gun;
        }
        case "garand": {
            if (x < 0.05) {
                return "garand";
            }
            if (x < 0.35) {
                return "m870";
            }
            if (x < 0.7) {
                return util.weightedRandom(gt.rifles).gun;
            }
            return "spas12";
        }
    }

    return "m9";
}

function generateFairLootLoadouts(): Loadout[] {
    let loadouts: Loadout[] = [];
    for (let i = 0; i < 4; i++) {
        const secondary = util.weightedRandom(secondaryWeights).gun;
        const loadout: Loadout = {
            vest: util.weightedRandom(vestWeights).vest,
            helmet: util.weightedRandom(helmetWeights).helmet,
            secondary: secondary,
            primary: getPrimaryBasedOnSecondary(secondary),
            melee: util.weightedRandom(meleeWeights).melee,
            role: util.weightedRandom(roleWeights).role,
        };
        loadouts.push(loadout);
    }
    return loadouts;
}

function givePlayerFairLootLoadout(player: Player, loadout: Loadout) {
    switch (loadout.role) {
        case "medic": {
            player.promoteToRole("medic");
            break;
        }
         case "recon": {
            player.promoteToRole("recon");
            break;
        }
        case "grenadier": {
            player.promoteToRole("grenadier");
            break;
        }
        case "lieutenant": {
            player.promoteToRole("lieutenant");
            break;
        }
    }

    player.chest = loadout.vest;
    if (!player.helmet) {
        player.helmet = loadout.helmet;
    }
    player.weaponManager.setWeapon(
        GameConfig.WeaponSlot.Primary,
        loadout.primary,
        (GameObjectDefs[loadout.primary] as GunDef).maxClip,
    );
    player.weaponManager.setWeapon(
        GameConfig.WeaponSlot.Secondary,
        loadout.secondary,
        (GameObjectDefs[loadout.secondary] as GunDef).maxClip,
    );
    player.weaponManager.setWeapon(GameConfig.WeaponSlot.Melee, loadout.melee, 0);

    player.inventory["2xscope"] = 1;
    player.inventory["4xscope"] = 1;
    player.scope = "4xscope";

    player.boost = 100;
    player.inventory["bandage"] = 15;
    player.inventory["healthkit"] = 2;
    player.inventory["soda"] = 4;
    player.inventory["painkiller"] = 1;

    player.backpack = "backpack02";
    player.addPerk("endless_ammo");

    player.weapons[3].type = "frag";
    player.inventory["frag"] = 1;
    player.inventory["smoke"] = 1;
    player.inventory["mirv"] = 1;
    // if (player.game.map.mapId === MapId.ForcedLoot2) {
    //     player.inventory["impulse"] = 2;
    // }

    switch (loadout.role) {
        case "medic": {
            player.inventory["healthkit"] += 1;
            player.inventory["smoke"] += 2;
            break;
        }
        case "recon": {
            player.inventory["smoke"] += 2;
            player.inventory["impulse"] += 3;
            break;
        }
        case "grenadier": {
            player.inventory["frag"] += 3;
            player.inventory["mirv"] += 1;
            break;
        }
        case "lieutenant": {
            player.inventory["frag"] += 1;
            player.inventory["smoke"] += 1;
        }
    }

    player.boostDirty = true;
    player.zoomDirty = true;
    player.weapsDirty = true;
    player.inventoryDirty = true;
}

function giveEveryoneFairLoot(game: Game) {
    const loadouts = generateFairLootLoadouts();
    for (const group of game.playerBarn.groups) {
        const players: Player[] = [...group.players];
        util.shuffleArray(players);
        for (let i = 0; i < players.length; i++) {
            givePlayerFairLootLoadout(players[i], loadouts[i]);
        }
    }
}

const maxDistFromAirdrop = 8;
function airdropUpgradeAttempt(
    game: Game,
    obs: Obstacle,
    damagePerTick: number,
    endTimer: () => void,
) {
    const nearyByPlayers = game.grid
        .intersectCollider(collider.createCircle(obs.pos, maxDistFromAirdrop))
        .filter(
            (obj): obj is Player =>
                obj.__type == ObjectType.Player &&
                obj.layer === obs.layer &&
                v2.distance(obs.pos, obj.pos) < maxDistFromAirdrop,
        );
    if (nearyByPlayers.length === 0) return;
    const gunUpgrade = obs.health === 200;
    for (let i = 0; i < 100; i++) {
        const p = nearyByPlayers[Math.floor(Math.random() * nearyByPlayers.length)];
        if (playerUpgradeAttempt(p, gunUpgrade)) {
            obs.damage({
                amount: damagePerTick,
                damageType: DamageType.Airdrop,
                dir: v2.create(1, 0),
            });
            if (obs.health <= 0) {
                endTimer();
            }
            if (gunUpgrade) {
                p.weapsDirty = true;
            }
            p.setDirty();
            return;
        }
    }
}

//returns true if an upgrade was successfully preformed
function playerUpgradeAttempt(p: Player, gunUpgrade: boolean): boolean {
    if (gunUpgrade) {
        const idx = Math.floor(Math.random() * 2);
        const gunType = p.weaponManager.weapons[idx].type;
        const newGunType = getUpgradedGun(gunType);
        if (newGunType === "") return false;
        p.weaponManager.setWeapon(
            idx,
            newGunType,
            (GameObjectDefs[newGunType] as GunDef).maxClip,
        );
        return true;
    }
    if (Math.random() < 0.5) {
        if (p.chest === "chest01") {
            p.chest = "chest02";
            return true;
        }
        if (p.chest === "chest02" && Math.random() < 0.5) {
            p.chest = "chest03";
            return true;
        }
    } else {
        if (p.helmet === "helmet01") {
            p.helmet = "helmet02";
            return true;
        }
        if (p.helmet === "helmet02" && Math.random() < 0.5) {
            p.helmet = "helmet03";
            return true;
        }
    }
    return false;
}

function getUpgradedGun(g: string): string {
    switch (g) {
        case "m870": {
            return "spas12";
        }
        case "m1014":
        case "mosin": {
            if (Math.random() < 0.3) return "sv98";
            break;
        }
        case "blr":
        case "model94":
        case "garand":
        case "scout_elite": {
            if (Math.random() < 0.5) return "mosin";
            break;
        }
        case "m249": {
            if (Math.random() < 0.6) return "pkp";
            break;
        }
        case "an94":
        case "bar":
        case "qbb97": {
            if (Math.random() < 0.4) return "pkp";
            break;
        }
        case "mk12": {
            if (Math.random() < 0.4) return "garand";
        }
        case "famas": {
            if (Math.random() < 0.5 && g !== "mk12") return "an94";
        }

        case "deagle_dual":
        case "p30l_dual":
        case "m4a1":
        case "scorpion":
        case "grozas": {
            if (Math.random() < 0.7) return util.weightedRandom(gt.goodSprays).gun;
            break;
        }
        case "vector":
        case "ak47":
        case "hk416":
        case "scar":
        case "dp28": {
            return util.weightedRandom(gt.decentSprays).gun;
        }
        default:
            return "";
    }
    return "";
}

const gt = {
    goodSprays: [
        { gun: "an94", weight: 10 },
        { gun: "qbb97", weight: 10 },
        { gun: "m249", weight: 3 },
    ],
    decentSprays: [
        { gun: "scorpion", weight: 1 },
        { gun: "bar", weight: 1 },
        { gun: "m4a1", weight: 1 },
        { gun: "grozas", weight: 1 },
    ],
    rifles: [
        { weight: 2, gun: "m4a1" },
        { weight: 2, gun: "scorpion" },
        { weight: 2, gun: "grozas" },
        { weight: 1, gun: "ak47" },
        { weight: 1, gun: "hk416" },
        { weight: 1, gun: "scar" },
    ],
    bigClipSnipers: [
        { weight: 1, gun: "sv98" },
        { weight: 2, gun: "mosin" },
        { weight: 4, gun: "scout_elite" },
        { weight: 6, gun: "blr" },
    ],
    anySprays: [
        { weight: 1, gun: "dp28" },
        { weight: 2, gun: "m4a1" },
        { weight: 2, gun: "scorpion" },
        { weight: 2, gun: "grozas" },
        { weight: 1, gun: "ak47" },
        { weight: 1, gun: "hk416" },
        { weight: 1, gun: "scar" },
        { weight: 0.5, gun: "mk12" },
        { weight: 0.8, gun: "deagle_dual" },
        { weight: 2, gun: "famas" },
        { weight: 2, gun: "an94" },
        { weight: 2, gun: "bar" },
        { weight: 0.5, gun: "p30l_dual" },
    ],
};
const GRACE_PERIOD_DURATION = 5
const GRACE_PERIOD_DURATION_DUOS = 5;

const HEALTH_AND_BOOST_ON_KILL = true;
const RELOAD_ON_KILL = true;

const CUSTOM_SWITCH_DELAY = 0.205;

export default class focedLootPlugin extends GamePlugin {
    timerManager = new TimerManager();
    public override initListeners(): void {
        if (
            this.game.map.mapId !== MapId.ForcedLoot &&
            this.game.map.mapId !== MapId.ForcedLoot2
        )
            return;
        attachLootDisabler(this);
        attachCustomQuickSwitch(this, CUSTOM_SWITCH_DELAY);
        attachTimerManagerUpdate(this);
        attachKillRewards(this, HEALTH_AND_BOOST_ON_KILL, RELOAD_ON_KILL);
        attachDonutSpawner(this, 0.7, 0.9);
        attachGracePeriod(
            this,
            (this.game.map.mapId !== MapId.ForcedLoot2) ? GRACE_PERIOD_DURATION : GRACE_PERIOD_DURATION_DUOS,
            (this.game.map.mapId !== MapId.ForcedLoot2) ? GRACE_PERIOD_DURATION : GRACE_PERIOD_DURATION_DUOS,
            (this.game.map.mapId !== MapId.ForcedLoot2) ? GRACE_PERIOD_DURATION : GRACE_PERIOD_DURATION_DUOS,
        );
        attachLootPingNotification(this, 2, 5);
        attachCustomGasDamage(
            this,
            (dmg: number, n: number, stage: number) => dmg * (1 + Math.min(n, 40) / 20),
        );
        attachMovingGas(this, {
            firstMovingZone: 4,
            stationaryZoneRadiusMultiplier: 0.55,
            movingZoneRadiusMultiplier: 0.7,
            damages: [3, 4, 6, 7, 10],
            initWaitTime: 60,
            minWaitTime: 20,
            waitTimeDecrement: 15,
            initMovingTime: 25,
            minMovingTime: 15,
            movingTimeDecrement: 5,
            movingZoneOffset: 1,
            minRadius: 20,
        });

        this.on("gameStarted", (event) => {
            giveEveryoneFairLoot(this.game);
        });

        attachLocationRevealer(this, 7);

        this.on("obstacleDidGenerate", (event) => {
            const obs = event.data.obstacle;
            if (obs.type !== "crate_10" && obs.type !== "crate_11") return;
            const numIters = obs.type === "crate_10" ? 3 : 4;
            const dmgPerTick = Math.ceil(200 / numIters);
            const id = this.timerManager.setInterval(
                () =>
                    airdropUpgradeAttempt(this.game, obs, dmgPerTick, () => {
                        this.timerManager.clearTimer(id);
                    }),
                1,
            );
        });

        this.on("obstacleWillTakeDamage", (event) => {
            const { params, obstacle } = event.data;
            if (
                (obstacle.type === "crate_10" || obstacle.type === "crate_11") &&
                params.source?.__type == ObjectType.Player
            ) {
                event.cancel();
            }
        });
        const alwaysAllowedDrops: string[] = ["Pills", "Soda", "Bandage", "Med Kit"];
        this.on("playerWillDropItem", (event) => {
            const { player, dropMsg, itemDef } = event.data;
            if (alwaysAllowedDrops.includes(itemDef.name)) {
                return;
            }
            if (player.downed) {
                if (player.downedBy && player.downedBy !== player) {
                    return;
                }
                if (player.group) {
                    let total = 0;
                    for (const p of player.group?.players) {
                        total += p.damageDealt;
                    }
                    if (total > 110) {
                        return;
                    }
                }
            }
            event.cancel();
        });
    }
}
