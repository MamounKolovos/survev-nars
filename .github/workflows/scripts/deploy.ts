import { execSync } from "child_process";
import { Replay } from "../../../client/src/replay";

const branch = `v${Replay.VERSION}`;
const project = "survev-nars";

console.log(`Deploying version ${Replay.VERSION} to branch ${branch}`);

execSync(
    `pnpm wrangler pages deploy ./client/dist --project-name=${project} --branch=${branch}`,
    {
        stdio: "inherit",
    },
);

// if i ever decide to switch from whole numbers to semantic versioning
const slug = branch.replace(/\./g, "-");
console.log(`Deployed: https://${slug}.${project}.pages.dev`);
