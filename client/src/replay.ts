import { GameObjectDefs } from "../../shared/defs/gameObjectDefs";
import { GameConfig, type TeamMode } from "../../shared/gameConfig";
import * as net from "../../shared/net/net";
import type { Emote } from "../../shared/net/updateMsg";
import { math } from "../../shared/utils/math";
import { util } from "../../shared/utils/util";
import { v2 } from "../../shared/utils/v2";
import { api } from "./api";
import type { DebugOptions } from "./config";
import type { Ctx, Game } from "./game";
import { helpers } from "./helpers";
import { Key } from "./input";
import { createBullet } from "./objects/bullet";
import type { Player } from "./objects/player";

type Checkpoint = {
    byteIndex: number;
    seed: number;
};

/** server side allocator max - 1 */
const FREECAM_ID = 65534;
const FREECAM_GROUP_ID = 255;
const FREECAM_TEAM_ID = 255;

export class Replay {
    private view: DataView;
    private uint8buff: Uint8Array;

    freecamPlayer!: Player;

    done = false;
    paused = false;
    scrubbing = false;
    /**
     * used to respect pause state while scrubbing,
     * if replay was paused before scrubbing, it should stay paused after
     */
    pausedBeforeScrub = false;

    currentTick = 0;
    totalTicks: number;

    seekTarget?: number;
    seekOffset?: number;

    playbackIconState: "play" | "pause" | "restart" = "pause";

    ticksPerCheckpoint: number;

    seedToMapStream: Record<number, net.BitStream> = {};
    checkpoints: Checkpoint[] = [];
    tickToElapsed!: Float32Array;

    tickElapsed = 0;

    totalElapsedMs: number;

    headerLength: number;

    teamMode: TeamMode;

    constructor(
        buffer: Uint8Array<ArrayBuffer>,
        readonly game: Game,
        readonly gameId: string,
        readonly startSecond: number,
    ) {
        this.uint8buff = buffer;
        this.view = new DataView(buffer.buffer);

        let index = 0;

        const version = this.view.getUint32(index);
        console.log(`Recording version: ${version}`);
        index += 4;

        const protocolVersion = this.view.getUint32(index);
        // if (protocolVersion != GameConfig.protocolVersion) {
        //     throw new Error(
        //         `Replay protocol mismatch: expected ${GameConfig.protocolVersion} got ${protocolVersion}`,
        //     );
        // }
        index += 4;

        this.currentTick = 0;
        this.totalTicks = this.view.getUint32(index);
        this.tickToElapsed = new Float32Array(this.totalTicks);
        index += 4;

        this.totalElapsedMs = this.view.getFloat32(index);
        index += 4;

        this.ticksPerCheckpoint = this.view.getUint16(index);
        index += 2;

        this.teamMode = this.view.getUint8(index);
        index += 1;

        this.headerLength = index;

        // TODO: should happen in consumer
        this.seekOffset = math.clamp(startSecond * 1000, 0, this.totalElapsedMs);
    }

    start() {
        this.game.onJoin();
        this.game.teamMode = this.teamMode;
        this.game.m_localId = FREECAM_ID;

        const player = this.game.m_playerBarn.playerPool.m_alloc();
        player.isFreecam = true;
        player.__id = FREECAM_ID;
        player.m_pos = v2.create(360, 360);

        this.game.m_inputBinds.disable();
        this.game.m_uiManager.displayReplayMenu(true);

        this.game.m_uiManager.setReplayTotalTimeLabel(this.totalElapsedMs);
        this.game.m_uiManager.setReplayScrubberMax(this.totalElapsedMs);
        this.game.m_uiManager.setReplayScrubberValue(0);

        const localData = {
            health: 100,
            zoom: GameConfig.scopeZoomRadius.desktop["4xscope"],
            boost: 100,
            scope: "4xscope",
            curWeapIdx: 2,
            inventory: {},
            weapons: [
                {
                    type: "",
                    ammo: 0,
                },
                {
                    type: "",
                    ammo: 0,
                },
                {
                    type: "fists",
                    ammo: 0,
                },
                {
                    type: "",
                    ammo: 0,
                },
            ],
            spectatorCount: 0,
            healthDirty: true,
            boostDirty: true,
            zoomDirty: true,
            actionDirty: true,
            action: {
                time: 0,
                duration: 0,
                targetId: -1,
            },
            inventoryDirty: true,
            weapsDirty: true,
            spectatorCountDirty: true,
        };

        player.m_setLocalData(localData, this.game.m_playerBarn);

        player.m_netData.m_pos = v2.create(360, 360);
        player.m_netData.m_backpack = "backpack00";

        this.game.m_playerBarn.setPlayerInfo({
            playerId: player.__id,
            teamId: FREECAM_TEAM_ID,
            groupId: FREECAM_GROUP_ID,
            name: "",
            loadout: {
                boost: "boost_basic",
                heal: "heal_basic",
            },
        });

        this.game.m_activePlayer = player;
        //TODO: should probably reserve a special number instead of using 0
        this.game.m_activeId = FREECAM_ID;
        // this.game.m_localId = 0;

        // IMPORTANT: freecam player is never rendered because Player.visualsDirty is never set
        // player.visualsDirty = true;
        this.freecamPlayer = player;

        player.m_netData.m_outfit = "outfitBase";

        const stream = new net.BitStream(
            this.uint8buff.buffer as ArrayBuffer,
            this.headerLength,
            this.uint8buff.buffer.byteLength - this.headerLength,
        );

        let previous = performance.now();
        let accumulator = 0;

        this.tickElapsed = 0;

        const loop = () => {
            let current = performance.now();
            const dt = current - previous;
            previous = current;

            if (this.seekOffset != undefined) {
                this.game.m_audioManager.kill();
                this.game.m_audioManager.suppressPlayback = true;

                if (this.seekOffset >= 0) {
                    let timeLeft = this.seekOffset;
                    while (timeLeft > 0 && !this.isEnded()) {
                        timeLeft -= this.tickElapsed;
                        this.processTick(stream);
                        this.game.update(this.tickElapsed / 1000);
                    }
                } else {
                    const seekTarget = this.getTickFromOffset(this.seekOffset);
                    const checkpointIndex = Math.floor(
                        seekTarget / this.ticksPerCheckpoint,
                    );
                    const checkpointTick = checkpointIndex * this.ticksPerCheckpoint;

                    this.game.m_objectCreator.m_clear();
                    this.game.m_ui2Manager.clearKillFeed();
                    this.game.m_particleBarn.m_clear();
                    this.game.m_bulletBarn.m_clear();
                    this.game.m_planeBarn.m_clear();

                    const checkpoint = this.checkpoints[checkpointIndex];
                    this.currentTick = checkpointTick;
                    stream.byteIndex = checkpoint.byteIndex;
                    if (this.game.m_map.seed != checkpoint.seed) {
                        const mapStream = this.seedToMapStream[checkpoint.seed];
                        // very necessary! stream will be exhausted everytime its read so we must reset it
                        mapStream.byteIndex = 0;
                        this.game.m_onMsg(net.MsgType.Map, mapStream);
                    }

                    while (this.currentTick < seekTarget && !this.isEnded()) {
                        this.processTick(stream);
                        this.game.update(this.tickElapsed / 1000);
                    }
                }

                // // current tick is the tick being processed, so we subtract 1 since we only display ticks already processed
                // this.game.m_uiManager.setReplayElapsedTimeLabel(
                //     this.tickToElapsed[this.currentTick - 1],
                // );
                // this.game.m_uiManager.setReplayScrubberValue(
                //     this.tickToElapsed[this.currentTick - 1],
                // );

                this.seekOffset = undefined;
                this.game.m_audioManager.suppressPlayback = false;

                previous = performance.now();
                accumulator = 0;

                requestAnimationFrame(loop);
                return;
            }

            if (!this.paused && !this.isEnded()) {
                accumulator += dt;

                while (accumulator >= this.tickElapsed && !this.isEnded()) {
                    accumulator -= this.tickElapsed;
                    this.processTick(stream);
                }
            }

            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }

    processTick(stream: net.BitStream) {
        const startIndex = stream.byteIndex;

        this.tickElapsed = stream.readFloat32();

        this.tickToElapsed[this.currentTick] =
            (this.tickToElapsed[this.currentTick - 1] ?? 0) + this.tickElapsed;
        this.nextTick(stream);
        if (this.currentTick % this.ticksPerCheckpoint == 0) {
            const checkpointIndex = this.currentTick / this.ticksPerCheckpoint;
            this.checkpoints[checkpointIndex] = {
                byteIndex: startIndex,
                seed: this.game.m_map.seed,
            };
        }
        this.game.m_uiManager.setReplayElapsedTimeLabel(
            this.tickToElapsed[this.currentTick],
        );
        this.game.m_uiManager.setReplayScrubberValue(
            this.tickToElapsed[this.currentTick],
        );
        this.currentTick += 1;
    }

    isEnded(): boolean {
        // the > is just a safeguard if currentTick goes out of bounds for whatever reason
        return this.currentTick >= this.totalTicks;
    }

    nextTick(stream: net.BitStream) {
        // console.log("index", stream.byteIndex)
        // const msgLength = stream.readUint16();
        // this.index += 2;

        const msg = new net.ReplayMsg();
        msg.deserialize(stream, this.game.m_objectCreator);
        // this.index += msgLength;

        if (msg.mapDirty) {
            this.game.m_onMsg(net.MsgType.Map, msg.mapStream);
            this.seedToMapStream[this.game.m_map.seed] = msg.mapStream;
        }

        if (msg.teamAliveCounts.length == 1) {
            this.game.m_uiManager.updatePlayersAlive(msg.teamAliveCounts[0]);
        } else if (msg.teamAliveCounts.length >= 2) {
            this.game.m_uiManager.updatePlayersAliveRed(msg.teamAliveCounts[0]);
            this.game.m_uiManager.updatePlayersAliveBlue(msg.teamAliveCounts[1]);
        }

        const activeId = this.game.m_activeId;
        const activeGroupId = this.game.m_playerBarn.getPlayerInfo(
            this.game.m_activeId,
        ).groupId;
        const activeTeamId = this.game.m_playerBarn.getPlayerInfo(
            this.game.m_activeId,
        ).teamId;

        for (let i = 0; i < msg.killFeedLines.length; i++) {
            const { target, segments } = msg.killFeedLines[i];

            if (
                target.kind == "all" ||
                (target.kind == "player" && target.id == activeId) ||
                (target.kind == "group" && target.id == activeGroupId) ||
                (target.kind == "team" && target.id == activeTeamId)
            ) {
                this.game.m_ui2Manager.addCustomKillFeedMessage(segments);
            }
        }

        // Delete objects
        for (let i = 0; i < msg.delObjIds.length; i++) {
            this.game.m_objectCreator.m_deleteObj(msg.delObjIds[i]);
        }

        this.game.m_playing = true;

        const ctx: Ctx = {
            audioManager: this.game.m_audioManager,
            renderer: this.game.m_renderer,
            particleBarn: this.game.m_particleBarn,
            map: this.game.m_map,
            smokeBarn: this.game.m_smokeBarn,
            decalBarn: this.game.m_decalBarn,
        };

        // Update full objects
        for (let i = 0; i < msg.fullObjects.length; i++) {
            const obj = msg.fullObjects[i];
            this.game.m_objectCreator.m_updateObjFull(obj.__type, obj.__id, obj, ctx);
        }

        // Update partial objects
        for (let i = 0; i < msg.partObjects.length; i++) {
            const obj = msg.partObjects[i];
            this.game.m_objectCreator.m_updateObjPart(obj.__id, obj, ctx);
        }

        for (let i = 0; i < msg.players.length; i++) {
            const { status, data, info } = msg.players[i];
            // replaymsg doesn't send groupstatus unlike updatemsg (it's redundant if we know everything about all players at all times)
            // so we send disconnected with playerstatus and patch health in from localdata as compensation for its absence
            status.health = data.health;
            this.game.m_playerBarn.setPlayerStatus(info.playerId, status);

            this.game.m_playerBarn.setPlayerInfo(info);
            const player = this.game.m_playerBarn.getPlayerById(info.playerId)!;
            player.m_setLocalData(data, this.game.m_playerBarn);
        }

        // Delete player infos
        for (let i = 0; i < msg.deletedPlayerIds.length; i++) {
            const playerId = msg.deletedPlayerIds[i];
            this.game.m_playerBarn.deletePlayerInfo(playerId);
        }

        this.game.m_playerBarn.recomputeTeamData();

        // Gas data
        if (msg.gasDirty) {
            this.game.m_gas.setFullState(
                msg.gasT,
                msg.gasData,
                this.game.m_map,
                this.game.m_uiManager,
            );
        }
        if (msg.gasTDirty) {
            this.game.m_gas.setProgress(msg.gasT);
        }

        // Create bullets
        for (let i = 0; i < msg.bullets.length; i++) {
            const b = msg.bullets[i];
            createBullet(
                b,
                this.game.m_bulletBarn,
                this.game.m_flareBarn,
                this.game.m_playerBarn,
                this.game.m_renderer,
            );
            if (b.shotFx) {
                this.game.m_shotBarn.addShot(b);
            }
        }

        // Create explosions
        for (let i = 0; i < msg.explosions.length; i++) {
            const e = msg.explosions[i];
            this.game.m_explosionBarn.addExplosion(e.type, e.pos, e.layer);
        }

        const shouldAddEmote = (
            emote: Emote,
            activeGroupId: number,
            activeTeamId: number,
        ) => {
            const def = GameObjectDefs[emote.type];
            const emotePlayerInfo = this.game.m_playerBarn.getPlayerInfo(emote.playerId);
            const emotePlayerStatus = this.game.m_playerBarn.getPlayerStatus(
                emote.playerId,
            );

            if (emote.isPing && def.type == "ping" && def.mapEvent) {
                return true;
            }

            if (def.type == "emote" && !def.teamOnly) {
                return true;
            }

            if (emotePlayerInfo.playerId != 0) {
                if (activeGroupId == emotePlayerInfo.groupId) {
                    return true;
                }

                if (
                    emotePlayerStatus.role == "leader" &&
                    emotePlayerInfo.teamId == activeTeamId
                ) {
                    return true;
                }
            }

            return false;
        };

        // Create emotes and pings
        for (let i = 0; i < msg.emotes.length; i++) {
            const emote = msg.emotes[i];
            if (shouldAddEmote(emote, activeGroupId, activeTeamId)) {
                if (emote.isPing) {
                    this.game.m_emoteBarn.addPing(emote, this.game.m_map.factionMode);
                } else {
                    this.game.m_emoteBarn.addEmote(emote);
                }
            }
        }

        // Update planes
        this.game.m_planeBarn.updatePlanes(msg.planes, this.game.m_map);

        // Create airstrike zones
        for (let x = 0; x < msg.airstrikeZones.length; x++) {
            this.game.m_planeBarn.createAirstrikeZone(msg.airstrikeZones[x]);
        }

        this.game.m_uiManager.updateMapIndicators(msg.mapIndicators);

        // Update kill leader
        if (msg.killLeaderDirty) {
            const leaderNameText = helpers.htmlEscape(
                this.game.m_playerBarn.getPlayerName(
                    msg.killLeaderId,
                    this.game.m_activeId,
                    true,
                ),
            );
            this.game.m_uiManager.updateKillLeader(
                msg.killLeaderId,
                leaderNameText,
                msg.killLeaderKills,
                this.game.m_map.getMapDef().gameMode,
            );
        }

        while (true) {
            const type = msg.msgsToSend.deserializeMsgType();
            if (type == net.MsgType.None) {
                break;
            }
            this.game.m_onMsg(type, msg.msgsToSend.getStream());
        }
    }

    // active player update not replay client update
    update(dt: number) {
        const player = this.game.m_activePlayer;

        if (player.isFreecam) {
            const movement = v2.create(0, 0);
            const speed = 60 * dt;

            // Only use arrow keys if they are unbound
            if (this.game.m_input.keyDown(Key.A)) {
                movement.x--;
            }
            if (this.game.m_input.keyDown(Key.D)) {
                movement.x++;
            }
            if (this.game.m_input.keyDown(Key.W)) {
                movement.y++;
            }
            if (this.game.m_input.keyDown(Key.S)) {
                movement.y--;
            }

            if (movement.x * movement.y != 0) {
                movement.x *= Math.SQRT1_2;
                movement.y *= Math.SQRT1_2;
            }

            const velocity = v2.mul(movement, speed);
            const newPos = v2.add(player.m_pos, velocity);
            const clampedPos = math.v2Clamp(
                newPos,
                v2.create(0, 0),
                v2.create(this.game.m_map.width, this.game.m_map.height),
            );
            // for player status
            player.m_netData.m_pos = clampedPos;

            player.m_pos = clampedPos;
            player.m_visualPos = clampedPos;

            if (this.game.m_input.keyDown(Key.Plus)) {
                player.m_localData.m_zoom /= Math.pow(3, dt);
            }

            if (this.game.m_input.keyDown(Key.Minus)) {
                player.m_localData.m_zoom *= Math.pow(3, dt);
            }

            player.m_localData.m_zoom = math.clamp(player.m_localData.m_zoom, 5, 1000);

            if (
                this.game.m_uiManager.replayInputs.toggleLayer ||
                this.game.m_input.keyReleased(Key.Zero)
            ) {
                player.m_netData.m_layer ^= 1;
            }
        }

        if (
            this.game.m_uiManager.replayInputs.toFreecam &&
            !this.game.m_activePlayer.isFreecam
        ) {
            this.game.m_spectating = false;
            this.game.m_activeId = this.freecamPlayer.__id;
            this.game.m_activePlayer = this.freecamPlayer;

            this.game.m_uiManager.setSpectating(false, this.game.teamMode);
            this.game.m_uiManager.spectatedPlayerId = 0;
        }

        if (this.game.m_uiManager.replayInputs.copyLink) {
            const elapsedSeconds = Math.floor(
                this.tickToElapsed[this.currentTick - 1] / 1000,
            );
            const link = `${api.resolveRoomHost()}/?replay=${this.gameId}&t=${elapsedSeconds}`;
            helpers.copyTextToClipboard(link);
        }

        if (this.game.m_input.keyPressed(Key.M)) {
            this.game.m_uiManager.displayReplayMenu();
        }

        if (this.game.m_input.keyPressed(Key.G)) {
            this.game.m_uiManager.displayMapLarge(false);
        }

        if (this.game.m_input.keyPressed(Key.Escape)) {
            this.game.m_uiManager.toggleEscMenu();
        }

        for (
            let i = 0;
            i < this.game.m_uiManager.replayInputs.scrubberEvents.length;
            i++
        ) {
            const event = this.game.m_uiManager.replayInputs.scrubberEvents[i];
            switch (event.kind) {
                case "down":
                    this.pausedBeforeScrub = this.paused;
                    this.paused = true;
                    this.scrubbing = true;
                    break;
                case "input":
                    const current = this.tickToElapsed[this.currentTick - 1];
                    const target = event.value;
                    this.seekOffset = target - current;
                    break;
                case "up":
                    this.paused = this.pausedBeforeScrub;
                    this.scrubbing = false;
                    break;
            }
        }
        this.game.m_uiManager.replayInputs.scrubberEvents.length = 0;

        if (this.game.m_uiManager.replayInputs.seekForward) {
            this.seekOffset = 5000;
        }

        if (this.game.m_uiManager.replayInputs.seekBackward) {
            this.seekOffset = -5000;
        }

        this.game.m_camera.m_pos = v2.copy(this.game.m_activePlayer.m_visualPos);
        this.game.m_audioManager.cameraPos = v2.copy(this.game.m_camera.m_pos);

        if (this.game.m_input.keyPressed(Key.V)) {
            this.game.m_uiManager.cycleVisibilityMode();
        }

        if (
            (this.game.m_uiManager.replayInputs.playback ||
                this.game.m_input.keyReleased(Key.Space)) &&
            !this.scrubbing
        ) {
            if (this.isEnded()) {
                // kind of hacky but it works so yeah
                this.seekOffset = -1_000_000_000;
                this.paused = false;
            } else {
                this.paused = !this.paused;
            }

            // WARNING: very hacky, affects every single sound registered
            // might be a point later where i would want certain sounds to still play while paused
            // but for now this works fine
            if (this.paused) {
                this.game.m_audioManager.pause();
            } else {
                this.game.m_audioManager.resume();
            }
        }

        const specNext =
            this.game.m_uiManager.specNext || this.game.m_input.keyReleased(Key.Right);
        const specPrev =
            this.game.m_uiManager.specPrev || this.game.m_input.keyReleased(Key.Left);

        if (!this.done && (specNext || specPrev)) {
            const specDelta = +specNext - +specPrev;
            const spectatablePlayers = this.game.m_playerBarn.playerPool
                .m_getPool()
                .filter((p) => p.active && !p.m_netData.m_dead);
            const newActivePlayer = util.wrappedArrayIndex(
                spectatablePlayers,
                spectatablePlayers.indexOf(this.game.m_activePlayer) + specDelta,
            );

            this.game.m_activeId = newActivePlayer.__id;

            this.game.m_spectating = this.game.m_activeId != this.game.m_localId;
            this.game.m_activePlayer = newActivePlayer;
            this.game.m_uiManager.weapsDirty = true;
            if (this.game.m_spectating) {
                this.game.m_uiManager.setSpectateTarget(
                    this.game.m_activeId,
                    this.game.m_localId,
                    this.game.teamMode,
                    this.game.m_playerBarn,
                );
                this.game.m_touch.hideAll();
            } else {
                this.game.m_uiManager.setSpectating(false, this.game.teamMode);
                // necessary because the original game assumes that once you're spectating you never stop being a spectator
                // but transitioning back to the replay client player naturally requires exiting spectator mode
                this.game.m_uiManager.spectatedPlayerId = 0;
            }
        }

        if (
            this.game.m_spectating &&
            (this.game.m_activePlayer.m_netData.m_dead ||
                // player despawned, game object deleted
                !this.game.m_activePlayer.active)
        ) {
            this.game.m_spectating = false;
            this.game.m_activeId = this.freecamPlayer.__id;
            this.game.m_activePlayer = this.freecamPlayer;

            this.game.m_uiManager.setSpectating(false, this.game.teamMode);
            this.game.m_uiManager.spectatedPlayerId = 0;
        }

        player.layer = player.m_netData.m_layer;
        this.game.m_renderer.setActiveLayer(player.layer);
        this.game.m_audioManager.activeLayer = player.layer;
        const underground = player.isUnderground(this.game.m_map);
        this.game.m_renderer.setUnderground(underground);
        this.game.m_audioManager.underground = underground;

        this.game.m_uiManager.replayInputs.playback = false;
        this.game.m_uiManager.replayInputs.seekForward = false;
        this.game.m_uiManager.replayInputs.seekBackward = false;
        this.game.m_uiManager.replayInputs.toggleLayer = false;
        this.game.m_uiManager.replayInputs.toFreecam = false;
        this.game.m_uiManager.replayInputs.copyLink = false;

        // show the action the user can take, not the state they're in
        const playbackIconState = this.isEnded()
            ? "restart"
            : this.paused
              ? "play"
              : "pause";
        if (this.playbackIconState != playbackIconState) {
            this.playbackIconState = playbackIconState;
            this.game.m_uiManager.setReplayPlaybackIconState(playbackIconState);
        }

        this.updateGame(dt);
    }

    updateGame(dt: number) {
        const game = this.game;

        const simulationDt = this.paused ? 0 : dt;

        let debug: DebugOptions;
        if (IS_DEV) {
            debug = game.m_config.get("debug")!;
        } else {
            debug = {
                render: {},
            } as DebugOptions;
        }

        const smokeParticles = game.m_smokeBarn.m_particles;

        game.m_playerBarn.m_update(
            simulationDt,
            game.m_activeId,
            game.teamMode,
            game.m_renderer,
            game.m_particleBarn,
            game.m_camera,
            game.m_map,
            game.m_inputBinds,
            game.m_audioManager,
            game.m_ui2Manager,
            game.m_emoteBarn.wheelKeyTriggered,
            game.m_uiManager.displayingStats,
            game.m_spectating,
        );
        game.updateAmbience();

        game.m_camera.m_pos = v2.copy(game.m_activePlayer.m_visualPos);
        game.m_audioManager.cameraPos = v2.copy(game.m_camera.m_pos);

        game.m_camera.m_applyShake();
        const zoom = game.m_activePlayer.m_getZoom();
        const maxScreenDim = Math.max(
            game.m_camera.m_screenWidth,
            (game.m_camera.m_screenHeight * 16) / 9,
        );
        game.m_camera.m_targetZoom = (maxScreenDim * 0.5) / (zoom * game.m_camera.m_ppu);
        const zoomLerpIn = game.m_activePlayer.zoomFast ? 3 : 2;
        const zoomLerpOut = game.m_activePlayer.zoomFast ? 3 : 1.4;
        const zoomLerp =
            game.m_camera.m_targetZoom > game.m_camera.m_zoom ? zoomLerpIn : zoomLerpOut;
        game.m_camera.m_zoom = math.lerp(
            dt * zoomLerp,
            game.m_camera.m_zoom,
            game.m_camera.m_targetZoom,
        );

        game.m_uiManager.specNext = false;
        game.m_uiManager.specPrev = false;

        game.m_map.m_update(
            simulationDt,
            game.m_activePlayer,
            game.m_playerBarn,
            game.m_particleBarn,
            game.m_audioManager,
            game.m_ambience,
            game.m_renderer,
            game.m_camera,
            smokeParticles,
            debug,
        );
        game.m_lootBarn.m_update(
            simulationDt,
            game.m_activePlayer,
            game.m_map,
            game.m_audioManager,
            game.m_camera,
            debug,
        );
        game.m_bulletBarn.m_update(
            simulationDt,
            game.m_playerBarn,
            game.m_map,
            game.m_camera,
            game.m_activePlayer,
            game.m_renderer,
            game.m_particleBarn,
            game.m_audioManager,
        );
        game.m_flareBarn.m_update(
            simulationDt,
            game.m_playerBarn,
            game.m_map,
            game.m_camera,
            game.m_activePlayer,
            game.m_renderer,
            game.m_particleBarn,
            game.m_audioManager,
        );
        game.m_projectileBarn.m_update(
            simulationDt,
            game.m_particleBarn,
            game.m_audioManager,
            game.m_activePlayer,
            game.m_map,
            game.m_renderer,
            game.m_camera,
        );
        game.m_explosionBarn.m_update(
            simulationDt,
            game.m_map,
            game.m_playerBarn,
            game.m_camera,
            game.m_particleBarn,
            game.m_audioManager,
            debug,
        );
        game.m_airdropBarn.m_update(
            simulationDt,
            game.m_activePlayer,
            game.m_camera,
            game.m_map,
            game.m_particleBarn,
            game.m_renderer,
            game.m_audioManager,
        );
        game.m_planeBarn.m_update(
            simulationDt,
            game.m_camera,
            game.m_activePlayer,
            game.m_map,
            game.m_renderer,
        );
        game.m_smokeBarn.m_update(
            simulationDt,
            game.m_camera,
            game.m_activePlayer,
            game.m_map,
            game.m_renderer,
        );
        game.m_shotBarn.m_update(
            simulationDt,
            game.m_activeId,
            game.m_playerBarn,
            game.m_particleBarn,
            game.m_audioManager,
        );
        game.m_particleBarn.m_update(simulationDt, game.m_camera, debug);
        game.m_deadBodyBarn.m_update(
            simulationDt,
            game.m_playerBarn,
            game.m_activePlayer,
            game.m_map,
            game.m_camera,
            game.m_renderer,
        );
        game.m_decalBarn.m_update(simulationDt, game.m_camera, game.m_renderer, debug);
        game.m_uiManager.m_update(
            simulationDt,
            game.m_activePlayer,
            game.m_map,
            game.m_gas,
            game.m_lootBarn,
            game.m_playerBarn,
            game.m_camera,
            game.teamMode,
            game.m_map.factionMode,
        );
        game.m_ui2Manager.m_update(
            simulationDt,
            game.m_activePlayer,
            game.m_spectating,
            game.m_playerBarn,
            game.m_lootBarn,
            game.m_map,
            game.m_inputBinds,
        );
        game.m_emoteBarn.m_update(
            simulationDt,
            game.m_localId,
            game.m_activePlayer,
            game.teamMode,
            game.m_deadBodyBarn,
            game.m_map,
            game.m_renderer,
            game.m_input,
            game.m_inputBinds,
            game.m_spectating,
        );
        game.m_touch.m_update(
            simulationDt,
            game.m_activePlayer,
            game.m_map,
            game.m_camera,
            game.m_renderer,
        );
        game.m_renderer.m_update(dt, game.m_camera, game.m_map, debug);

        game.m_render(simulationDt, debug);
    }

    /** returns the tick at the given offset from the current tick */
    private getTickFromOffset(offsetMs: number) {
        const elapsedTime = this.tickToElapsed[this.currentTick - 1];
        const targetTime = math.clamp(
            elapsedTime + offsetMs,
            0,
            this.tickToElapsed[this.currentTick - 1],
        );

        let left = 0;
        let right = this.currentTick - 1;

        while (left <= right) {
            const mid = (left + right) >>> 1;

            if (this.tickToElapsed[mid] < targetTime) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        return Math.max(1, right);
    }
}
