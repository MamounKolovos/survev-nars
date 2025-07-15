import crypto from "crypto";
import fs from "fs";
import { GamePlugin } from "../pluginManager";
export default class IPTrackingPlugin extends GamePlugin {
    public override initListeners(): void {
        this.on("playerDidJoin", (event) => {
            const path = "../playerInfo.json";
            if (!fs.existsSync(path)) {
                fs.writeFileSync(path, "{}");
            }
            const playerName = event.data.player.name;
            const hashedIP = crypto
                .createHash("sha256")
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
                        lastJoinTime: new Date().toLocaleString(),
                    },
                ];
            } else {
                const playerNameObj = playerInfo[hashedIP].find(
                    (nameObj) => nameObj.name == playerName,
                );

                if (playerNameObj) {
                    playerNameObj.count++;
                    playerNameObj.lastJoinTime = new Date().toLocaleString();
                } else {
                    playerInfo[hashedIP].push({
                        name: playerName,
                        count: 1,
                        lastJoinTime: new Date().toLocaleString(),
                    });
                }
            }
            fs.writeFileSync(path, JSON.stringify(playerInfo, null, 3));
            console.log(playerInfo);
        });
    }
}
