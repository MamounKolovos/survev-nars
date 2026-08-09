import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import { hc } from "hono/client";
import type { z } from "zod";
import type { PrivateRouteApp } from "../../server/src/api/routes/private/private";
import type { GameObjectDef } from "../../shared/defs/gameObjectDefs";
import * as command from "./command";
import { Config } from "./config";
import * as result from "./result";
import type { Result } from "./result";

const apiClient = hc<PrivateRouteApp>(`${Config.gameServer.apiServerUrl}/private`, {
    headers: {
        "survev-api-key": Config.secrets.SURVEV_API_KEY,
    },
});

function main() {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    //TODO: transfer, info, give-item, remove-item

    client.on(Events.ClientReady, (client) => {
        console.log(`Logged in as ${client.user.id}!`);
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const cmdResult = command.fromName(interaction.commandName);
        if (result.isError(cmdResult)) {
            console.log(`Unsupported command received: ${interaction.commandName}`);
            await interaction.reply("unsupported command");
            return;
        }
        const cmd = cmdResult.value;

        // non admins cannot execute admin commands
        const isUserAdmin =
            interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
            false;
        if (cmd.value.isAdmin && !isUserAdmin) {
            await interaction.reply("You must be an administrator to use this command.");
            return;
        }

        const rawOptions = interaction.options.data.reduce(
            (acc, option) => {
                const { name, value } = option;
                acc[name] = value;
                return acc;
            },
            {} as Record<string, unknown>,
        );

        switch (cmd.kind) {
            case "GiveItem": {
                const optionsResult = parseOptions(rawOptions, cmd.value.optionsSchema);
                if (result.isError(optionsResult)) {
                    console.log(
                        "Failed to parse arguments",
                        rawOptions,
                        optionsResult.error,
                    );
                    await interaction.reply(
                        `Invalid arguments, error: \`\`\`json\n${optionsResult.error}\`\`\``,
                    );
                    return;
                }
                const options = optionsResult.value;
                const outcome = await giveItem(
                    options.item,
                    options.slug,
                    options.source,
                );
                switch (outcome.kind) {
                    case "Ok": {
                        await interaction.reply("Success!");
                        return;
                    }
                    case "Error": {
                        const stringified = executionErrorToString(outcome.error);
                        console.log(stringified);
                        await interaction.reply(stringified);
                        return;
                    }
                }
            }
            case "RemoveItem": {
                const optionsResult = parseOptions(rawOptions, cmd.value.optionsSchema);
                if (result.isError(optionsResult)) {
                    console.log(
                        "Failed to parse arguments",
                        rawOptions,
                        optionsResult.error,
                    );
                    await interaction.reply(
                        `Invalid arguments, error: \`\`\`json\n${optionsResult.error}\`\`\``,
                    );
                    return;
                }
                const options = optionsResult.value;
                const outcome = await removeItem(options.item, options.slug);
                switch (outcome.kind) {
                    case "Ok": {
                        await interaction.reply("Success!");
                        return;
                    }
                    case "Error": {
                        const stringified = executionErrorToString(outcome.error);
                        console.log(stringified);
                        await interaction.reply(stringified);
                        return;
                    }
                }
            }
            case "FindItem": {
                const optionsResult = parseOptions(rawOptions, cmd.value.optionsSchema);
                if (result.isError(optionsResult)) {
                    console.log(
                        "Failed to parse arguments",
                        rawOptions,
                        optionsResult.error,
                    );
                    await interaction.reply(
                        `Invalid arguments, error: \`\`\`json\n${optionsResult.error}\`\`\``,
                    );
                    return;
                }
                const options = optionsResult.value;
                const outcome = await findItem(options.name);
                switch (outcome.kind) {
                    case "Ok": {
                        const defString = `\`\`\`json\n${JSON.stringify(outcome.value, null, 3)}\n\`\`\``;
                        await interaction.reply(defString);
                        return;
                    }
                    case "Error": {
                        const stringified = executionErrorToString(outcome.error);
                        console.log(stringified);
                        await interaction.reply(stringified);
                        return;
                    }
                }
            }
            case "TransferItem": {
                const optionsResult = parseOptions(rawOptions, cmd.value.optionsSchema);
                if (result.isError(optionsResult)) {
                    console.log(
                        "Failed to parse arguments",
                        rawOptions,
                        optionsResult.error,
                    );
                    await interaction.reply(
                        `Invalid arguments, error: \`\`\`json\n${optionsResult.error}\`\`\``,
                    );
                    return;
                }
                const options = optionsResult.value;
                const outcome = await transferItem(
                    options.item,
                    options.oldSlug,
                    options.newSlug,
                );
                switch (outcome.kind) {
                    case "Ok": {
                        await interaction.reply("Success!");
                        return;
                    }
                    case "Error": {
                        const stringified = executionErrorToString(outcome.error);
                        console.log(stringified);
                        await interaction.reply(stringified);
                        return;
                    }
                }
            }
        }
    });

    client.login(Config.secrets.DISCORD_BOT_TOKEN);
}

function parseOptions<Options>(
    options: Record<string, unknown>,
    schema: z.ZodSchema<Options, z.ZodTypeDef, unknown>,
): Result<Options, string> {
    const parsed = schema.safeParse(options);

    return parsed.success ? result.Ok(parsed.data) : result.Error(String(parsed.error));
}

type ExecutionError =
    | { kind: "NetworkFailure" }
    | { kind: "OperationRejected"; message: string };

function NetworkFailure(): ExecutionError {
    return { kind: "NetworkFailure" };
}

function OperationRejected(fields: { message: string }): ExecutionError {
    return { kind: "OperationRejected", message: fields.message };
}

function executionErrorToString(error: ExecutionError): string {
    switch (error.kind) {
        case "NetworkFailure": {
            return "Could not reach the API Server";
        }
        case "OperationRejected": {
            return `Operation could not be completed, ${error.message}`;
        }
    }
}

async function giveItem(
    item: string,
    slug: string,
    source: string,
): Promise<Result<undefined, ExecutionError>> {
    try {
        const res = await apiClient.give_item.$post({
            json: {
                item,
                slug,
                source,
            },
        });

        if (res.ok) {
            return result.Ok(undefined);
        } else {
            const body = await res.json();
            return result.Error(OperationRejected({ message: body.error }));
        }
    } catch {
        return result.Error(NetworkFailure());
    }
}

async function removeItem(
    item: string,
    slug: string,
): Promise<Result<undefined, ExecutionError>> {
    try {
        const res = await apiClient.remove_item.$post({
            json: {
                item,
                slug,
            },
        });

        if (res.ok) {
            return result.Ok(undefined);
        } else {
            const body = await res.json();
            return result.Error(OperationRejected({ message: body.error }));
        }
    } catch {
        return result.Error(NetworkFailure());
    }
}

async function findItem(name: string): Promise<Result<GameObjectDef, ExecutionError>> {
    try {
        const res = await apiClient.find_item.$post({
            json: {
                name,
            },
        });

        if (res.ok) {
            const body = (await res.json()) as GameObjectDef;
            return result.Ok(body);
        } else {
            const body = await res.json();
            return result.Error(OperationRejected({ message: body.error }));
        }
    } catch {
        return result.Error(NetworkFailure());
    }
}

async function transferItem(
    item: string,
    oldSlug: string,
    newSlug: string,
): Promise<Result<undefined, ExecutionError>> {
    try {
        const res = await apiClient.transfer_item.$post({
            json: {
                item,
                oldSlug,
                newSlug,
            },
        });

        if (res.ok) {
            return result.Ok(undefined);
        } else {
            const body = await res.json();
            return result.Error(OperationRejected({ message: body.error }));
        }
    } catch {
        return result.Error(NetworkFailure());
    }
}

main();
