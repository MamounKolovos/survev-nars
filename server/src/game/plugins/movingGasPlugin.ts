import { GasMode } from "../../../../shared/gameConfig";
import { math } from "../../../../shared/utils/math";
import { util } from "../../../../shared/utils/util";
import { v2 } from "../../../../shared/utils/v2";
import type { Gas } from "../objects/gas";
import type { GamePlugin } from "../pluginManager";

export function attachMovingGas(
    plugin: GamePlugin,
    firstMovingZone: number,
    CustomGasStages: StageData[] | undefined = undefined,
) {
    plugin.on("gasWillAdvance", (event) => {
        const gas = plugin.game.gas;
        event.cancel();
        if (CustomGasStages === undefined) {
            CustomGasStages = ExampleCustomGasStages;
        }
        customGasAdvance(gas, firstMovingZone, CustomGasStages);
    });
}

function customGasAdvance(g: Gas, firstMovingZone: number, CustomGasStages: StageData[]) {
    console.log(g.stage, CustomGasStages.length);
    g.stage++;
    g._running = true;

    const stage = CustomGasStages[g.stage];

    if (!stage) {
        g._running = false;
        return;
    }

    g.mode = stage.mode;
    g.radOld = g.currentRad;
    g.radNew = stage.rad * g.mapSize;
    g.duration = stage.duration;
    g.damage = stage.damage;

    const circleIdxOld = g.circleIdx;

    if (g.mode === GasMode.Waiting) {
        g.posOld = v2.copy(g.posNew);

        if (circleIdxOld < firstMovingZone - 2) {
            g.posNew = v2.add(g.posNew, util.randomPointInCircle(g.radOld - g.radNew));
        } else {
            g.posNew = v2.add(g.posNew, v2.mul(v2.randomUnit(), g.radOld));
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

interface StageData {
    mode: GasMode;
    duration: number;
    rad: number;
    damage: number;
}

const ExampleCustomGasStages: StageData[] = [
    {
        mode: GasMode.Inactive,
        duration: 0,
        rad: 0.7,
        damage: 0,
    },
    {
        mode: GasMode.Waiting,
        duration: 80,
        rad: 0.4,
        damage: 1.4,
    },
    {
        mode: GasMode.Moving,
        duration: 30,
        rad: 0.4,
        damage: 1.4,
    },
    {
        mode: GasMode.Waiting,
        duration: 65,
        rad: 0.3,
        damage: 2.2,
    },
    {
        mode: GasMode.Moving,
        duration: 25,
        rad: 0.3,
        damage: 2.2,
    },
    {
        mode: GasMode.Waiting,
        duration: 50,
        rad: 0.2,
        damage: 3.5,
    },
    {
        mode: GasMode.Moving,
        duration: 20,
        rad: 0.2,
        damage: 3.5,
    },
    {
        mode: GasMode.Waiting,
        duration: 40,
        rad: 0.1375,
        damage: 7.5,
    },
    {
        mode: GasMode.Moving,
        duration: 15,
        rad: 0.1375,
        damage: 7.5,
    },
    {
        mode: GasMode.Waiting,
        duration: 30,
        rad: 0.09,
        damage: 10,
    },
    {
        mode: GasMode.Moving,
        duration: 15,
        rad: 0.09,
        damage: 10,
    },
    {
        mode: GasMode.Waiting,
        duration: 25,
        rad: 0.06,
        damage: 14,
    },
    {
        mode: GasMode.Moving,
        duration: 15,
        rad: 0.06,
        damage: 14,
    },
    {
        mode: GasMode.Waiting,
        duration: 20,
        rad: 0.04,
        damage: 22,
    },
    {
        mode: GasMode.Moving,
        duration: 10,
        rad: 0.04,
        damage: 22,
    },
    {
        mode: GasMode.Waiting,
        duration: 15,
        rad: 0.02,
        damage: 22,
    },
    {
        mode: GasMode.Moving,
        duration: 10,
        rad: 0.02,
        damage: 22,
    },
    {
        mode: GasMode.Waiting,
        duration: 15,
        rad: 0,
        damage: 22,
    },
    {
        mode: GasMode.Moving,
        duration: 10,
        rad: 0,
        damage: 22,
    },
];
