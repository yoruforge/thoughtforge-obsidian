import type { SemanticCommandType } from "./command-registry.js";

export type ClassicKeymapPlatform = "mac" | "windows" | "linux";

export type ClassicKeymapContext = Readonly<{
  platform?: ClassicKeymapPlatform;
  editingText?: boolean;
  hasSelection?: boolean;
  canIndent?: boolean;
  canOutdent?: boolean;
  canDelete?: boolean;
}>;

export type ClassicKeyBinding = Readonly<{
  key: string;
  commandType: SemanticCommandType;
  when?: (context: ClassicKeymapContext) => boolean;
}>;

const classicKeyBindings: readonly ClassicKeyBinding[] = [
  {
    key: "Enter",
    commandType: "node.insertSibling",
    when: (context) => !context.editingText && context.hasSelection !== false
  },
  {
    key: "Mod+Enter",
    commandType: "node.insertChild",
    when: (context) => !context.editingText && context.hasSelection !== false
  },
  {
    key: "Shift+Enter",
    commandType: "node.insertSibling",
    when: (context) => !context.editingText && context.hasSelection !== false
  },
  {
    key: "Tab",
    commandType: "node.insertChild",
    when: (context) => !context.editingText && context.hasSelection !== false
  },
  {
    key: "Mod+ArrowRight",
    commandType: "node.indent",
    when: (context) => !context.editingText && context.canIndent !== false
  },
  {
    key: "Shift+Tab",
    commandType: "node.outdent",
    when: (context) => !context.editingText && context.canOutdent !== false
  },
  {
    key: "Mod+ArrowUp",
    commandType: "node.move",
    when: (context) => !context.editingText && context.hasSelection !== false
  },
  {
    key: "Mod+ArrowDown",
    commandType: "node.move",
    when: (context) => !context.editingText && context.hasSelection !== false
  },
  {
    key: "Mod+ArrowLeft",
    commandType: "node.outdent",
    when: (context) => !context.editingText && context.canOutdent !== false
  },
  {
    key: "F2",
    commandType: "node.rename",
    when: (context) => !context.editingText && context.hasSelection !== false
  },
  {
    key: "Delete",
    commandType: "node.delete",
    when: (context) => !context.editingText && context.canDelete !== false
  },
  {
    key: "Backspace",
    commandType: "node.delete",
    when: (context) => !context.editingText && context.canDelete !== false
  }
];

const namedKeyAliases = new Map<string, string>([
  ["tab", "Tab"],
  ["delete", "Delete"],
  ["del", "Delete"],
  ["backspace", "Backspace"],
  ["bs", "Backspace"],
  ["return", "Enter"],
  ["enter", "Enter"],
  ["arrowup", "ArrowUp"],
  ["up", "ArrowUp"],
  ["arrowdown", "ArrowDown"],
  ["down", "ArrowDown"],
  ["arrowleft", "ArrowLeft"],
  ["left", "ArrowLeft"],
  ["arrowright", "ArrowRight"],
  ["right", "ArrowRight"]
]);

export function getClassicKeymap(): readonly ClassicKeyBinding[] {
  return classicKeyBindings;
}

export function resolveClassicKeyBinding(
  key: string,
  context: ClassicKeymapContext = {}
): SemanticCommandType | undefined {
  const normalizedKey = normalizeKeyGesture(key, context.platform);

  for (const binding of classicKeyBindings) {
    if (binding.key === normalizedKey && (!binding.when || binding.when(context))) {
      return binding.commandType;
    }
  }

  return undefined;
}

export function normalizeKeyGesture(
  key: string,
  platform: ClassicKeymapPlatform = "mac"
): string {
  const parts = key
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  const normalizedParts = parts.map((part) => normalizeKeyPart(part, platform));
  const modifiers = normalizedParts.filter(isModifier);
  const mainKey = normalizedParts.find((part) => !isModifier(part));

  return [...sortModifiers(modifiers), mainKey].filter(Boolean).join("+");
}

function normalizeKeyPart(part: string, platform: ClassicKeymapPlatform): string {
  const lower = part.toLowerCase();

  if (lower === "cmd" || lower === "command" || lower === "meta") {
    return platform === "mac" ? "Mod" : "Meta";
  }

  if (lower === "ctrl" || lower === "control") {
    return platform === "mac" ? "Control" : "Mod";
  }

  if (lower === "mod" || lower === "primary") {
    return "Mod";
  }

  if (lower === "shift") {
    return "Shift";
  }

  if (lower === "alt" || lower === "option") {
    return "Alt";
  }

  const namedKey = namedKeyAliases.get(lower);
  if (namedKey) {
    return namedKey;
  }

  if (/^f\d+$/i.test(part)) {
    return part.toUpperCase();
  }

  return part.length === 1 ? part.toUpperCase() : part;
}

function isModifier(part: string | undefined): part is "Mod" | "Meta" | "Control" | "Shift" | "Alt" {
  return part === "Mod" || part === "Meta" || part === "Control" || part === "Shift" || part === "Alt";
}

function sortModifiers(modifiers: readonly string[]): string[] {
  const order = ["Mod", "Meta", "Control", "Shift", "Alt"];
  return [...new Set(modifiers)].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}
