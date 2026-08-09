import { getConfig } from "../../config";

const isProd = process.env["NODE_ENV"] == "production";
const serverConfigPath = isProd ? "../../" : "";
export const Config = getConfig(isProd, serverConfigPath);
