import { fetchApiServer } from "./scriptUtils";

const [, , slug] = process.argv;

const body = await fetchApiServer("private/moderation/unban_account", {
    slug,
});

console.log(body);
