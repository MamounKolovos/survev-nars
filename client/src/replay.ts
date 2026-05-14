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
import { Key, MouseWheel } from "./input";
import { createBullet } from "./objects/bullet";
import type { Player } from "./objects/player";
import type { EventMarker } from "./ui/ui";

type Checkpoint = {
    totalElapsed: number;
    byteIndex: number;
    mapStreamIndex: number;
};

type MapEntry = {
    totalElapsed: number;
    stream: net.BitStream;
};

type Event =
    | { kind: "killed"; targetId: number; killerId: number; totalElapsed: number }
    | { kind: "downed"; targetId: number; downerId: number; totalElapsed: number }
    | { kind: "mapChanged"; totalElapsed: number };

function eventKindToIcon(kind: Event["kind"]): string {
    switch (kind) {
        case "killed":
            return "/img/gui/skull-outlined.svg";
        case "downed":
            return "/img/gui/player-map-downed.svg";
        case "mapChanged":
            return "/img/gui/map.svg";
    }
}

/** server side allocator max - 1 */
const FREECAM_ID = 65534;
const FREECAM_GROUP_ID = 255;
const FREECAM_TEAM_ID = 255;

const FREECAM_ZOOM_RATE = 3;
const FREECAM_MIN_ZOOM = 10;
const FREECAM_MAX_ZOOM = 1000;

const FREECAM_MIN_SPEED = 10;
const FREECAM_MAX_SPEED = 80;

const NUMBER_KEYS = [
    Key.Zero,
    Key.One,
    Key.Two,
    Key.Three,
    Key.Four,
    Key.Five,
    Key.Six,
    Key.Seven,
    Key.Eight,
    Key.Nine,
];

// map instead of record to preserve definition order
const keybinds = new Map<number, string>([
    [Key.W, "Freecam Move Up"],
    [Key.A, "Freecam Move Left"],
    [Key.S, "Freecam Move Down"],
    [Key.D, "Freecam Move Right"],
    [Key.Plus, "Freecam Zoom In"],
    [Key.Minus, "Freecam Zoom Out"],
    [Key.F, "Switch To Freecam"],
    [Key.T, "Freecam Toggle Layer (Ground/Underground)"],
    [Key.J, "Seek Backward 5s"],
    [Key.K, "Seek Forward 5s"],
    ...NUMBER_KEYS.map((key, i) => [key, `Seek to ${i * 10}%`] as [Key, string]),
    [Key.M, "Toggle Replay Menu"],
    [Key.G, "Toggle Big Map"],
    [Key.V, "Toggle Minimap"],
    [Key.Space, "Toggle Playback (Play/Pause)"],
    [Key.C, "Cycle Playback Speed"],
    [Key.Right, "Spectate Next Player"],
    [Key.Left, "Spectate Previous Player"],
]);

type SeekCommand =
    | { kind: "relative"; amount: number }
    | { kind: "absolute"; amount: number };

export type ReplaySource =
    | { kind: "local" }
    | { kind: "server"; gameId: string; playerId?: number; startSecond?: number };

export class Replay {
    private view: DataView;
    private uint8buff: Uint8Array<ArrayBuffer>;

    stream: net.BitStream;

    freecamPlayer!: Player;

    done = false;
    paused = false;
    scrubbing = false;
    /**
     * used to respect pause state while scrubbing,
     * if replay was paused before scrubbing, it should stay paused after
     */
    pausedBeforeScrub = false;

    seekCommand?: SeekCommand;

    playbackIconState: "play" | "pause" | "restart" = "pause";

    tickElapsed = 0;

    totalElapsedUs: number;

    teamMode: TeamMode;

    checkpoints: Checkpoint[];
    mapEntries: MapEntry[];
    currentMapEntryIndex = -1;
    lastSoughtEventIndex?: number;

    /** we assume that the server recorded and sent them in chronological order */
    events: Event[];
    activeEvents: Event[] = [];

    headerStart: number;

    currentTime = 0;

    playbackSpeed = 1;

    stopped = false;

    startingPlayerId?: number;

    lastSpectatedPlayerId?: number;

    constructor(
        buffer: Uint8Array<ArrayBuffer>,
        readonly game: Game,
        readonly source: ReplaySource,
    ) {
        this.uint8buff = buffer;
        this.view = new DataView(buffer.buffer);

        this.headerStart = this.view.getUint32(0);
        let index = this.headerStart;

        const version = this.view.getUint32(index);
        console.log(`Recording version: ${version}`);
        index += 4;

        const protocolVersion = this.view.getUint32(index);
        if (protocolVersion != GameConfig.protocolVersion) {
            throw new Error(
                `Replay protocol mismatch: expected ${GameConfig.protocolVersion} got ${protocolVersion}`,
            );
        }
        index += 4;

        this.totalElapsedUs = this.view.getUint32(index);
        index += 4;

        this.teamMode = this.view.getUint8(index);
        index += 1;

        const checkpointCount = this.view.getUint16(index);
        index += 2;

        this.checkpoints = [];
        for (let i = 0; i < checkpointCount; i++) {
            const byteIndex = this.view.getUint32(index);
            index += 4;
            const totalElapsed = this.view.getUint32(index);
            index += 4;
            const mapStreamIndex = this.view.getUint8(index);
            index += 1;
            this.checkpoints.push({ totalElapsed, byteIndex, mapStreamIndex });
        }

        const mapStreamCount = this.view.getUint8(index);
        index += 1;

        this.mapEntries = [];
        for (let i = 0; i < mapStreamCount; i++) {
            const totalElapsed = this.view.getUint32(index);
            index += 4;

            const length = this.view.getUint32(index);
            index += 4;
            const mapBuffer = this.uint8buff.buffer.slice(index, index + length);
            const stream = new net.BitStream(mapBuffer);
            index += length;
            this.mapEntries.push({ totalElapsed, stream });
        }

        const eventCount = this.view.getUint16(index);
        index += 2;

        this.events = [];
        for (let i = 0; i < eventCount; i++) {
            let event: Event;
            const kindValue = this.view.getUint8(index);
            switch (kindValue) {
                case 0: {
                    const kind = "killed";
                    index += 1;
                    const targetId = this.view.getUint16(index);
                    index += 2;
                    const killerId = this.view.getUint16(index);
                    index += 2;
                    event = {
                        kind,
                        targetId,
                        killerId,
                        totalElapsed: this.view.getUint32(index),
                    };
                    index += 4;
                    break;
                }
                case 1: {
                    const kind = "downed";
                    index += 1;
                    const targetId = this.view.getUint16(index);
                    index += 2;
                    const downerId = this.view.getUint16(index);
                    index += 2;
                    event = {
                        kind,
                        targetId,
                        downerId,
                        totalElapsed: this.view.getUint32(index),
                    };
                    index += 4;
                    break;
                }
                case 2: {
                    const kind = "mapChanged";
                    index += 1;
                    event = { kind, totalElapsed: this.view.getUint32(index) };
                    index += 4;
                    break;
                }
                default:
                    throw new Error(`unexpected event kind: ${kindValue}`);
            }

            this.events.push(event);
        }

        this.stream = new net.BitStream(
            this.uint8buff.buffer as ArrayBuffer,
            4,
            this.headerStart - 4,
        );

        if (source.kind == "server") {
            if (source.startSecond) {
                this.seekCommand = {
                    kind: "absolute",
                    amount: source.startSecond * 1_000_000,
                };
            }

            if (source.playerId) {
                this.startingPlayerId = source.playerId;
            }
        }
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

        this.game.m_uiManager.setReplayTotalTimeLabel(this.totalElapsedUs / 1_000_000);
        this.game.m_uiManager.setReplayScrubberMax(this.totalElapsedUs);
        this.game.m_uiManager.setReplayScrubberValue(0);

        this.game.m_uiManager.displayReplayGuide();
        this.game.m_uiManager.setReplayGuideKeybinds(keybinds);

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

        // IMPORTANT: freecam player is never rendered because Player.visualsDirty is never set
        // player.visualsDirty = true;
        this.freecamPlayer = player;

        this.toFreecam();

        player.m_netData.m_outfit = "outfitBase";

        // const stream = new net.BitStream(
        //     this.uint8buff.buffer as ArrayBuffer,
        //     4,
        //     this.headerStart - 4,
        // );

        let previous = performance.now();
        let accumulator = 0;

        this.tickElapsed = 0;

        const loop = () => {
            if (this.stopped) return;

            let current = performance.now();
            const dt = Math.trunc((current - previous) * 1000);
            previous = current;

            if (this.seekCommand != undefined) {
                this.game.m_audioManager.kill();
                this.game.m_audioManager.suppressPlayback = true;

                let targetTime: number;
                switch (this.seekCommand.kind) {
                    case "absolute":
                        targetTime = this.seekCommand.amount;
                        break;
                    case "relative":
                        targetTime = this.currentTime + this.seekCommand.amount;
                        break;
                }
                targetTime = math.clamp(targetTime, 0, this.totalElapsedUs);

                const checkpointIndex = findLeftIndex(this.checkpoints, targetTime) ?? 0;
                const checkpoint = this.checkpoints[checkpointIndex];

                // we must always load a checkpoint when seeking backward
                // but we only load a checkpoint when seeking forward if the checkpoint is closer to the target than current tick
                // would be pointless work otherwise
                if (
                    targetTime < this.currentTime ||
                    checkpoint.totalElapsed > this.currentTime
                ) {
                    this.game.m_objectCreator.m_clear();
                    this.game.m_ui2Manager.clearKillFeed();
                    this.game.m_particleBarn.m_clear();
                    this.game.m_bulletBarn.m_clear();
                    this.game.m_planeBarn.m_clear();

                    this.stream.byteIndex = checkpoint.byteIndex;
                    this.currentTime = checkpoint.totalElapsed;
                    if (this.currentMapEntryIndex != checkpoint.mapStreamIndex) {
                        this.currentMapEntryIndex = checkpoint.mapStreamIndex;
                        const mapEntry = this.mapEntries[checkpoint.mapStreamIndex];
                        // very necessary! stream will be exhausted everytime its read so we must reset it
                        mapEntry.stream.byteIndex = 0;
                        this.game.m_onMsg(net.MsgType.Map, mapEntry.stream);
                    }

                    this.processTick(this.stream, true);
                    this.game.update(this.tickElapsed / 1_000_000);
                }

                while (this.currentTime < targetTime && !this.isEnded()) {
                    this.processTick(this.stream);
                    this.game.update(this.tickElapsed / 1_000_000);
                }

                if (this.startingPlayerId) {
                    this.setPerspectiveById(this.startingPlayerId);
                    this.startingPlayerId = undefined;
                }

                this.seekCommand = undefined;
                this.game.m_audioManager.suppressPlayback = false;

                previous = performance.now();
                accumulator = 0;

                requestAnimationFrame(loop);
                return;
            }

            if (!this.paused && !this.isEnded()) {
                accumulator += dt * this.playbackSpeed;

                while (accumulator >= this.tickElapsed && !this.isEnded()) {
                    accumulator -= this.tickElapsed;
                    this.processTick(this.stream);
                }
            }

            requestAnimationFrame(loop);
        };

        requestAnimationFrame(loop);
    }

    processTick(stream: net.BitStream, skipDeletes = false) {
        this.tickElapsed = stream.readUint32();

        this.currentTime += this.tickElapsed;

        const nextMapEntryIndex = this.currentMapEntryIndex + 1;
        if (
            nextMapEntryIndex < this.mapEntries.length &&
            this.currentTime >= this.mapEntries[nextMapEntryIndex].totalElapsed
        ) {
            this.currentMapEntryIndex = nextMapEntryIndex;
            const mapStream = this.mapEntries[nextMapEntryIndex].stream;
            mapStream.byteIndex = 0;
            this.game.m_onMsg(net.MsgType.Map, mapStream);
        }

        const msg = new net.ReplayMsg();
        msg.deserialize(stream, this.game.m_objectCreator);
        // meh design, find a better abstraction in the future
        if (skipDeletes) {
            msg.delObjIds.length = 0;
        }

        this.nextTick(msg);

        // IMPORTANT: partial fix to perspective spectating on despawnable players when backward seeking
        // if current time is 31, checkpoint is at 20, player is created at 23, and target is at 250
        // this will trigger when the checkpoint is loaded even though the player exists by the time the target is reached
        if (this.game.m_spectating && !this.canSpectate(this.game.m_activePlayer)) {
            this.toFreecam();
        }

        this.game.m_uiManager.setReplayElapsedTimeLabel(this.currentTime / 1_000_000);
        this.game.m_uiManager.setReplayScrubberValue(this.currentTime);
    }

    isEnded(): boolean {
        // byteIndex is 0 at byte 4 of the entire recording since we reserve the first 4 bytes for the header's start position
        // so adding 4 just aligns it with its true position in the recording so it can be compared to the header start position
        return this.stream.byteIndex + 4 >= this.headerStart;
    }

    nextTick(msg: net.ReplayMsg) {
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
            const { data, playerId, disconnected, extraDirty, extra } = msg.players[i];

            const player = this.game.m_playerBarn.getPlayerById(playerId)!;

            player.m_setLocalData(data, this.game.m_playerBarn);

            this.game.m_playerBarn.setPlayerStatus(playerId, {
                pos: v2.copy(player.m_netData.m_pos),
                health: player.m_localData.m_health,
                disconnected,
                dead: player.m_netData.m_dead,
                downed: player.m_netData.m_downed,
                role: player.m_netData.m_role,
                visible: true,
            });

            if (extraDirty) {
                this.game.m_playerBarn.setPlayerInfo({
                    playerId,
                    teamId: extra.teamId,
                    groupId: extra.groupId,
                    name: extra.name,
                    loadout: extra.loadout,
                });
            }
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
            if (this.game.m_input.keyDown(Key.Plus)) {
                player.m_localData.m_zoom /= Math.pow(FREECAM_ZOOM_RATE, dt);
            }

            if (this.game.m_input.keyDown(Key.Minus)) {
                player.m_localData.m_zoom *= Math.pow(FREECAM_ZOOM_RATE, dt);
            }

            const wheelState = this.game.m_input.mouseWheel();
            if (
                wheelState.kind != MouseWheel.None &&
                !this.game.m_inputBinds.menuHovered
            ) {
                const delta = wheelState.delta * 0.003;
                const logZoom = Math.log(player.m_localData.m_zoom);
                const newZoom = Math.exp(logZoom + delta);
                player.m_localData.m_zoom = newZoom;
            }

            player.m_localData.m_zoom = math.clamp(
                player.m_localData.m_zoom,
                FREECAM_MIN_ZOOM,
                FREECAM_MAX_ZOOM,
            );

            const movement = v2.create(0, 0);

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

            const progress = math.smoothstep(
                Math.log(player.m_localData.m_zoom),
                Math.log(FREECAM_MIN_ZOOM),
                Math.log(FREECAM_MAX_ZOOM),
            );
            const speed = math.lerp(progress, FREECAM_MIN_SPEED, FREECAM_MAX_SPEED);
            const velocity = v2.mul(movement, speed);
            const newPos = v2.add(player.m_pos, v2.mul(velocity, dt));
            const clampedPos = math.v2Clamp(
                newPos,
                v2.create(0, 0),
                v2.create(this.game.m_map.width, this.game.m_map.height),
            );
            // for player status
            player.m_netData.m_pos = clampedPos;

            player.m_pos = clampedPos;
            player.m_visualPos = clampedPos;

            if (
                this.game.m_uiManager.replayInputs.toggleLayer ||
                this.game.m_input.keyReleased(Key.T)
            ) {
                player.m_netData.m_layer ^= 1;
            }
        }

        if (
            this.game.m_uiManager.replayInputs.toFreecam ||
            this.game.m_input.keyPressed(Key.F)
        ) {
            if (this.game.m_activePlayer.isFreecam && this.lastSpectatedPlayerId) {
                this.setPerspectiveById(this.lastSpectatedPlayerId);
            } else {
                this.toFreecam();
            }
        }

        if (this.source.kind == "server" && this.game.m_uiManager.replayInputs.copyLink) {
            const params = new URLSearchParams({ replay: this.source.gameId });

            params.set("t", String(Math.floor(this.currentTime / 1_000_000)));

            if (this.game.m_activeId !== this.freecamPlayer.__id) {
                params.set("player", String(this.game.m_activeId));
            }

            const link = `${window.location.protocol}//${api.resolveRoomHost()}/?${params.toString()}`;
            helpers.copyTextToClipboard(link);
        }

        if (this.source.kind == "server" && this.game.m_uiManager.replayInputs.download) {
            const blob = new Blob([this.uint8buff], { type: "application/octet-stream" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = `${this.source.gameId}.surv`;
            a.click();

            URL.revokeObjectURL(url);
        }

        if (
            this.game.m_uiManager.replayInputs.cyclePlaybackSpeed ||
            this.game.m_input.keyPressed(Key.C)
        ) {
            this.playbackSpeed = (this.playbackSpeed % 2) + 0.25;
            this.game.m_uiManager.setReplayCyclePlaybackSpeedLabel(this.playbackSpeed);
        }

        if (this.game.m_uiManager.replayInputs.markerClicked != undefined) {
            const totalElapsed = this.game.m_uiManager.replayInputs.markerClicked;

            this.seekCommand = { kind: "absolute", amount: totalElapsed };
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
                    const current = this.currentTime;
                    const target = event.value;
                    // improve performance by decreasing granularity
                    // if (Math.abs(target - current) > 250) {
                    this.seekCommand = { kind: "absolute", amount: target };
                    // }
                    break;
                case "up":
                    this.paused = this.pausedBeforeScrub;
                    this.scrubbing = false;
                    break;
            }
        }
        this.game.m_uiManager.replayInputs.scrubberEvents.length = 0;

        if (
            this.game.m_uiManager.replayInputs.seekForward ||
            this.game.m_input.keyPressed(Key.K)
        ) {
            this.seekCommand = {
                kind: "relative",
                amount: 5_000_000 * this.playbackSpeed,
            };
        }

        if (
            this.game.m_uiManager.replayInputs.seekBackward ||
            this.game.m_input.keyPressed(Key.J)
        ) {
            this.seekCommand = {
                kind: "relative",
                amount: -5_000_000 * this.playbackSpeed,
            };
        }

        if (this.game.m_uiManager.replayInputs.seekNextEvent) {
            const nextIndex = findRightIndex(this.activeEvents, this.currentTime);
            if (nextIndex != undefined) {
                const targetTime = this.activeEvents[nextIndex].totalElapsed;
                this.seekCommand = { kind: "absolute", amount: targetTime };
            }
        }

        if (this.game.m_uiManager.replayInputs.seekPrevEvent) {
            const nextIndex = findLeftIndex(this.activeEvents, this.currentTime);
            if (nextIndex != undefined) {
                const targetTime = this.activeEvents[nextIndex].totalElapsed;
                this.seekCommand = { kind: "absolute", amount: targetTime };
            }
        }

        // break ties by picking the farthest right key, simple and deterministic
        for (let i = NUMBER_KEYS.length - 1; i >= 0; i--) {
            const key = NUMBER_KEYS[i];
            if (this.game.m_input.keyPressed(key)) {
                this.seekCommand = {
                    kind: "absolute",
                    amount: (i / 10) * this.totalElapsedUs,
                };
                break;
            }
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
                this.seekCommand = { kind: "absolute", amount: 0 };
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
                .filter((p) => this.canSpectate(p));
            const newActivePlayer = util.wrappedArrayIndex(
                spectatablePlayers,
                spectatablePlayers.indexOf(this.game.m_activePlayer) + specDelta,
            );

            this.setPerspective(newActivePlayer);
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
        this.game.m_uiManager.replayInputs.seekNextEvent = false;
        this.game.m_uiManager.replayInputs.seekPrevEvent = false;
        this.game.m_uiManager.replayInputs.toggleLayer = false;
        this.game.m_uiManager.replayInputs.toFreecam = false;
        this.game.m_uiManager.replayInputs.copyLink = false;
        this.game.m_uiManager.replayInputs.download = false;
        this.game.m_uiManager.replayInputs.cyclePlaybackSpeed = false;
        this.game.m_uiManager.replayInputs.markerClicked = undefined;

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

        const simulationDt = this.paused ? 0 : dt * this.playbackSpeed;

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

    canSpectate(player: Player): boolean {
        // if not active, that means the player despawned, game object deleted
        return !player.m_netData.m_dead && player.active && !player.isFreecam;
    }

    setPerspectiveById(playerId: number) {
        const player = this.game.m_playerBarn.getPlayerById(playerId);
        if (player && this.canSpectate(player)) {
            this.setPerspective(player);
        }
    }

    setPerspective(player: Player) {
        this.game.m_spectating = true;
        this.game.m_activeId = player.__id;
        this.game.m_activePlayer = player;
        this.lastSpectatedPlayerId = player.__id;

        this.game.m_uiManager.weapsDirty = true;
        this.game.m_uiManager.setSpectateTarget(
            this.game.m_activeId,
            this.game.m_localId,
            this.game.teamMode,
            this.game.m_playerBarn,
        );
        this.game.m_touch.hideAll();

        const markers: EventMarker[] = [];
        this.activeEvents = [];

        for (let i = 0; i < this.events.length; i++) {
            const event = this.events[i];

            switch (event.kind) {
                case "killed":
                    if (event.killerId == player.__id) {
                        markers.push(this.eventToMarker(event, "#00bfffdd"));
                        this.activeEvents.push(event);
                    } else if (event.targetId == player.__id) {
                        markers.push(this.eventToMarker(event, "#df3c44dd"));
                        this.activeEvents.push(event);
                    }
                    break;
                case "downed":
                    if (event.downerId == player.__id) {
                        markers.push(this.eventToMarker(event, "#00bfffdd"));
                        this.activeEvents.push(event);
                    } else if (event.targetId == player.__id) {
                        markers.push(this.eventToMarker(event, "#df3c44dd"));
                        this.activeEvents.push(event);
                    }
                    break;
                case "mapChanged":
                    markers.push(this.eventToMarker(event, "#0000003d"));
                    this.activeEvents.push(event);
                    break;
            }
        }

        this.game.m_uiManager.setReplayEventMarkers(markers);
    }

    toFreecam() {
        if (this.game.m_activeId == this.freecamPlayer.__id) return;

        this.game.m_spectating = false;
        this.game.m_activeId = this.freecamPlayer.__id;
        this.game.m_activePlayer = this.freecamPlayer;

        this.game.m_uiManager.setSpectating(false, this.game.teamMode);
        // necessary because the original game assumes that once you're spectating you never stop being a spectator
        // but transitioning back to the replay client player naturally requires exiting spectator mode
        this.game.m_uiManager.spectatedPlayerId = 0;

        this.activeEvents = this.events;
        const markers = this.events.map((event) =>
            this.eventToMarker(event, "#0000003d"),
        );
        this.game.m_uiManager.setReplayEventMarkers(markers);
    }

    eventToMarker(event: Event, backgroundColor: string): EventMarker {
        return {
            progress: event.totalElapsed / this.totalElapsedUs,
            value: event.totalElapsed,
            icon: eventKindToIcon(event.kind),
            backgroundColor,
        };
    }

    free() {
        this.stopped = true;
        this.game.m_uiManager.displayReplayMenu(false);
        this.game.m_inputBinds.enable();
    }
}

function findLeftIndex<T extends { totalElapsed: number }>(
    arr: T[],
    targetTime: number,
): number | undefined {
    let left = 0;
    let right = arr.length - 1;

    while (left <= right) {
        const mid = (left + right) >>> 1;

        if (arr[mid].totalElapsed < targetTime) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return right < 0 ? undefined : right;
}

function findRightIndex<T extends { totalElapsed: number }>(
    arr: T[],
    targetTime: number,
): number | undefined {
    let left = 0;
    let right = arr.length - 1;

    while (left <= right) {
        const mid = (left + right) >>> 1;

        if (arr[mid].totalElapsed <= targetTime) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return left > arr.length - 1 ? undefined : left;
}
