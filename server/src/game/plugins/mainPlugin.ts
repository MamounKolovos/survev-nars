import type { LootSpawnDef } from "../../../../shared/defs/mapObjectsTyping";
import { TimerManager } from "../../utils/pluginUtils";
import { GamePlugin } from "../pluginManager";
import {
    attachCustomGasDamage,
    attachCustomQuickSwitch,
    attachDonutSpawner,
    attachGracePeriod,
    attachKillRewards,
    attachLootPingNotification,
    attachMovingGas,
    attachObstacleDeathLoot,
    attachTimerManagerUpdate,
    autoLoot,
    tierLoot,
} from "./internalUtils";

const GRACE_PERIOD = 15;
const CUSTOM_SWITCH_DELAY = 0.205;

const obstacleToLoot: Record<string, LootSpawnDef[]> = {
    chest_04: [autoLoot("helmet03_grenadier", 1)],
    case_07: [tierLoot("tier_club_bonus", 1, 1)],
};

export default class MainPlugin extends GamePlugin {
    timerManager = new TimerManager();

    override initListeners(): void {
        attachTimerManagerUpdate(this);

        attachGracePeriod(this, GRACE_PERIOD, GRACE_PERIOD, 5);

        attachMovingGas(this, {
            firstMovingZone: 4,
            stationaryZoneRadiusMultiplier: 0.55,
            movingZoneRadiusMultiplier: 0.8,
            damages: [1, 2, 4, 6, 8, 10],
            initWaitTime: 100,
            minWaitTime: 20,
            waitTimeDecrement: 20,
            initMovingTime: 30,
            minMovingTime: 15,
            movingTimeDecrement: 5,
            movingZoneOffset: 1,
            minRadius: 10,
        });

        attachDonutSpawner(this, 0.75, 0.9);

        attachCustomQuickSwitch(this, CUSTOM_SWITCH_DELAY);

        attachKillRewards(this, true, true);

        attachObstacleDeathLoot(this, obstacleToLoot);

        attachCustomGasDamage(
            this,
            (dmg: number, sec: number, stage: number) =>
                dmg * (1 + Math.min(sec, 20) / 10),
        );

        attachLootPingNotification(this, 2, 5);
    }
}
