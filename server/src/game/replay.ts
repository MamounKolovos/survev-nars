import { GameConfig } from "../../../shared/gameConfig";
import * as net from "../../../shared/net/net";
import { coldet } from "../../../shared/utils/coldet";
import { Config } from "../config";
import type { Game } from "./game";

const TICKS_PER_CHECKPOINT = Config.netSyncTps * 5;

type Checkpoint = {
    tick: number;
    byteIndex: number;
    totalElapsed: number;
    mapStreamIndex: number;
};

type MapEntry = {
    tick: number;
    stream: net.BitStream;
};

export class Recorder {
    static VERSION = 1;

    private uint8buff: Uint8Array; // msg view
    private view: DataView; // int view

    private index = 0;

    private tickCount = 0;
    private recording = false;

    private lastTickTime = 0;

    private elapsedMs = 0;

    private oldMapSeed = -1;

    private checkpoints: Checkpoint[] = [];

    private mapEntries: MapEntry[] = [];

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
        const tickElapsed = now - this.lastTickTime;
        this.lastTickTime = now;

        this.elapsedMs += tickElapsed;

        if (this.oldMapSeed != this.game.map.seed) {
            this.oldMapSeed = this.game.map.seed;

            this.mapEntries.push({
                tick: this.tickCount,
                stream: this.game.map.mapStream.stream,
            });
        }

        const replayMsg = new net.ReplayMsg();

        let isCheckpoint = false;

        if (this.tickCount % TICKS_PER_CHECKPOINT == 0) {
            isCheckpoint = true;

            this.checkpoints.push({
                tick: this.tickCount,
                // byteIndex is relative to the start of the tick data (after the 4 byte header index)
                byteIndex: this.index - 4,
                totalElapsed: this.elapsedMs,
                // the last element is always the most recently pushed and therefore the "active" map
                mapStreamIndex: this.mapEntries.length - 1,
            });
        }

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
                extraDirty: isCheckpoint,
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

        this.tickStream.writeFloat32(tickElapsed);

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
        this.writeUint32(this.tickCount);
        this.writeFloat32(this.elapsedMs);
        this.writeUint16(TICKS_PER_CHECKPOINT);
        this.writeUint8(this.game.teamMode);

        this.writeUint16(this.checkpoints.length);
        for (let i = 0; i < this.checkpoints.length; i++) {
            const checkpoint = this.checkpoints[i];
            this.writeUint32(checkpoint.tick);
            this.writeUint32(checkpoint.byteIndex);
            this.writeFloat32(checkpoint.totalElapsed);
            this.writeUint8(checkpoint.mapStreamIndex);
        }

        this.writeUint8(this.mapEntries.length);
        for (let i = 0; i < this.mapEntries.length; i++) {
            const entry = this.mapEntries[i];

            this.writeUint32(entry.tick);

            // must exclude the type byte at the start of the stream
            const byteIndex = entry.stream.byteIndex;
            this.writeUint32(byteIndex - 1);
            this.uint8buff.set(entry.stream.buffer.subarray(1, byteIndex), this.index);
            this.index += byteIndex - 1;
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

    writeFloat32(value: number) {
        this.view.setFloat32(this.index, value);
        this.index += 4;
    }

    getBuffer(): Uint8Array {
        return this.uint8buff.slice(0, this.index);
    }
}
