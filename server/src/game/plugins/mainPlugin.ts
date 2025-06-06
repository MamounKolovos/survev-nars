import type { LootSpawnDef } from "../../../../shared/defs/mapObjectsTyping";
import { TimerManager } from "../../utils/pluginUtils";
import { GamePlugin } from "../pluginManager";
import {
    attachCustomQuickSwitch,
    attachDonutSpawner,
    attachGracePeriod,
    attachKillRewards,
    attachObstacleDeathLoot,
    attachTimerManagerUpdate,
    autoLoot,
} from "./internalUtils";

const GRACE_PERIOD = 15;
const CUSTOM_SWITCH_DELAY = 0.205;

const obstacleToLoot: Record<string, LootSpawnDef[]> = {
    chest_04: [autoLoot("helmet03_grenadier", 1)],
};

export default class MainPlugin extends GamePlugin {
    timerManager = new TimerManager();

    override initListeners(): void {
        attachTimerManagerUpdate(this);

        attachGracePeriod(this, GRACE_PERIOD, GRACE_PERIOD, 5);

        //fortnite zone + zone damage scaling

        attachDonutSpawner(this, 0.75, 0.9);

        attachCustomQuickSwitch(this, CUSTOM_SWITCH_DELAY);

        attachKillRewards(this, true, true);

        attachObstacleDeathLoot(this, obstacleToLoot);
    }
}
