import { fetchApiServer } from "./scriptUtils";

const [, , item, slug, source] = process.argv;

const body = await fetchApiServer("private/give_item", {
    item,
    slug,
    source,
});

console.log(body);
