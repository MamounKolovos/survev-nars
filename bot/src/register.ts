import { PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import { assert } from "../../shared/utils/util";
import * as command from "./command";
import { Config } from "./config";

async function main() {
    assert(Config.secrets.DISCORD_BOT_TOKEN != undefined);
    assert(Config.secrets.DISCORD_CLIENT_ID != undefined);
    assert(Config.discordGuildId != undefined);

    const rest = new REST({ version: "10" }).setToken(Config.secrets.DISCORD_BOT_TOKEN);

    //TODO: will change in the future, just for now to get stuff working
    const body = [
        command.commands.giveItem,
        command.commands.removeItem,
        command.commands.findItem,
        command.commands.transferItem,
    ].map((cmd) => {
        const builder = createBuilder(
            cmd.name,
            cmd.description,
            cmd.isAdmin,
            cmd.options,
        );

        return builder.toJSON();
    });

    try {
        console.log("Started refreshing application (/) commands.");
        const route = Routes.applicationGuildCommands(
            Config.secrets.DISCORD_CLIENT_ID,
            Config.discordGuildId,
        );
        // await rest.put(route, { body: commands.map((command) => command.toJSON()) });
        await rest.put(route, { body });
        console.log("Successfully reloaded application (/) commands.");
    } catch (e: unknown) {
        console.log("Failed to refresh application commands: ", e);
    }
}

function createBuilder(
    name: string,
    description: string,
    isAdmin: boolean,
    options: command.OptionSpec[],
): SlashCommandBuilder {
    const builder = new SlashCommandBuilder().setName(name).setDescription(description);

    if (isAdmin) {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    }

    for (const option of options) {
        builder.addStringOption((optionBuilder) =>
            optionBuilder
                .setName(option.name)
                .setDescription(option.description)
                .setRequired(option.required),
        );
    }

    return builder;
}

await main();
