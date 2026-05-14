import { fetchApiServer } from "./scriptUtils";

const [, , item, slug] = process.argv;

const body = await fetchApiServer("private/remove_item", {
    item,
    slug,
});

console.log(body);
