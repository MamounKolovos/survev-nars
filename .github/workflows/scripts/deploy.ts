import { execSync } from "child_process";
import { GameConfig } from "../../../shared/gameConfig";

const branch = `v${GameConfig.replayVersion}`;
const project = "survev-nars";

console.log(`Deploying version ${GameConfig.replayVersion} to branch ${branch}`);

execSync(
    `pnpm wrangler pages deploy ./client/dist --project-name=${project} --branch=${branch}`,
    {
        stdio: "inherit",
    },
);

// if i ever decide to switch from whole numbers to semantic versioning
const slug = branch.replace(/\./g, "-");
console.log(`Deployed: https://${slug}.${project}.pages.dev`);
