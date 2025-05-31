import { DamageType } from "../../../../shared/gameConfig";
import { v2 } from "../../../../shared/utils/v2";
import type { Gas } from "../objects/gas";
import { GamePlugin } from "../pluginManager";

export default class gasDamageScalingPlugin extends GamePlugin {
    public override initListeners(): void {
        if (false) return;
        this.on("gameUpdate", (event) => {
            const { game, dt } = event.data;
            updateGasDamage(dt, game.gas);
        });
    }
}

const secondsInZone: Record<number, number> = {};
function updateGasDamage(dt: number, g: Gas) {
    for (const p of g.game.playerBarn.players) {
        if (g.isInGas(p.pos)) {
            const idfk = secondsInZone[p.__id] - Math.floor(secondsInZone[p.__id]);
            if (idfk < 1 && idfk + dt > 1) {
                p.damage({
                    damageType: DamageType.Gas,
                    amount: g.damage * (1 + Math.min(secondsInZone[p.__id], 20) / 10),
                    dir: v2.create(1, 0),
                });
            }
            secondsInZone[p.__id] += dt;
        } else {
            secondsInZone[p.__id] = 0;
        }
    }
}
