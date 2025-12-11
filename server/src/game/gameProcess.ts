import { platform } from "os";
import NanoTimer from "nanotimer";
import { Config } from "../config";
import { logErrorToWebhook } from "../utils/serverHelpers";
import { type ProcessMsg, ProcessMsgType } from "../utils/types";
import { Game } from "./game";

let game: Game | undefined;
let gameCount = 0;

function sendMsg(msg: ProcessMsg) {
    process.send!(msg);
}

process.on("disconnect", () => {
    process.exit();
});

const socketMsgs: Array<{
    socketId: string;
    data: Uint8Array;
    ip: string;
}> = [];

let lastMsgTime = Date.now();

process.on("message", async (msg: ProcessMsg) => {
    if (msg.type) {
        lastMsgTime = Date.now();
    }

    if (msg.type === ProcessMsgType.Create && !game) {
        game = new Game(
            msg.id,
            msg.config,
            (id, data) => {
                socketMsgs.push({
                    socketId: id,
                    data,
                    ip: "",
                });
            },
            (id, reason) => {
                sendMsg({
                    type: ProcessMsgType.SocketClose,
                    socketId: id,
                    reason,
                });
            },
            (msg) => {
                sendMsg(msg);
                if (msg.stopped) {
                    game = undefined;
                }
            },
        );
        gameCount++;

        await game.init();
        sendMsg({
            type: ProcessMsgType.Created,
        });
    }

    if (!game) return;

    switch (msg.type) {
        case ProcessMsgType.AddJoinToken:
            game.addJoinTokens(msg.tokens, msg.autoFill);
            break;
        case ProcessMsgType.SocketMsg:
            const sMsg = msg.msgs[0];
            game.handleMsg(sMsg.data as ArrayBuffer, sMsg.socketId, sMsg.ip);
            break;
        case ProcessMsgType.SocketClose:
            game.handleSocketClose(msg.socketId);
            break;
    }
});

function formatUptime(): string {
    const totalSeconds = Math.floor(process.uptime());
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

setInterval(
    () => {
        if (!game) return;

        const content = `\`\`\`
PID: ${process.pid}
Uptime: ${formatUptime()}
Game Count: ${gameCount}

Game ID: ${game.id}
Team Mode: ${game.teamMode}

Started: ${game.started}
Started Time: ${game.startedTime}
Stopped: ${game.stopped}
Over: ${game.over}

Allow Join: ${game.allowJoin}
Can Join: ${game.canJoin}
Check If Game Started: ${game.modeManager.isGameStarted()}

# of Groups Alive: ${game.playerBarn.getAliveGroups().length}
# of Players Alive: ${game.playerBarn.livingPlayers.length}
# of Players Connected: ${game.playerBarn.livingPlayers.filter((p) => !p.disconnected).length}
\`\`\``;
        const webhook =
            "https://discord.com/api/webhooks/1448517276717285501/bgbZYcZdA2YgJQSTgcFbERfsNtTsI50FMsN3s0mwBAOxGfEHwYE4ukOdPu73doHqILx6";
        fetch(webhook, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                content,
            }),
        }).catch((err) => {
            console.error("Failed to log error to webhook", err);
        });
    },
    1000 * 60 * 10,
);

setInterval(() => {
    if (Date.now() - lastMsgTime > 10000) {
        console.log("Game process has not received a message in 10 seconds, exiting");
        process.exit();
    }

    if (game) {
        game?.updateData();
    } else {
        sendMsg({
            type: ProcessMsgType.KeepAlive,
        });
    }
}, 5000);

// setInterval on windows sucks
// and doesn't give accurate timings
if (platform() === "win32") {
    new NanoTimer().setInterval(
        () => {
            game?.update();
        },
        "",
        `${1000 / Config.gameTps}m`,
    );

    new NanoTimer().setInterval(
        () => {
            game?.netSync();
            sendMsg({
                type: ProcessMsgType.SocketMsg,
                msgs: socketMsgs,
            });
            socketMsgs.length = 0;
        },
        "",
        `${1000 / Config.netSyncTps}m`,
    );
} else {
    setInterval(() => {
        game?.update();
    }, 1000 / Config.gameTps);

    setInterval(() => {
        game?.netSync();
        sendMsg({
            type: ProcessMsgType.SocketMsg,
            msgs: socketMsgs,
        });
        socketMsgs.length = 0;
    }, 1000 / Config.netSyncTps);
}

process.on("uncaughtException", async (err) => {
    console.error(err);
    game = undefined;

    await logErrorToWebhook("server", "Game process error", err);

    process.exit(1);
});
