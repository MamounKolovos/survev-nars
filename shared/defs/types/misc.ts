import { TeamMode } from "../../gameConfig";

export enum MapId {
    Main = 0,
    Desert = 1,
    Woods = 2,
    Faction = 3,
    Potato = 4,
    Savannah = 5,
    Halloween = 6,
    Cobalt = 7,
    ForcedLoot = 8,
    Deathmatch = 9,
    Solos = 10,
    ForcedLoot2 = 11,
}

export const TeamModeToString = {
    [TeamMode.Solo]: "solo",
    [TeamMode.Duo]: "duo",
    [TeamMode.Squad]: "squad",
};
