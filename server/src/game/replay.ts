import { GameConfig } from "../../../shared/gameConfig";
import * as net from "../../../shared/net/net";
import { ObjectType } from "../../../shared/net/objectSerializeFns";
import { coldet } from "../../../shared/utils/coldet";
import { Config } from "../config";
import type { Game } from "./game";

const TICKS_PER_CHECKPOINT = Config.netSyncTps * 5;

type Checkpoint = {
    byteIndex: number;
    totalElapsed: number;
    mapStreamIndex: number;
};

type MapEntry = {
    totalElapsed: number;
    stream: net.BitStream;
};

type PendingEvent =
    | { kind: "killed"; targetId: number; killerId: number }
    | { kind: "downed"; targetId: number; downerId: number }
    | { kind: "mapChanged" };

type Event =
    | { kind: "killed"; targetId: number; killerId: number; totalElapsed: number }
    | { kind: "downed"; targetId: number; downerId: number; totalElapsed: number }
    | { kind: "mapChanged"; totalElapsed: number };

export class Recorder {
    static VERSION = 1;

    private uint8buff: Uint8Array; // msg view
    private view: DataView; // int view

    private index = 0;

    private tickCount = 0;
    private recording = false;

    private lastTickTime = 0;

    private elapsedUs = 0;

    private oldMapSeed = -1;

    private checkpoints: Checkpoint[] = [];

    private mapEntries: MapEntry[] = [];

    private pendingEvents: PendingEvent[] = [];
    private events: Event[] = [];

    constructor(readonly game: Game) {
        const buffer = new ArrayBuffer(40_000_000);
        this.uint8buff = new Uint8Array(buffer);
        this.view = new DataView(buffer);
    }

    start() {
        this.index = 0;
        this.tickCount = 0;
        this.recording = true;

        // reserve 4 bytes for the header index
        this.index += 4;

        this.lastTickTime = performance.now();

        (this.game.pluginManager.eventToHandlers.playerDidDie ??= []).push(
            (gameEvent) => {
                const { player, params } = gameEvent.data;

                const targetId = player.__id;
                const killerId =
                    params.source && params.source.__type == ObjectType.Player
                        ? params.source.__id
                        : 0;

                this.pendingEvents.push({
                    kind: "killed",
                    targetId,
                    killerId,
                });
            },
        );
        (this.game.pluginManager.eventToHandlers.playerGotDowned ??= []).push(
            (gameEvent) => {
                const { player, params } = gameEvent.data;

                const targetId = player.__id;
                const downerId =
                    params.source && params.source.__type == ObjectType.Player
                        ? params.source.__id
                        : 0;

                this.pendingEvents.push({
                    kind: "downed",
                    targetId,
                    downerId,
                });
            },
        );
        (this.game.pluginManager.eventToHandlers.mapCreated ??= []).push(() => {
            this.pendingEvents.push({ kind: "mapChanged" });
        });
    }

    /**
     * each replay msg reuses this stream to avoid unnecessary reallocation
     */

    // private tickStream = new net.BitStream(new ArrayBuffer(65536))
    private tickStream = new net.BitStream(new ArrayBuffer(262144)); // 1 << 18

    private msgsToSend = new net.MsgStream(new ArrayBuffer(65536));

    recordTick() {
        if (!this.recording) {
            return;
        }

        this.tickStream.index = 0;
        this.msgsToSend.stream.index = 0;

        const now = performance.now();
        const tickElapsed =
            this.tickCount == 0 ? 0 : Math.trunc((now - this.lastTickTime) * 1000);
        this.lastTickTime = now;

        const tickStart = this.elapsedUs;
        this.elapsedUs += tickElapsed;
        const tickEnd = this.elapsedUs;

        if (this.oldMapSeed != this.game.map.seed) {
            this.oldMapSeed = this.game.map.seed;

            const stream = this.game.map.mapStream.stream;
            const byteIndex = stream.byteIndex;
            // must exclude the type byte at the start of the stream
            const bufferView = stream.buffer.subarray(1, byteIndex);
            const copy = new net.BitStream(Buffer.from(bufferView));
            copy.byteIndex = byteIndex - 1;

            this.mapEntries.push({
                // tickEnd guarantees that the map is fully processed by the time we arrive at it
                totalElapsed: tickEnd,
                stream: copy,
            });
        }

        for (let i = 0; i < this.pendingEvents.length; i++) {
            const pending = this.pendingEvents[i];
            // tickEnd guarantees that the event is fully processed by the time we arrive at it
            switch (pending.kind) {
                case "killed":
                    this.events.push({
                        kind: "killed",
                        targetId: pending.targetId,
                        killerId: pending.killerId,
                        totalElapsed: tickEnd,
                    });
                    break;
                case "downed":
                    this.events.push({
                        kind: "downed",
                        targetId: pending.targetId,
                        downerId: pending.downerId,
                        totalElapsed: tickEnd,
                    });
                    break;
                case "mapChanged":
                    this.events.push({ kind: "mapChanged", totalElapsed: tickEnd });
                    break;
            }
        }
        this.pendingEvents.length = 0;

        let isCheckpoint = false;

        if (this.tickCount % TICKS_PER_CHECKPOINT == 0) {
            isCheckpoint = true;

            this.checkpoints.push({
                // byteIndex is relative to the start of the tick data (after the 4 byte header index)
                byteIndex: this.index - 4,
                // if current time is 5s and this tick just took 20s,
                // sending 5 on the checkpoint is correct since that's the start of the tick not 25
                // hence why we use tickStart not tickEnd, we must line up with byteIndex
                totalElapsed: tickStart,
                // the last element is always the most recently pushed and therefore the "active" map
                mapStreamIndex: this.mapEntries.length - 1,
            });
        }

        const replayMsg = new net.ReplayMsg();

        if (this.game.playerBarn.aliveCountDirty || isCheckpoint) {
            replayMsg.aliveCountDirty = true;
            // not sure why leia had this mutate instead of returning a new array
            this.game.modeManager.updateAliveCounts(replayMsg.teamAliveCounts);
        }

        replayMsg.killFeedLines = this.game.playerBarn.killFeedLines;

        // deletedObjs gets flushed every tick but recordTick() gets called before so it's fine
        // much faster than querying the grid
        replayMsg.delObjIds = this.game.objectRegister.deletedObjs.map((obj) => obj.__id);

        for (let i = 0; i < this.game.objectRegister.objects.length; i++) {
            const obj = this.game.objectRegister.objects[i];
            // destroyed objects are sent in delObjIds
            if (!obj || obj.destroyed) continue;
            if (this.game.objectRegister.dirtyFull[obj.__id] || isCheckpoint) {
                replayMsg.fullObjects.push(obj);
            } else if (this.game.objectRegister.dirtyPart[obj.__id]) {
                replayMsg.partObjects.push(obj);
            }
        }

        if (this.game.gas.dirty || isCheckpoint) {
            replayMsg.gasDirty = true;
            replayMsg.gasData = this.game.gas;
        }

        if (this.game.gas.timeDirty || isCheckpoint) {
            replayMsg.gasTDirty = true;
            replayMsg.gasT = this.game.gas.gasT;
        }

        for (let i = 0; i < this.game.playerBarn.players.length; i++) {
            const p = this.game.playerBarn.players[i];
            replayMsg.players.push({
                data: {
                    health: p.health,
                    zoom: p.zoom,
                    boost: p.boost,
                    scope: p.scope,
                    curWeapIdx: p.curWeapIdx,
                    inventory: p.inventory,
                    weapons: p.weapons,
                    action: p.action,
                    spectatorCount: p.spectatorCount,
                    healthDirty: p.healthDirty || isCheckpoint,
                    zoomDirty: p.zoomDirty || isCheckpoint,
                    boostDirty: p.boostDirty || isCheckpoint,
                    inventoryDirty: p.inventoryDirty || isCheckpoint,
                    weapsDirty: p.weapsDirty || isCheckpoint,
                    actionDirty: p.actionDirty || isCheckpoint,
                    spectatorCountDirty: p.spectatorCountDirty || isCheckpoint,
                },
                playerId: p.__id,
                disconnected: p.disconnected,
                extraDirty: p._firstUpdate || isCheckpoint,
                extra: {
                    teamId: p.teamId,
                    groupId: p.groupId,
                    name: p.name,
                    loadout: p.loadout,
                },
            });
        }

        replayMsg.deletedPlayerIds = this.game.playerBarn.deletedPlayers;

        replayMsg.emotes = this.game.playerBarn.emotes;
        replayMsg.bullets = this.game.bulletBarn.newBullets;
        replayMsg.explosions = this.game.explosionBarn.newExplosions;
        for (let i = 0; i < this.game.planeBarn.planes.length; i++) {
            const plane = this.game.planeBarn.planes[i];
            if (
                coldet.testPointAabb(
                    plane.pos,
                    this.game.planeBarn.planeBounds.min,
                    this.game.planeBarn.planeBounds.max,
                )
            ) {
                replayMsg.planes.push(plane);
            }
        }
        replayMsg.airstrikeZones = this.game.planeBarn.newAirstrikeZones;
        replayMsg.mapIndicators = this.game.mapIndicatorBarn.mapIndicators;

        if (this.game.playerBarn.killLeaderDirty || isCheckpoint) {
            replayMsg.killLeaderDirty = true;
            replayMsg.killLeaderId = this.game.playerBarn.killLeader?.__id ?? 0;
            replayMsg.killLeaderKills = this.game.playerBarn.killLeader?.kills ?? 0;
        }

        replayMsg.msgsToSend = this.game.msgsToSend;

        this.tickStream.writeUint32(tickElapsed);

        replayMsg.serialize(this.tickStream);

        const byteIndex = this.tickStream.byteIndex;

        this.uint8buff.set(this.tickStream.buffer.subarray(0, byteIndex), this.index);
        this.index += byteIndex;

        this.tickCount += 1;
    }

    stop() {
        const headerIndex = this.index;
        this.index = 0;
        this.writeUint32(headerIndex);
        this.index = headerIndex;

        this.writeUint32(Recorder.VERSION);
        this.writeUint32(GameConfig.protocolVersion);
        this.writeUint32(this.elapsedUs);
        this.writeUint8(this.game.teamMode);

        this.writeUint16(this.checkpoints.length);
        for (let i = 0; i < this.checkpoints.length; i++) {
            const checkpoint = this.checkpoints[i];
            this.writeUint32(checkpoint.byteIndex);
            this.writeUint32(checkpoint.totalElapsed);
            this.writeUint8(checkpoint.mapStreamIndex);
        }

        this.writeUint8(this.mapEntries.length);
        for (let i = 0; i < this.mapEntries.length; i++) {
            const entry = this.mapEntries[i];

            this.writeUint32(entry.totalElapsed);

            const byteIndex = entry.stream.byteIndex;
            this.writeUint32(byteIndex);
            this.uint8buff.set(entry.stream.buffer.subarray(0, byteIndex), this.index);
            this.index += byteIndex;
        }

        this.writeUint16(this.events.length);
        for (let i = 0; i < this.events.length; i++) {
            const event = this.events[i];

            switch (event.kind) {
                case "killed":
                    this.writeUint8(0);
                    this.writeUint16(event.targetId);
                    this.writeUint16(event.killerId);
                    break;
                case "downed":
                    this.writeUint8(1);
                    this.writeUint16(event.targetId);
                    this.writeUint16(event.downerId);
                    break;
                case "mapChanged":
                    this.writeUint8(2);
                    break;
            }

            this.writeUint32(event.totalElapsed);
        }

        this.recording = false;
    }

    writeUint8(value: number) {
        this.view.setUint8(this.index, value);
        this.index += 1;
    }

    writeUint16(value: number) {
        this.view.setUint16(this.index, value);
        this.index += 2;
    }

    writeUint32(value: number) {
        this.view.setUint32(this.index, value);
        this.index += 4;
    }

    getBuffer(): Uint8Array {
        return this.uint8buff.slice(0, this.index);
    }
}
