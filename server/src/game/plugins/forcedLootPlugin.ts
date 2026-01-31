import { GameObjectDefs } from "../../../../shared/defs/gameObjectDefs";
import type { GunDef } from "../../../../shared/defs/gameObjects/gunDefs";
import { MapId } from "../../../../shared/defs/types/misc";
import { DamageType, GameConfig } from "../../../../shared/gameConfig";
import { ObjectType } from "../../../../shared/net/objectSerializeFns";
import { collider } from "../../../../shared/utils/collider";
import { util } from "../../../../shared/utils/util";
import { v2 } from "../../../../shared/utils/v2";
import { TimerManager, createSimpleSegment } from "../../utils/pluginUtils";
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
const MIN_NUM_ROLES_TO_NOT_NAME_PLAYERS = 2;

//raise above 0.5 to artifically boost the strength of most non sniper/shotgun loadouts, vice versa also applies
//added only because tweaking this is easier than going through the whole strength function if you want to tweak strength distrubutions for role/armor distribution purposes
const BETTER_STRENGTH_WEIGHT = 0.5;

const MELEE_STRENGTH_WEIGHT = 0.04; //how much melee strength impacts total strength (relative to guns)

//a value inbetween will be used depending on how strong the player's weapons are
const MIN_LEVEL_3_ARMOR_CHANCE = 0.25;
const MAX_LEVEL_3_ARMOR_CHANCE = 1.0;
const MIN_ROLE_CHANCE = 0.1;
const MAX_ROLE_CHANCE = 0.3;
const roleWeights = [
    { weight: 1, role: "medic" },
    { weight: 1, role: "grenadier" },
    { weight: 1, role: "lieutenant" },
    { weight: 1, role: "recon" },
];

// const vestWeights = [
//     { weight: 0, vest: "chest01" },
//     { weight: 70, vest: "chest02" },
//     { weight: 30, vest: "chest03" },
// ];

// const helmetWeights = [
//     { weight: 0, helmet: "helmet01" },
//     { weight: 75, helmet: "helmet02" },
//     { weight: 25, helmet: "helmet03" },
// ];

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
    // { weight: 1, gun: "m1014" },
    { weight: 0.5, gun: "mk12" },
    { weight: 0.5, gun: "m39" },

    { weight: 0.8, gun: "deagle_dual" },
    { weight: 0.3, gun: "saiga" },
    { weight: 1.5, gun: "famas" },
    { weight: 1.5, gun: "an94" },
    { weight: 0.5, gun: "p30l_dual" },
    { weight: 0.001, gun: "awc" },
];

const meleeWeights = [
    { weight: 50, melee: "" },
    { weight: 15, melee: "stonehammer" },
    { weight: 15, melee: "machete" },
    { weight: 15, melee: "impulse_gloves" },
    { weight: 10, melee: "hook" },
    { weight: 5, melee: "katana" },
    { weight: 5, melee: "naginata" },
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
            if (x < 0.75) {
                return "m870";
            }
            return util.weightedRandom(gt.rifles).gun;
        }
        case "famas":
        case "an94": {
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
            if (x < 0.2) {
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
        case "m39":
        case "mk12": {
            if (x < 0.5) {
                return "m870";
            }
            if (x < 0.75) {
                return "spas12";
            }
            return util.weightedRandom(gt.rifles).gun;
        }
        case "garand": {
            if (x < 0.05) {
                return "garand";
            }
            if (x < 0.5) {
                return "m870";
            }
            if (x < 0.75) {
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
        const primary = getPrimaryBasedOnSecondary(secondary);
        const melee = util.weightedRandom(meleeWeights).melee;

        const totalWeaponStrength = getTotalWeaponStrength(primary, secondary, melee);

        const modifiedRoleChance =
            MAX_ROLE_CHANCE - totalWeaponStrength * (MAX_ROLE_CHANCE - MIN_ROLE_CHANCE);
        const role =
            Math.random() < modifiedRoleChance
                ? util.weightedRandom(roleWeights).role
                : "";

        const modifiedlvl3armorchance =
            MAX_LEVEL_3_ARMOR_CHANCE -
            totalWeaponStrength * (MAX_LEVEL_3_ARMOR_CHANCE - MIN_LEVEL_3_ARMOR_CHANCE);
        const helmet =
            Math.random() < modifiedlvl3armorchance - modifiedRoleChance
                ? "helmet03"
                : "helmet02";
        //role chance subtracted since roles come with level 3 helmet
        const vest = Math.random() < modifiedlvl3armorchance ? "chest03" : "chest02";

        const loadout: Loadout = {
            vest: vest,
            helmet: helmet,
            secondary: secondary,
            primary: primary,
            melee: melee,
            role: role,
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
        case "grenadier": {
            player.promoteToRole("grenadier");
            break;
        }
        case "lieutenant": {
            player.promoteToRole("lieutenant");
            break;
        }
        case "recon": {
            player.promoteToRole("recon");
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
        case "grenadier": {
            player.inventory["frag"] += 4;
            player.inventory["strobe"] += 1;
            break;
        }
        case "recon": {
            player.inventory["impulse"] = 3;
            player.inventory["frag"] = 2;
            player.inventory["smoke"] = 0;
            player.inventory["mirv"] = 0;
            break;
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
    let roleCount = 0;
    for (let i = 0; i < 4; i++) {
        if (loadouts[i].role !== "") {
            roleCount += 1;
        }
    }
    if (roleCount < MIN_NUM_ROLES_TO_NOT_NAME_PLAYERS) {
        listSquadNames(game);
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
        case "qbb97": {
            if (Math.random() < 0.4) return "pkp";
            break;
        }
        case "m39":
        case "mk12": {
            if (Math.random() < 0.4) return "garand";
        }
        case "famas": {
            if (Math.random() < 0.5 && g !== "mk12" && g !== "m39") return "an94";
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
const sniperStrengths: Record<string, number> = {
    sv98: 1,
    mosin: 0.95,
    blr: 0.9,
    scout_elite: 0.8,
    model: 0.8,
    garand: 0.9,
};
const gunStrengths: Record<string, number> = {
    spas12: 0.9,
    m870: 0.3,
    sv98: 1,
    mosin: 0.9,
    model94: 0.9,
    scout_elite: 0.6,
    blr: 0.7,
    garand: 0.9,
    pkp: 0.9,
    m249: 0.7,
    qbb97: 0.5,
    dp28: 0.0,
    m4a1: 0.3,
    scorpion: 0.2,
    grozas: 0.2,
    ak47: 0,
    hk416: 0,
    scar: 0.0,
    mk12: 0.1,
    m39: 0.1,
    deagle_dual: 0.2,
    famas: 0.25,
    an94: 0.5,
    bar: 0.0,
    p30l_dual: 0.75,
    vector: 0.1,
    awc: 0, //xd
    m9: 0,
};
function getTotalGunStrength(primary: string, secondary: string): number {
    if (primary == "spas12") {
        switch (secondary) {
            case "sv98":
                return 1;
            case "mosin":
                return 0.95;
            case "m1014":
                return 0.92;
            case "scout_elite":
                return 0.85;
            case "blr":
                return 0.88;
            case "model":
                return 0.75;
            case "pkp":
                return 0.95;
            case "m249":
                return 0.9;
            case "qbb97":
                return 0.75;
            case "dp28":
                return 0.5;
            case "famas":
                return 0.65;
            case "an94":
                return 0.75;
            case "bar":
                return 0.45;
            case "garand":
                return 0.9;
            case "mk12":
                return 0.35;
            case "m39":
                return 0.35;
            case "saiga":
                return 0.0; //i dont think spas saiga is actually this weak but i want it to have more armor/rolescase
            case "p30l_dual":
                0.8;
            case "deagle_dual":
                return 0.45;
            case "m4a1":
                return 0.6;
            case "scorpion":
                return 0.6;
            case "grozas":
                return 0.6;
            case "ak47":
                return 0.5;
            case "hk416":
                return 0.5;
            case "scar":
                return 0.45;
            default:
                return -1;
        }
    }
    if (primary == "m870") {
        switch (secondary) {
            case "sv98":
                return 0.75;
            case "mosin":
                return 0.7;
            case "m1014":
                return 0.75;
            case "scout_elite":
                return 0.5;
            case "blr":
                return 0.55;
            case "model":
                return 0.7;
            case "pkp":
                return 0.9;
            case "m249":
                return 0.75;
            case "qbb97":
                return 0.65;
            case "dp28":
                return 0.35;
            case "famas":
                return 0.4;
            case "an94":
                return 0.45;
            case "bar":
                return 0.0;
            case "garand":
                return 0.8;
            case "mk12":
                return 0.25;
            case "m39":
                return 0.25;
            case "deagle_dual":
                return 0.0;
            case "m4a1":
                return 0.25;
            case "scorpion":
                return 0.2;
            case "grozas":
                return 0.2;
            case "ak47":
                return 0.1;
            case "hk416":
                return 0.05;
            case "scar":
                return 0.0;
            default:
                return -1;
        }
    }
    if (secondary == "model94" && primary == "garand") {
        return 0.9;
    }
    if (
        sniperStrengths[primary] !== undefined &&
        sniperStrengths[secondary] !== undefined
    ) {
        return 0.5 * sniperStrengths[primary] + 0.5 * sniperStrengths[secondary];
    }
    if (gunStrengths[primary] !== undefined && gunStrengths[secondary] !== undefined) {
        return (
            BETTER_STRENGTH_WEIGHT *
                Math.max(gunStrengths[primary], gunStrengths[secondary]) +
            (1 - BETTER_STRENGTH_WEIGHT) *
                Math.min(gunStrengths[primary], gunStrengths[secondary])
        );
    }
    return -1;
}

function getTotalWeaponStrength(
    primary: string,
    secondary: string,
    melee: string,
): number {
    const meleeStrength = meleeStrengths[melee];
    const gunStrength = getTotalGunStrength(primary, secondary);
    return (
        MELEE_STRENGTH_WEIGHT * meleeStrength + (1 - MELEE_STRENGTH_WEIGHT) * gunStrength
    );
}

const meleeStrengths: Record<string, number> = {
    "": 0,
    stonehammer: 0.4,
    machete: 0.7,
    impulse_gloves: 0.4,
    hook: 0.1,
    katana: 1.0,
    naginata: 0.9,
};

const gt = {
    goodSprays: [
        { gun: "an94", weight: 10 },
        { gun: "qbb97", weight: 10 },
        { gun: "m249", weight: 3 },
    ],
    decentSprays: [
        { gun: "scorpion", weight: 1 },
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
        { weight: 0.5, gun: "m39" },
        { weight: 0.8, gun: "deagle_dual" },
        { weight: 2, gun: "famas" },
        { weight: 2, gun: "an94" },
        { weight: 0.5, gun: "p30l_dual" },
    ],
};
const GRACE_PERIOD_DURATION = 5;

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
            GRACE_PERIOD_DURATION,
            GRACE_PERIOD_DURATION,
            GRACE_PERIOD_DURATION,
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

function listSquadNames(game: Game) {
    for (const group of game.playerBarn.groups) {
        if (
            group.players.filter((p) => !p.disconnected && !p.downed && !p.dead)
                .length === 0
        ) {
            continue;
        }
        let kfline = group.players[0].name;
        for (let i = 1; i < group.players.length; i++) {
            kfline += `-${group.players[i].name}`;
        }
        game.playerBarn.addKillFeedLine(-1, [createSimpleSegment(kfline, "white")]);
    }
}
