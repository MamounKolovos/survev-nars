import { GameConfig } from "../../../shared/gameConfig";
import * as net from "../../../shared/net/net";
import { Config } from "../config";
import type { Game } from "./game";

const TICKS_PER_CHECKPOINT = Config.netSyncTps * 10;

export class Recorder {
    static VERSION = 1;

    private uint8buff: Uint8Array; // msg view
    private view: DataView; // int view

    private index = 0;

    private tickCount = 0;
    private tickCountIndex = 0;
    private recording = false;

    private lastTickTime = 0;

    private elapsedMs = 0;
    private elapsedMsIndex = 0;

    private oldMapSeed = -1;

    constructor(readonly game: Game) {
        const buffer = new ArrayBuffer(20_000_000); // 20 mb
        this.uint8buff = new Uint8Array(buffer);
        this.view = new DataView(buffer);
    }

    start() {
        this.index = 0;
        this.tickCount = 0;
        this.recording = true;

        this.view.setUint32(this.index, Recorder.VERSION);
        this.index += 4;

        this.view.setUint32(this.index, GameConfig.protocolVersion);
        this.index += 4;

        this.tickCountIndex = this.index;
        this.index += 4;

        this.elapsedMsIndex = this.index;
        this.index += 4;

        this.view.setUint16(this.index, TICKS_PER_CHECKPOINT);
        this.index += 2;

        this.view.setUint8(this.index, this.game.teamMode);
        this.index += 1;

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

        let isCheckpoint = false;

        if (this.tickCount % TICKS_PER_CHECKPOINT == 0) {
            isCheckpoint = true;
        }

        const replayMsg = new net.ReplayMsg();

        if (this.oldMapSeed != this.game.map.seed) {
            this.oldMapSeed = this.game.map.seed;
            replayMsg.mapDirty = true;
            replayMsg.mapStream = this.game.map.mapStream.stream;

            // // const stream = this.game.map.mapStream;
            // // replayMsg.mapBuffer = new Uint8Array(stream.arrayBuf, 1, stream.stream.byteIndex)

            // const length = mapStream.byteIndex - 1;
            // // excludes the type since we already know it's a map msg
            // // replayMsg.mapStream = new net.BitStream(mapStream.buffer, 1, length);
            // replayMsg.mapStream = new net.BitStream(mapStream.buffer, mapStream.byteIndex, length);
            // // replayMsg.mapStream.byteIndex = length;

            // // mapStream.byteIndex = 1;
            // // mapStream.readBitStream(mapStream.bitsLeft)

            // replayMsg.mapStream.byteIndex = 0;
        }

        if (this.game.playerBarn.aliveCountDirty || isCheckpoint) {
            replayMsg.aliveCountDirty = true;
            // not sure why leia had this mutate instead of returning a new array
            this.game.modeManager.updateAliveCounts(replayMsg.teamAliveCounts);
        }

        for (let i = 0; i < this.game.playerBarn.killFeedLines.length; i++) {
            const killFeedLine = this.game.playerBarn.killFeedLines[i];
            replayMsg.killFeedLines.push(killFeedLine.segments);
        }

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
                status: {
                    hasData: true,
                    pos: p.pos,
                    visible: true,
                    dead: p.dead,
                    downed: p.downed,
                    role: p.role,
                    disconnected: p.disconnected,
                },
                data: {
                    health: p.health,
                    zoom: p.zoom,
                    boost: p.boost,
                    scope: p.scope,
                    curWeapIdx: p.curWeapIdx,
                    inventory: p.inventory,
                    weapons: p.weapons,
                    spectatorCount: p.spectatorCount,
                    healthDirty: true,
                    boostDirty: true,
                    zoomDirty: true,
                    actionDirty: true,
                    action: p.action,
                    inventoryDirty: true,
                    weapsDirty: true,
                    spectatorCountDirty: true,
                },
                info: {
                    playerId: p.__id,
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
        replayMsg.planes = this.game.planeBarn.planes;
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
        this.view.setUint32(this.tickCountIndex, this.tickCount);
        this.view.setFloat32(this.elapsedMsIndex, this.elapsedMs);
        this.recording = false;
    }

    getBuffer(): Uint8Array {
        return this.uint8buff.slice(0, this.index);
    }
}
