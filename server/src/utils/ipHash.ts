import { createHash } from "node:crypto";
import { Config } from "../config";

/**
 * SHA-256 of (secret + ip). Matches {@link hashIp} previously in ModerationRouter
 * and ip_logs / moderation tooling.
 */
export function hashIp(ip: string): string {
    return createHash("sha256")
        .update(Config.secrets.SURVEV_IP_SECRET + ip)
        .digest("hex");
}
