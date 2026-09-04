import { GameObjectDefs } from "../../shared/defs/gameObjectDefs";
import type { MeleeDef } from "../../shared/defs/gameObjects/meleeDefs";
import { GameConfig } from "../../shared/gameConfig";
import { math } from "../../shared/utils/math";
import { assert, util } from "../../shared/utils/util";
import { type Vec2, v2 } from "../../shared/utils/v2";
import type { AnimCtx, Player } from "./objects/player";

function frame(
    time: number,
    bones: Partial<Record<Bones, Pose>>,
    easing?: (t: number) => number,
) {
    return {
        time,
        bones,
        easing,
    };
}

type AnimKeys = {
    [K in keyof Player]: ((
        this: Player,
        ctx: AnimCtx,
        arg: Record<string, unknown>,
    ) => void) extends Player[K]
        ? K
        : never;
}[keyof Player];

function effect<K extends AnimKeys>(
    time: number,
    fn: K,
    args?: Parameters<Player[K]>[1],
) {
    return {
        time,
        fn,
        args,
    };
}

export class Pose {
    constructor(
        public pivot = v2.create(0, 0),
        public rot = 0,
        public pos = v2.create(0, 0),
    ) {
        this.pivot = v2.copy(pivot);
        this.rot = rot;
        this.pos = v2.copy(pos);
    }

    copy(pose: Pose) {
        v2.set(this.pivot, pose.pivot);
        this.rot = pose.rot;
        v2.set(this.pos, pose.pos);
    }

    rotate(angle: number) {
        this.rot = angle;
        return this;
    }

    offset(pos: Vec2) {
        this.pos = v2.copy(pos);
        return this;
    }

    static identity = new Pose(v2.create(0, 0));

    static lerp(t: number, poseA: Pose, poseB: Pose) {
        const result: Pose = new Pose();
        result.pos = v2.lerp(t, poseA.pos, poseB.pos);
        result.rot = math.lerp(t, poseA.rot, poseB.rot);
        result.pivot = v2.lerp(t, poseA.pivot, poseB.pivot);
        return result;
    }
}

export enum Bones {
    HandL,
    HandR,
    FootL,
    FootR,
}
assert(Object.keys(Bones).length % 2 == 0);

export const IdlePoses: Record<string, Partial<Record<Bones, Pose>>> = {
    fists: {
        [Bones.HandL]: new Pose(v2.create(14, -12.25)),
        [Bones.HandR]: new Pose(v2.create(14, 12.25)),
    },
    slash: {
        [Bones.HandL]: new Pose(v2.create(18, -8.25)),
        [Bones.HandR]: new Pose(v2.create(6, 20.25)),
    },
    meleeTwoHanded: {
        [Bones.HandL]: new Pose(v2.create(10.5, -14.25)),
        [Bones.HandR]: new Pose(v2.create(18, 6.25)),
    },
    meleeKatana: {
        [Bones.HandL]: new Pose(v2.create(8.5, 13.25)),
        [Bones.HandR]: new Pose(v2.create(-3, 17.75)),
    },
    meleeNaginata: {
        [Bones.HandL]: new Pose(v2.create(19, -7.25)),
        [Bones.HandR]: new Pose(v2.create(8.5, 24.25)),
    },
    machete: {
        [Bones.HandL]: new Pose(v2.create(14, -12.25)),
        [Bones.HandR]: new Pose(v2.create(1, 17.75)),
    },
    rifle: {
        [Bones.HandL]: new Pose(v2.create(28, 5.25)),
        [Bones.HandR]: new Pose(v2.create(14, 1.75)),
    },
    cutlass: {
        [Bones.HandL]: new Pose(v2.create(14, -12.25)),
        [Bones.HandR]: new Pose(v2.create(6, 16)),
    },
    dualRifle: {
        [Bones.HandL]: new Pose(v2.create(5.75, -16)),
        [Bones.HandR]: new Pose(v2.create(5.75, 16)),
    },
    bullpup: {
        [Bones.HandL]: new Pose(v2.create(28, 5.25)),
        [Bones.HandR]: new Pose(v2.create(24, 1.75)),
    },
    launcher: {
        [Bones.HandL]: new Pose(v2.create(20, 10)),
        [Bones.HandR]: new Pose(v2.create(2, 22)),
    },
    pistol: {
        [Bones.HandL]: new Pose(v2.create(14, 1.75)),
        [Bones.HandR]: new Pose(v2.create(14, 1.75)),
    },
    dualPistol: {
        [Bones.HandL]: new Pose(v2.create(15.75, -8.75)),
        [Bones.HandR]: new Pose(v2.create(15.75, 8.75)),
    },
    throwable: {
        [Bones.HandL]: new Pose(v2.create(15.75, -9.625)),
        [Bones.HandR]: new Pose(v2.create(15.75, 9.625)),
    },
    downed: {
        [Bones.HandL]: new Pose(v2.create(14, -12.25)),
        [Bones.HandR]: new Pose(v2.create(14, 12.25)),
        [Bones.FootL]: new Pose(v2.create(-15.75, -9)),
        [Bones.FootR]: new Pose(v2.create(-15.75, 9)),
    },
    meleeLasrSwrd: {
        [Bones.HandL]: new Pose(v2.create(10.5, 0.0)),
        [Bones.HandR]: new Pose(v2.create(18.0, 0.5)),
    },
    sai: {
        [Bones.HandL]: new Pose(v2.create(0, 0), Math.PI / 10, v2.create(3, -20)),
        [Bones.HandR]: new Pose(v2.create(0, 0), Math.PI / 20, v2.create(14, 12.25)),
    },
};

const def = GameObjectDefs as unknown as Record<string, MeleeDef>;

interface Effect<K extends AnimKeys = AnimKeys> {
    time: number;
    fn: K;
    args?: Parameters<Player[K]>[1];
}

type AnimDef = {
    keyframes: Array<{
        time: number;
        bones: Partial<Record<Bones, Pose>>;
        easing?: (t: number) => number;
    }>;
    effects: Effect[];
    streaks?: Array<{
        startTime: number;
        endTime: number;
        emitter: string;
    }>;
};

type DeepPartial<T> = T extends object
    ? {
          [P in keyof T]?: DeepPartial<T[P]>;
      }
    : T;

function deriveAnim(baseType: string, params: DeepPartial<AnimDef>): AnimDef {
    return util.mergeDeep({}, BaseAnimations[baseType], params);
}

const BaseAnimations: Record<string, AnimDef> = {
    none: {
        keyframes: [],
        effects: [],
    },
    fists: {
        keyframes: [
            frame(0, { [Bones.HandR]: new Pose(v2.create(14, 12.25)) }),
            frame(def.fists.attack.damageTimes[0], {
                [Bones.HandR]: new Pose(v2.create(29.75, 1.75)),
            }),
            frame(def.fists.attack.cooldownTime, {
                [Bones.HandR]: new Pose(v2.create(14, 12.25)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(def.fists.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    heavy_fists: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(14, -12.25)),
                [Bones.HandR]: new Pose(v2.create(14, 12.25)),
            }),
            frame(0.1, {
                [Bones.HandL]: new Pose(v2.create(25, -5)),
                [Bones.HandR]: new Pose(v2.create(-10.5, 20)).rotate(Math.PI / 8),
            }),
            frame(0.2, {
                [Bones.HandL]: new Pose(v2.create(27, -5)),
                [Bones.HandR]: new Pose(v2.create(-12.5, 20)).rotate(Math.PI / 5.5),
            }),
            frame(0.25, {
                [Bones.HandL]: new Pose(v2.create(10, -16.25)),
                [Bones.HandR]: new Pose(v2.create(29.75, 1.75)),
            }),
            frame(0.5, {
                [Bones.HandL]: new Pose(v2.create(14, -12.25)),
                [Bones.HandR]: new Pose(v2.create(14, 12.25)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(0.25, "animMeleeCollision", {}),
        ],
    },
    cut: {
        keyframes: [
            frame(0, { [Bones.HandR]: new Pose(v2.create(14, 12.25)) }),
            frame(def.fists.attack.damageTimes[0] * 0.25, {
                [Bones.HandR]: new Pose(v2.create(14, 12.25)).rotate(-Math.PI * 0.35),
            }),
            frame(def.fists.attack.damageTimes[0] * 1.25, {
                [Bones.HandR]: new Pose(v2.create(14, 12.25)).rotate(Math.PI * 0.35),
            }),
            frame(def.fists.attack.cooldownTime, {
                [Bones.HandR]: new Pose(v2.create(14, 12.25)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(def.fists.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    cutReverse: {
        keyframes: [
            frame(0, { [Bones.HandR]: new Pose(v2.create(1, 17.75)) }),
            frame(def.fists.attack.damageTimes[0] * 0.4, {
                [Bones.HandR]: new Pose(v2.create(25, 6.25)).rotate(Math.PI * 0.3),
            }),
            frame(def.fists.attack.damageTimes[0] * 1.4, {
                [Bones.HandR]: new Pose(v2.create(25, 6.25)).rotate(-Math.PI * 0.5),
            }),
            frame(def.fists.attack.cooldownTime, {
                [Bones.HandR]: new Pose(v2.create(1, 17.75)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(def.fists.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    thrust: {
        keyframes: [
            frame(0, { [Bones.HandR]: new Pose(v2.create(14, 12.25)) }),
            frame(def.fists.attack.damageTimes[0] * 0.4, {
                [Bones.HandR]: new Pose(v2.create(5, 12.25)).rotate(Math.PI * 0.1),
            }),
            frame(def.fists.attack.damageTimes[0] * 1.4, {
                [Bones.HandR]: new Pose(v2.create(25, 6.25)).rotate(-Math.PI * 0),
            }),
            frame(def.fists.attack.cooldownTime, {
                [Bones.HandR]: new Pose(v2.create(14, 12.25)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(def.fists.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    slash: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(18, -8.25)),
                [Bones.HandR]: new Pose(v2.create(6, 20.25)),
            }),
            frame(def.fists.attack.damageTimes[0], {
                [Bones.HandL]: new Pose(v2.create(6, -22.25)),
                [Bones.HandR]: new Pose(v2.create(6, 20.25)).rotate(-Math.PI * 0.6),
            }),
            frame(def.fists.attack.cooldownTime, {
                [Bones.HandL]: new Pose(v2.create(18, -8.25)),
                [Bones.HandR]: new Pose(v2.create(6, 20.25)).rotate(0),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(def.fists.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    karambitMagmaSlash: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(18, -8.25)),
                [Bones.HandR]: new Pose(v2.create(6, 20.25)),
            }),
            frame(def.fists.attack.damageTimes[0], {
                [Bones.HandL]: new Pose(v2.create(6, -22.25)),
                [Bones.HandR]: new Pose(v2.create(6, 20.25)).rotate(-Math.PI * 0.6),
            }),
            frame(def.fists.attack.cooldownTime, {
                [Bones.HandL]: new Pose(v2.create(18, -8.25)),
                [Bones.HandR]: new Pose(v2.create(6, 20.25)).rotate(0),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "fireSwing" }),
            effect(def.fists.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
        streaks: [
            {
                startTime: 0,
                endTime: def.fists.attack.damageTimes[0],
                emitter: "streak_fire",
            },
        ],
    },
    spin: {
        keyframes: [
            frame(0, {
                [Bones.HandR]: new Pose(v2.create(0, 0), Math.PI, v2.create(-3, 20.25)),
            }),
            frame(def.karambit.anim.deploy!.duration, {
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -Math.PI * 4,
                    v2.create(6, 20.25),
                ),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(0.2, "animPlaySound", { sound: "swing" }),
        ],
    },
    swipeSpin: {
        keyframes: [
            frame(0, {
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -Math.PI * 1.5,
                    v2.create(18, -8.25),
                ),
            }),
            frame(0.075, {
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -Math.PI * 1.1,
                    v2.create(5, -14.25),
                ),
            }),
            frame(0.125, {
                [Bones.HandR]: new Pose(v2.create(0, 0), -Math.PI, v2.create(5, -14.25)),
            }),
            frame(0.2, {
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -Math.PI / 2,
                    v2.create(30, -8.25),
                ),
            }),
            frame(0.23, {
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -Math.PI / 2,
                    v2.create(33, -8.25),
                ),
            }),
            frame(0.3, {
                [Bones.HandR]: new Pose(v2.create(0, 0), 0, v2.create(10.8, 14.25)),
            }),
            frame(def.karambit.anim.deploy!.duration, {
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    Math.PI * 2,
                    v2.create(6, 20.25),
                ),
            }),
        ],
        effects: [
            effect(0.075, "animPlaySound", { sound: "swing" }),
            effect(0.2, "animPlaySound", { sound: "heavySwing" }),
        ],
    },
    rapidSpin: {
        keyframes: [
            frame(0, {
                [Bones.HandR]: new Pose(v2.create(0, 0), Math.PI, v2.create(-3, 20.25)),
            }),
            frame(0.25, {
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -Math.PI * 3,
                    v2.create(20, 10.25),
                ),
            }),
            frame(0.35, {
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -Math.PI * 3.3,
                    v2.create(20, 10.25),
                ),
            }),
            frame(def.karambit.anim.deploy!.duration, {
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -Math.PI * 2,
                    v2.create(6, 20.25),
                ),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(0.15, "animPlaySound", { sound: "swing" }),
        ],
    },
    hook: {
        keyframes: [
            frame(0, { [Bones.HandR]: new Pose(v2.create(14, 12.25)) }),
            frame(def.hook.attack.damageTimes[0] * 0.25, {
                [Bones.HandR]: new Pose(v2.create(14, 12.25)).rotate(Math.PI * 0.1),
            }),
            frame(def.hook.attack.damageTimes[0], {
                [Bones.HandR]: new Pose(v2.create(24, 1.75)),
            }),
            frame(def.hook.attack.damageTimes[0] + 0.05, {
                [Bones.HandR]: new Pose(v2.create(14, 12.25)).rotate(Math.PI * -0.3),
            }),
            frame(def.hook.attack.damageTimes[0] + 0.1, {
                [Bones.HandR]: new Pose(v2.create(14, 12.25)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(def.hook.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    saiLRL: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(0, 0), Math.PI / 10, v2.create(3, -20)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    Math.PI / 20,
                    v2.create(14, 12.25),
                ),
            }),
            // FIRST HIT
            frame(
                def.sai.attack.damageTimes[0],
                {
                    [Bones.HandL]: new Pose(
                        v2.create(0, 0),
                        -Math.PI / 20,
                        v2.create(25, -5),
                    ),
                    [Bones.HandR]: new Pose(
                        v2.create(0, 0),
                        Math.PI / 20,
                        v2.create(8, 14.125),
                    ),
                },
                math.easeOutQuart,
            ),
            frame(0.15, {
                [Bones.HandL]: new Pose(
                    v2.create(0, 0),
                    -Math.PI / 20,
                    v2.create(10, -10),
                ),
                [Bones.HandR]: new Pose(v2.create(0, 0), -Math.PI / 12, v2.create(2, 16)),
            }),
            frame(0.2, {
                [Bones.HandL]: new Pose(
                    v2.create(0, 0),
                    -Math.PI / 20,
                    v2.create(10, -10),
                ),
                [Bones.HandR]: new Pose(v2.create(0, 0), -Math.PI / 12, v2.create(0, 17)),
            }),
            // SECOND HIT
            frame(
                def.sai.attack.damageTimes[1],
                {
                    [Bones.HandL]: new Pose(
                        v2.create(0, 0),
                        Math.PI / 10,
                        v2.create(3, -20),
                    ),
                    [Bones.HandR]: new Pose(
                        v2.create(0, 0),
                        Math.PI / 10,
                        v2.create(29, 2),
                    ),
                },
                math.easeOutQuart,
            ),
            // THIRD HIT
            frame(
                def.sai.attack.damageTimes[2],
                {
                    [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(25, -7)),
                    [Bones.HandR]: new Pose(
                        v2.create(0, 0),
                        Math.PI / 20,
                        v2.create(10, 14.25),
                    ),
                },
                math.easeOutQuart,
            ),
            frame(0.6, {
                [Bones.HandL]: new Pose(v2.create(0, 0), Math.PI / 10, v2.create(3, -20)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    Math.PI / 20,
                    v2.create(14, 12.25),
                ),
            }),
        ],
        effects: [
            effect(0.0, "animPlaySound", { sound: "swing" }),
            effect(0.0, "animMeleeCollision", {}),
            effect(0.2, "animPlaySound", { sound: "swing" }),
            effect(0.2, "animMeleeCollision", {}),
            effect(0.3, "animPlaySound", { sound: "swing" }),
            effect(0.3, "animMeleeCollision", {}),
        ],
    },
    saiBRR: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(0, 0), Math.PI / 10, v2.create(3, -20)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    Math.PI / 20,
                    v2.create(14, 12.25),
                ),
            }),
            // FIRST HIT
            frame(
                def.sai.attack.damageTimes[0],
                {
                    [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(25, -5)),
                    [Bones.HandR]: new Pose(v2.create(0, 0), 0, v2.create(29, 2)),
                },
                math.easeOutExpo,
            ),
            frame(0.2, {
                [Bones.HandL]: new Pose(
                    v2.create(0, 0),
                    -Math.PI / 20,
                    v2.create(14, -15),
                ),
                [Bones.HandR]: new Pose(v2.create(0, 0), -Math.PI / 12, v2.create(17, 5)),
            }),
            // SECOND HIT
            frame(
                def.sai.attack.damageTimes[1],
                {
                    [Bones.HandL]: new Pose(
                        v2.create(0, 0),
                        -Math.PI / 20,
                        v2.create(12, -11.5),
                    ),
                    [Bones.HandR]: new Pose(v2.create(0, 0), 0, v2.create(29, 2)),
                },
                math.easeOutQuart,
            ),
            frame(0.35, {
                [Bones.HandL]: new Pose(
                    v2.create(0, 0),
                    -Math.PI / 20,
                    v2.create(12, -11.5),
                ),
                [Bones.HandR]: new Pose(v2.create(0, 0), -Math.PI / 12, v2.create(13, 5)),
            }),
            // THIRD HIT
            frame(
                def.sai.attack.damageTimes[2],
                {
                    [Bones.HandL]: new Pose(
                        v2.create(0, 0),
                        -Math.PI / 20,
                        v2.create(12, -11.5),
                    ),
                    [Bones.HandR]: new Pose(v2.create(0, 0), 0, v2.create(29, 2)),
                },
                math.easeOutQuart,
            ),
            frame(0.6, {
                [Bones.HandL]: new Pose(v2.create(0, 0), Math.PI / 10, v2.create(3, -20)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    Math.PI / 20,
                    v2.create(14, 12.25),
                ),
            }),
        ],
        effects: [
            effect(0.0, "animPlaySound", { sound: "swing" }),
            effect(0.0, "animPlaySound", { sound: "swing" }),
            effect(0.0, "animMeleeCollision", {}),
            effect(0.2, "animPlaySound", { sound: "swing" }),
            effect(0.2, "animMeleeCollision", {}),
            effect(0.3, "animPlaySound", { sound: "swing" }),
            effect(0.3, "animMeleeCollision", {}),
        ],
    },
    saiMirroredSpin: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(0, 0), -Math.PI, v2.create(-7, -20)),
                [Bones.HandR]: new Pose(v2.create(0, 0), Math.PI, v2.create(-7, 20.25)),
            }),
            frame(
                def.sai.anim.deploy!.duration,
                {
                    [Bones.HandL]: new Pose(
                        v2.create(0, 0),
                        Math.PI * 4 + Math.PI / 10,
                        v2.create(3, -20),
                    ),
                    [Bones.HandR]: new Pose(
                        v2.create(0, 0),
                        -Math.PI * 4 + Math.PI / 20,
                        v2.create(14, 12.25),
                    ),
                },
                math.easeOutExpo,
            ),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(0.075, "animPlaySound", { sound: "swing" }),
        ],
    },
    pan: {
        keyframes: [
            frame(0, { [Bones.HandR]: new Pose(v2.create(14, 12.25)) }),
            frame(0.15, {
                [Bones.HandR]: new Pose(v2.create(22, -8.25)).rotate(-Math.PI * 0.2),
            }),
            frame(0.25, {
                [Bones.HandR]: new Pose(v2.create(28, -8.25)).rotate(Math.PI * 0.5),
            }),
            frame(0.55, { [Bones.HandR]: new Pose(v2.create(14, 12.25)) }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(def.pan.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    axeSwing: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(10.5, -14.25)),
                [Bones.HandR]: new Pose(v2.create(18, 6.25)),
            }),
            frame(def.woodaxe.attack.damageTimes[0] * 0.4, {
                [Bones.HandL]: new Pose(v2.create(9, -14.25)).rotate(Math.PI * 0.4),
                [Bones.HandR]: new Pose(v2.create(18, 6.25)).rotate(Math.PI * 0.4),
            }),
            frame(def.woodaxe.attack.damageTimes[0], {
                [Bones.HandL]: new Pose(v2.create(9, -14.25)).rotate(-Math.PI * 0.4),
                [Bones.HandR]: new Pose(v2.create(18, 6.25)).rotate(-Math.PI * 0.4),
            }),
            frame(def.woodaxe.attack.cooldownTime, {
                [Bones.HandL]: new Pose(v2.create(10.5, -14.25)),
                [Bones.HandR]: new Pose(v2.create(18, 6.25)),
            }),
        ],
        effects: [
            effect(def.woodaxe.attack.damageTimes[0], "animPlaySound", {
                sound: "swing",
            }),
            effect(def.woodaxe.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    hammerSwing: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(10.5, -14.25)),
                [Bones.HandR]: new Pose(v2.create(18, 6.25)),
            }),
            frame(def.stonehammer.attack.damageTimes[0] * 0.4, {
                [Bones.HandL]: new Pose(v2.create(9, -14.25)).rotate(Math.PI * 0.4),
                [Bones.HandR]: new Pose(v2.create(18, 6.25)).rotate(Math.PI * 0.4),
            }),
            frame(def.stonehammer.attack.damageTimes[0], {
                [Bones.HandL]: new Pose(v2.create(9, -14.25)).rotate(-Math.PI * 0.4),
                [Bones.HandR]: new Pose(v2.create(18, 6.25)).rotate(-Math.PI * 0.4),
            }),
            frame(def.stonehammer.attack.cooldownTime, {
                [Bones.HandL]: new Pose(v2.create(10.5, -14.25)),
                [Bones.HandR]: new Pose(v2.create(18, 6.25)),
            }),
        ],
        effects: [
            effect(def.stonehammer.attack.damageTimes[0], "animPlaySound", {
                sound: "swing",
            }),
            effect(def.stonehammer.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    katanaSwing: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)),
                [Bones.HandR]: new Pose(v2.create(-3, 17.75)),
            }),
            frame(def.katana.attack.damageTimes[0] * 0.3, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)).rotate(Math.PI * 0.2),
                [Bones.HandR]: new Pose(v2.create(-3, 17.75)).rotate(Math.PI * 0.2),
            }),
            frame(def.katana.attack.damageTimes[0] * 0.9, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)).rotate(-Math.PI * 1.2),
                [Bones.HandR]: new Pose(v2.create(-3, 17.75)).rotate(-Math.PI * 1.2),
            }),
            frame(def.katana.attack.cooldownTime, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)),
                [Bones.HandR]: new Pose(v2.create(-3, 17.75)),
            }),
        ],
        effects: [
            effect(def.katana.attack.damageTimes[0], "animPlaySound", {
                sound: "swing",
            }),
            effect(def.katana.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    katanaOrchidSwing: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)),
                [Bones.HandR]: new Pose(v2.create(-3, 17.75)),
            }),
            frame(def.katana.attack.damageTimes[0] * 0.3, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)).rotate(Math.PI * 0.2),
                [Bones.HandR]: new Pose(v2.create(-3, 17.75)).rotate(Math.PI * 0.2),
            }),
            frame(def.katana.attack.damageTimes[0] * 0.9, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)).rotate(-Math.PI * 1.2),
                [Bones.HandR]: new Pose(v2.create(-3, 17.75)).rotate(-Math.PI * 1.2),
            }),
            frame(def.katana.attack.cooldownTime, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)),
                [Bones.HandR]: new Pose(v2.create(-3, 17.75)),
            }),
        ],
        effects: [
            effect(def.katana.attack.damageTimes[0], "animPlaySound", {
                sound: "swing",
            }),
            effect(def.katana.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
        streaks: [
            {
                startTime: 0,
                endTime: def.katana.attack.damageTimes[0],
                emitter: "streak_orchid",
            },
        ],
    },
    katanaInspect: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(8.5, -20.25)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -2 * Math.PI,
                    v2.create(-3, -20.75),
                ),
            }),
            frame(0.1, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(15, 0)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -1.5 * Math.PI,
                    v2.create(19, 16.75),
                ),
            }),
            frame(0.25, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(18, -35)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -1.45 * Math.PI,
                    v2.create(19, 16.75),
                ),
            }),
            frame(0.6, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(30, -40)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -1.4 * Math.PI,
                    v2.create(19, 16.75),
                ),
            }),
            frame(0.7, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(8.5, 13.25)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -0.1 * Math.PI,
                    v2.create(-3, 17.75),
                ),
            }),
            frame(def.katana.anim.deploy!.duration, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(8.5, 13.25)),
                [Bones.HandR]: new Pose(v2.create(0, 0), 0, v2.create(-3, 17.75)),
            }),
        ],
        effects: [effect(0, "animPlaySound", { sound: "unsheathe" })],
    },
    katanaFlourish: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(-12, -25.25)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -2.25 * Math.PI,
                    v2.create(-17, -14.75),
                ),
            }),
            frame(0.1, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(14, -12.25)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -1 * Math.PI,
                    v2.create(12, -13.75),
                ),
            }),
            frame(0.2, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(14, -12.25)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    -0.2 * Math.PI,
                    v2.create(5, 4.75),
                ),
            }),
            frame(0.3, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(10, -12.25)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    0.5 * Math.PI,
                    v2.create(20, 4.75),
                ),
            }),
            frame(0.45, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(10, -12.25)),
                [Bones.HandR]: new Pose(v2.create(0, 0), 2 * Math.PI, v2.create(5, -14)),
            }),
            frame(0.55, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(10, -12.25)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    2.25 * Math.PI,
                    v2.create(15, -14),
                ),
            }),
            frame(0.7, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(8.5, 13.25)),
                [Bones.HandR]: new Pose(
                    v2.create(0, 0),
                    0.1 * Math.PI,
                    v2.create(-1, 15.75),
                ),
            }),
            frame(def.katana.anim.deploy!.duration, {
                [Bones.HandL]: new Pose(v2.create(0, 0), 0, v2.create(8.5, 13.25)),
                [Bones.HandR]: new Pose(v2.create(0, 0), 0, v2.create(-3, 17.75)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "slash" }),
            effect(0.2, "animPlaySound", { sound: "slash" }),
            effect(0.5, "animPlaySound", { sound: "slash" }),
        ],
    },
    naginataSwing: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(19, -7.25)),
                [Bones.HandR]: new Pose(v2.create(8.5, 24.25)),
            }),
            frame(def.naginata.attack.damageTimes[0] * 0.3, {
                [Bones.HandL]: new Pose(v2.create(19, -7.25)).rotate(Math.PI * 0.3),
                [Bones.HandR]: new Pose(v2.create(8.5, 24.25)).rotate(Math.PI * 0.3),
            }),
            frame(def.naginata.attack.damageTimes[0] * 0.9, {
                [Bones.HandL]: new Pose(v2.create(19, -7.25)).rotate(-Math.PI * 0.85),
                [Bones.HandR]: new Pose(v2.create(8.5, 24.25)).rotate(-Math.PI * 0.85),
            }),
            frame(def.naginata.attack.cooldownTime, {
                [Bones.HandL]: new Pose(v2.create(19, -7.25)),
                [Bones.HandR]: new Pose(v2.create(8.5, 24.25)),
            }),
        ],
        effects: [
            effect(def.naginata.attack.damageTimes[0], "animPlaySound", {
                sound: "swing",
            }),
            effect(def.naginata.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    sawSwing: {
        keyframes: [
            frame(0, { [Bones.HandR]: new Pose(v2.create(1, 17.75)) }),
            frame(def.saw.attack.damageTimes[0] * 0.4, {
                [Bones.HandR]: new Pose(v2.create(25, 6.25)).rotate(Math.PI * 0.3),
            }),
            frame(def.saw.attack.damageTimes[0], {
                [Bones.HandR]: new Pose(v2.create(25, 6.25)).rotate(-Math.PI * 0.3),
            }),
            frame(def.saw.attack.damageTimes[1] - 0.1, {
                [Bones.HandR]: new Pose(v2.create(25, 17.75)).rotate(-Math.PI * 0.25),
            }),
            frame(def.saw.attack.damageTimes[1] * 0.6, {
                [Bones.HandR]: new Pose(v2.create(-36, 7.75)).rotate(-Math.PI * 0.25),
            }),
            frame(def.saw.attack.damageTimes[1] + 0.2, {
                [Bones.HandR]: new Pose(v2.create(1, 17.75)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(0.4, "animPlaySound", { sound: "swing" }),
            effect(def.saw.attack.damageTimes[0], "animMeleeCollision", {}),
            effect(def.saw.attack.damageTimes[1], "animMeleeCollision", {
                playerHit: "playerHit2",
            }),
        ],
    },
    cutReverseShort: {
        keyframes: [
            frame(0, { [Bones.HandR]: new Pose(v2.create(1, 17.75)) }),
            frame(def.saw.attack.damageTimes[0] * 0.4, {
                [Bones.HandR]: new Pose(v2.create(25, 6.25)).rotate(Math.PI * 0.3),
            }),
            frame(def.saw.attack.damageTimes[0], {
                [Bones.HandR]: new Pose(v2.create(25, 6.25)).rotate(-Math.PI * 0.3),
            }),
            frame(def.fists.attack.cooldownTime, {
                [Bones.HandR]: new Pose(v2.create(14, 17.75)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "swing" }),
            effect(def.fists.attack.damageTimes[0], "animMeleeCollision", {}),
        ],
    },
    cook: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(15.75, -9.625)),
                [Bones.HandR]: new Pose(v2.create(15.75, 9.625)),
            }),
            frame(0.1, {
                [Bones.HandL]: new Pose(v2.create(14, -1.75)),
                [Bones.HandR]: new Pose(v2.create(14, 1.75)),
            }),
            frame(0.3, {
                [Bones.HandL]: new Pose(v2.create(14, -1.75)),
                [Bones.HandR]: new Pose(v2.create(14, 1.75)),
            }),
            frame(0.4, {
                [Bones.HandL]: new Pose(v2.create(22.75, -1.75)),
                [Bones.HandR]: new Pose(v2.create(1.75, 14)),
            }),
            frame(99999, {
                [Bones.HandL]: new Pose(v2.create(22.75, -1.75)),
                [Bones.HandR]: new Pose(v2.create(1.75, 14)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "pullPin" }),
            effect(0.1, "animSetThrowableState", { state: "cook" }),
        ],
    },
    throw: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(22.75, -1.75)),
                [Bones.HandR]: new Pose(v2.create(1.75, 14.175)),
            }),
            frame(0.15, {
                [Bones.HandL]: new Pose(v2.create(5.25, -15.75)),
                [Bones.HandR]: new Pose(v2.create(29.75, 1.75)),
            }),
            frame(0.15 + GameConfig.player.throwTime, {
                [Bones.HandL]: new Pose(v2.create(15.75, -9.625)),
                [Bones.HandR]: new Pose(v2.create(15.75, 9.625)),
            }),
        ],
        effects: [
            effect(0, "animPlaySound", { sound: "throwing" }),
            effect(0, "animSetThrowableState", { state: "throwing" }),
            effect(0, "animThrowableParticles", {}),
        ],
    },
    crawl_forward: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(14, -12.25)),
                [Bones.FootL]: new Pose(v2.create(-15.75, -9)),
            }),
            frame(GameConfig.player.crawlTime * 0.33, {
                [Bones.HandL]: new Pose(v2.create(19.25, -10.5)),
                [Bones.FootL]: new Pose(v2.create(-20.25, -9)),
            }),
            frame(GameConfig.player.crawlTime * 0.66, {
                [Bones.HandL]: new Pose(v2.create(5.25, -15.75)),
                [Bones.FootL]: new Pose(v2.create(-11.25, -9)),
            }),
            frame(GameConfig.player.crawlTime * 1, {
                [Bones.HandL]: new Pose(v2.create(14, -12.25)),
                [Bones.FootL]: new Pose(v2.create(-15.75, -9)),
            }),
        ],
        effects: [],
    },
    crawl_backward: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(14, -12.25)),
                [Bones.FootL]: new Pose(v2.create(-15.75, -9)),
            }),
            frame(GameConfig.player.crawlTime * 0.33, {
                [Bones.HandL]: new Pose(v2.create(5.25, -15.75)),
                [Bones.FootL]: new Pose(v2.create(-11.25, -9)),
            }),
            frame(GameConfig.player.crawlTime * 0.66, {
                [Bones.HandL]: new Pose(v2.create(19.25, -10.5)),
                [Bones.FootL]: new Pose(v2.create(-20.25, -9)),
            }),
            frame(GameConfig.player.crawlTime * 1, {
                [Bones.HandL]: new Pose(v2.create(14, -12.25)),
                [Bones.FootL]: new Pose(v2.create(-15.75, -9)),
            }),
        ],
        effects: [],
    },
    revive: {
        keyframes: [
            frame(0, {
                [Bones.HandL]: new Pose(v2.create(14, -12.25)),
                [Bones.HandR]: new Pose(v2.create(14, 12.25)),
            }),
            frame(0.2, {
                [Bones.HandL]: new Pose(v2.create(24.5, -8.75)),
                [Bones.HandR]: new Pose(v2.create(5.25, 21)),
            }),
            frame(0.2 + GameConfig.player.reviveDuration, {
                [Bones.HandL]: new Pose(v2.create(24.5, -8.75)),
                [Bones.HandR]: new Pose(v2.create(5.25, 21)),
            }),
        ],
        effects: [],
    },
    lasrSwrdSwing: {
        keyframes: [
            frame(0.0, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)),
                [Bones.HandR]: new Pose(v2.create(16.0, 17.75)),
            }),
            frame(0.15, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)).rotate(Math.PI * 0.25),
                [Bones.HandR]: new Pose(v2.create(16.0, 17.75)).rotate(Math.PI * 0.25),
            }),
            frame(0.35, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)).rotate(Math.PI * 0.3),
                [Bones.HandR]: new Pose(v2.create(16.0, 17.75)).rotate(Math.PI * 0.3),
            }),
            frame(0.45, {
                [Bones.HandL]: new Pose(v2.create(8.5, 13.25)).rotate(-Math.PI * 0.6),
                [Bones.HandR]: new Pose(v2.create(16.0, 17.75)).rotate(-Math.PI * 0.6),
            }),
            frame(0.55, {
                [Bones.HandL]: new Pose(v2.create(10.5, 0.0)),
                [Bones.HandR]: new Pose(v2.create(18.0, 0.5)),
            }),
        ],
        effects: [
            effect(0.2, "animPlaySound", { sound: "swing" }),
            effect(0.4, "animMeleeCollision", {}),
        ],
    },
};

const DerivedAnimations: Record<string, AnimDef> = {
    karambitMagmaSpin: deriveAnim("spin", {
        effects: [
            effect(0, "animPlaySound", { sound: "fireSwing" }),
            effect(0.2, "animPlaySound", { sound: "fireSwing" }),
        ],
        streaks: [
            {
                startTime: 0,
                endTime: def.karambit.anim.deploy!.duration,
                emitter: "streak_fire",
            },
        ],
    }),
    karambitMagmaRapidSpin: deriveAnim("rapidSpin", {
        effects: [
            effect(0, "animPlaySound", { sound: "fireSwing" }),
            effect(0.15, "animPlaySound", { sound: "fireSwing" }),
        ],
        streaks: [
            {
                startTime: 0,
                endTime: 0.4,
                emitter: "streak_fire",
            },
        ],
    }),
    karambitMagmaSwipeSpin: deriveAnim("swipeSpin", {
        effects: [
            effect(0.075, "animPlaySound", { sound: "swing" }),
            effect(0.2, "animPlaySound", { sound: "fireSwing" }),
        ],
        streaks: [
            {
                startTime: 0.2,
                endTime: def.karambit.anim.deploy!.duration,
                emitter: "streak_fire",
            },
        ],
    }),
    katanaOrchidInspect: deriveAnim("katanaInspect", {
        streaks: [
            {
                startTime: 0.2,
                endTime: 0.7,
                emitter: "inspect_orchid",
            },
        ],
    }),
    katanaOrchidFlourish: deriveAnim("katanaFlourish", {
        streaks: [
            {
                startTime: 0.1,
                endTime: 0.3,
                emitter: "inspect_orchid",
            },
            {
                startTime: 0.5,
                endTime: def.katana.anim.deploy!.duration,
                emitter: "inspect_orchid",
            },
        ],
    }),
};

export const Animations = { ...BaseAnimations, ...DerivedAnimations };
