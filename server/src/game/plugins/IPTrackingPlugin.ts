import crypto from "crypto";
import fs from "fs";
import { Config } from "../../config";
import { GamePlugin } from "../pluginManager";
export default class IPTrackingPlugin extends GamePlugin {
    public override initListeners(): void {
        this.on("playerDidJoin", (event) => {
            const startTime = performance.now();
            const path = "../playerInfo.json";
            if (!fs.existsSync(path)) {
                fs.writeFileSync(path, "{}");
            }
            const playerName = event.data.player.name;
            const hashedIP = crypto
                .createHash("sha256")
                .update(Config.secrets.SURVEV_IP_HASH_SALT)
                .update(event.data.player.ip)
                .digest("hex");
            const playerInfo: Record<
                string,
                Array<{ name: string; count: number; lastJoinTime: string }>
            > = JSON.parse(fs.readFileSync(path, "utf-8")) as any;
            if (!playerInfo[hashedIP]) {
                playerInfo[hashedIP] = [
                    {
                        name: playerName,
                        count: 1,
                        lastJoinTime: new Date().toLocaleString("en-US", {
                            timeZone: "America/New_York",
                        }),
                    },
                ];
            } else {
                const playerNameObj = playerInfo[hashedIP].find(
                    (nameObj) => nameObj.name == playerName,
                );

                if (playerNameObj) {
                    playerNameObj.count++;
                    playerNameObj.lastJoinTime = new Date().toLocaleString("en-US", {
                        timeZone: "America/New_York",
                    });
                } else {
                    playerInfo[hashedIP].push({
                        name: playerName,
                        count: 1,
                        lastJoinTime: new Date().toLocaleString("en-US", {
                            timeZone: "America/New_York",
                        }),
                    });
                }
            }
            fs.writeFileSync(path, JSON.stringify(playerInfo, null, 3));
            const loggingTime = performance.now() - startTime
            console.log("logging player", playerName, "took", loggingTime, "ms");
        });
    }
}
