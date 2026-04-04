import { fetchApiServer } from "./scriptUtils";

const [, , slug, banReason, banAssociatedIps, ipBanDuration, ipBanPermanent] =
    process.argv;

const body = await fetchApiServer("private/moderation/ban_account", {
    slug,
    banReason,
    banAssociatedIps: banAssociatedIps ? banAssociatedIps !== "false" : undefined,
    ipBanDuration: ipBanDuration ? Number(ipBanDuration) : undefined,
    ipBanPermanent: ipBanPermanent ? ipBanPermanent === "true" : undefined,
});

console.log(body);
