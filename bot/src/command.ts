import { z } from "zod";
import * as result from "./result";
import type { Result } from "./result";

// export enum OptionType {
//     String,
//     Integer,
//     Boolean,
//     User
// }

//TODO: need to make the optionspec itself a tagged union over the option type
export type OptionSpec = {
    name: string;
    description: string;
    required: boolean;
};

function OptionSpec(fields: OptionSpec): OptionSpec {
    return fields;
}

export type GiveItemOptions = {
    item: string;
    slug: string;
    source: string;
};

export type GiveItemCommand = {
    name: string;
    description: string;
    isAdmin: boolean;
    options: OptionSpec[];
    optionsSchema: z.ZodSchema<GiveItemOptions, z.ZodTypeDef, unknown>;
};

function GiveItemCommand(command: GiveItemCommand): GiveItemCommand {
    return command;
}

export type RemoveItemOptions = {
    item: string;
    slug: string;
};

export type RemoveItemCommand = {
    name: string;
    description: string;
    isAdmin: boolean;
    options: OptionSpec[];
    optionsSchema: z.ZodSchema<RemoveItemOptions, z.ZodTypeDef, unknown>;
};

export type FindItemOptions = {
    name: string;
};

export type FindItemCommand = {
    name: string;
    description: string;
    isAdmin: boolean;
    options: OptionSpec[];
    optionsSchema: z.ZodSchema<FindItemOptions, z.ZodTypeDef, unknown>;
};

export type TransferItemOptions = {
    item: string;
    oldSlug: string;
    newSlug: string;
};

export type TransferItemCommand = {
    name: string;
    description: string;
    isAdmin: boolean;
    options: OptionSpec[];
    optionsSchema: z.ZodSchema<TransferItemOptions, z.ZodTypeDef, unknown>;
};

type Command =
    | {
          kind: "GiveItem";
          value: GiveItemCommand;
      }
    | {
          kind: "RemoveItem";
          value: RemoveItemCommand;
      }
    | {
          kind: "FindItem";
          value: FindItemCommand;
      }
    | {
          kind: "TransferItem";
          value: TransferItemCommand;
      };

const giveItemOptionsSchema = z.object({
    item: z.string(),
    slug: z.string(),
    source: z.string(),
});

const removeItemOptionsSchema = z.object({
    item: z.string(),
    slug: z.string(),
});

const findItemOptionsSchema = z.object({
    name: z.string(),
});

const transferItemOptionsSchema = z
    .object({
        item: z.string(),
        "old-slug": z.string(),
        "new-slug": z.string(),
    })
    .transform((options) => ({
        item: options.item,
        oldSlug: options["old-slug"],
        newSlug: options["new-slug"],
    }));

//TODO: unnecessary, can just export flat objects directly like `export const giveItem: GiveItemCommand = ...`
export type Commands = {
    giveItem: GiveItemCommand;
    removeItem: RemoveItemCommand;
    findItem: FindItemCommand;
    transferItem: TransferItemCommand;
};

export const commands: Commands = {
    giveItem: {
        name: "give-item",
        description: "Give an item to a player",
        isAdmin: true,
        options: [
            { name: "item", description: "The item", required: true },
            { name: "slug", description: "The slug", required: true },
            { name: "source", description: "The source", required: true },
        ],
        optionsSchema: giveItemOptionsSchema,
    },
    removeItem: {
        name: "remove-item",
        description: "Remove an item from a player",
        isAdmin: true,
        options: [
            { name: "item", description: "The item", required: true },
            { name: "slug", description: "The slug", required: true },
        ],
        optionsSchema: removeItemOptionsSchema,
    },
    findItem: {
        name: "find-item",
        description: "Find an item's definition with its display name",
        isAdmin: false,
        options: [{ name: "name", description: "The name", required: true }],
        optionsSchema: findItemOptionsSchema,
    },
    transferItem: {
        name: "transfer-item",
        description: "Transfer an item from an old user to a new user",
        isAdmin: true,
        options: [
            { name: "item", description: "The item", required: true },
            { name: "old-slug", description: "The old user", required: true },
            { name: "new-slug", description: "The new user", required: true },
        ],
        optionsSchema: transferItemOptionsSchema,
    },
};

export function fromName(name: string): Result<Command, undefined> {
    switch (name) {
        case "give-item":
            return result.Ok({ kind: "GiveItem", value: commands.giveItem });
        case "remove-item":
            return result.Ok({ kind: "RemoveItem", value: commands.removeItem });
        case "find-item":
            return result.Ok({ kind: "FindItem", value: commands.findItem });
        case "transfer-item":
            return result.Ok({ kind: "TransferItem", value: commands.transferItem });
        default:
            return result.Error(undefined);
    }
}
