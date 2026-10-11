import type { SemanticCommand } from "./semantic-commands.js";

export type SemanticCommandType = SemanticCommand["type"];

export type CommandHandler<
  TCommand extends SemanticCommand = SemanticCommand,
  TContext = unknown,
  TResult = unknown
> = (command: TCommand, context: TContext) => TResult;

export type CommandRegistryEntry<
  TCommand extends SemanticCommand = SemanticCommand,
  TContext = unknown,
  TResult = unknown
> = Readonly<{
  type: TCommand["type"];
  description?: string;
  handle: CommandHandler<TCommand, TContext, TResult>;
}>;

export type CommandRegistry<TContext = unknown, TResult = unknown> = Readonly<{
  dispatch(command: SemanticCommand, context: TContext): TResult;
  get(type: SemanticCommandType): CommandRegistryEntry<SemanticCommand, TContext, TResult> | undefined;
  has(type: SemanticCommandType): boolean;
  list(): readonly CommandRegistryEntry<SemanticCommand, TContext, TResult>[];
}>;

export function createCommandRegistry<TContext = unknown, TResult = unknown>(
  entries: readonly CommandRegistryEntry<SemanticCommand, TContext, TResult>[]
): CommandRegistry<TContext, TResult> {
  const byType = new Map<SemanticCommandType, CommandRegistryEntry<SemanticCommand, TContext, TResult>>();

  for (const entry of entries) {
    if (byType.has(entry.type)) {
      throw new Error(`Duplicate command handler registered for '${entry.type}'.`);
    }

    byType.set(entry.type, entry);
  }

  return {
    dispatch(command, context) {
      const entry = byType.get(command.type);
      if (!entry) {
        throw new Error(`No command handler registered for '${command.type}'.`);
      }

      return entry.handle(command, context);
    },
    get(type) {
      return byType.get(type);
    },
    has(type) {
      return byType.has(type);
    },
    list() {
      return Array.from(byType.values());
    }
  };
}
