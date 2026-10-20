// How Claude Desktop words the steps between two replies (tool calls, thinking,
// todo updates, tool images): a row's verb and target, the sentence that sums
// up several steps in a row, and the lines of an edit's diff.
import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";

export type ToolCall = Parameters<
  PluginTimelineTransformerContribution<"tool_call">["transform"]
>[0]["item"];
export type ToolDetail = ToolCall["detail"];
type TodoItems = Extract<
  Parameters<PluginTimelineTransformerContribution<"todo">["transform"]>[0]["item"],
  { type: "todo" }
>["items"];

export type Category =
  | "read"
  | "write"
  | "edit"
  | "bash"
  | "grep"
  | "glob"
  | "web"
  | "fetch"
  | "agent"
  | "skill"
  | "other"
  | "thinking"
  | "todo"
  | "image";

/**
 * Claude Desktop's words per kind of step: the row verb in each state, and the
 * clause in a summary. Thinking and images add no clause; a run of only
 * thinking reads "Thought".
 */
const WORDING: Record<
  Category,
  { done: string; running: string; failed: string; one: string; many: string }
> = {
  read: {
    done: "Read",
    running: "Reading",
    failed: "Failed to read",
    one: "read a file",
    many: "read # files",
  },
  write: {
    done: "Wrote",
    running: "Writing",
    failed: "Failed to write",
    one: "wrote a file",
    many: "wrote # files",
  },
  edit: {
    done: "Edited",
    running: "Editing",
    failed: "Failed to edit",
    one: "edited a file",
    many: "edited # files",
  },
  bash: {
    done: "Ran",
    running: "Running",
    failed: "Failed to run",
    one: "ran a command",
    many: "ran # commands",
  },
  grep: {
    done: "Searched",
    running: "Searching",
    failed: "Failed to search",
    one: "searched code",
    many: "searched code",
  },
  glob: {
    done: "Searched",
    running: "Searching",
    failed: "Failed to search",
    one: "found files",
    many: "found files",
  },
  web: {
    done: "Searched web",
    running: "Searching web",
    failed: "Failed to search web",
    one: "browsed the web",
    many: "browsed the web",
  },
  fetch: {
    done: "Fetched",
    running: "Fetching",
    failed: "Failed to fetch",
    one: "fetched a page",
    many: "fetched # pages",
  },
  agent: {
    done: "Ran agent",
    running: "Running agent",
    failed: "Failed to run agent",
    one: "ran an agent",
    many: "ran # agents",
  },
  skill: {
    done: "Ran skill",
    running: "Running skill",
    failed: "Failed to run skill",
    one: "ran a skill",
    many: "ran # skills",
  },
  other: {
    done: "Used",
    running: "Using",
    failed: "Failed to use",
    one: "used a tool",
    many: "used # tools",
  },
  thinking: { done: "Thought", running: "Thinking", failed: "Thought", one: "", many: "" },
  todo: {
    done: "Updated todos",
    running: "Updating todos",
    failed: "Failed to update todos",
    one: "updated todos",
    many: "updated todos",
  },
  image: { done: "", running: "", failed: "", one: "", many: "" },
};

/** What a running step is doing when its target is code too long for a summary line. */
const CODE_SUBJECT: Partial<Record<Category, string>> = {
  bash: "a command",
  grep: "code",
  glob: "files",
};

/** Claude Desktop keeps this many clauses and folds the rest into "and N more actions". */
const MAX_CLAUSES = 4;

export interface DiffLine {
  sign: "+" | "-" | " " | "@";
  text: string;
}

/** One step as the plugin draws it. Plain JSON, so it can travel as timeline data. */
export interface ToolEntry {
  /** The tool call id, or for other steps a key made from their content. */
  callId: string;
  status: ToolCall["status"];
  category: Category;
  target: string;
  targetIsCode: boolean;
  /** The file a read, write or edit touched. */
  filePath: string | null;
  /** Lines of an edit or write; empty for other tools. */
  diff: DiffLine[];
  error: string | null;
  detail: ToolDetail;
  /** Image files an image step shows. */
  images: string[];
}

/** How much of a thought's opening identifies it when Paseo feeds the timeline again. */
const THOUGHT_KEY_LENGTH = 120;

export function describeToolCall(item: ToolCall): ToolEntry {
  const { detail } = item;
  const entry: ToolEntry = {
    callId: item.callId,
    status: item.status,
    category: "other",
    target: toolTitle(item.name),
    targetIsCode: false,
    filePath: null,
    diff: [],
    error: errorText(item.error),
    detail,
    images: [],
  };
  switch (detail.type) {
    case "shell":
      return { ...entry, category: "bash", target: detail.command, targetIsCode: true };
    case "read":
      return {
        ...entry,
        category: "read",
        target: fileName(detail.filePath),
        filePath: detail.filePath,
      };
    case "write":
      return {
        ...entry,
        category: "write",
        target: fileName(detail.filePath),
        filePath: detail.filePath,
        diff: lines(detail.content ?? "").map((text) => ({ sign: "+", text })),
      };
    case "edit":
      return {
        ...entry,
        category: "edit",
        target: fileName(detail.filePath),
        filePath: detail.filePath,
        diff: detail.unifiedDiff
          ? parseUnifiedDiff(detail.unifiedDiff)
          : lineDiff(detail.oldString ?? "", detail.newString ?? ""),
      };
    case "search":
      if (detail.toolName === "web_search")
        return { ...entry, category: "web", target: detail.query };
      return {
        ...entry,
        category: detail.toolName === "glob" ? "glob" : "grep",
        target: detail.query,
        targetIsCode: true,
      };
    case "fetch":
      return { ...entry, category: "fetch", target: detail.url };
    case "sub_agent":
      return {
        ...entry,
        category: "agent",
        target: detail.description ?? detail.subAgentType ?? "",
      };
    case "plain_text":
      if (item.name === "Skill")
        return { ...entry, category: "skill", target: `/${detail.label ?? ""}` };
      return { ...entry, target: detail.label ?? entry.target };
    default:
      return entry;
  }
}

export function describeThought(text: string, phase: "streaming" | "complete"): ToolEntry {
  return step(
    `thinking:${text.slice(0, THOUGHT_KEY_LENGTH)}`,
    "thinking",
    { type: "plain_text", text },
    phase,
  );
}

export function describeTodos(items: TodoItems): ToolEntry {
  const text = items.map((item) => `${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
  return step(`todo:${text}`, "todo", { type: "plain_text", text }, "complete");
}

export function describeImages(paths: string[]): ToolEntry {
  return {
    ...step(`image:${paths.join(" ")}`, "image", { type: "plain_text" }, "complete"),
    images: paths,
  };
}

function step(
  key: string,
  category: Category,
  detail: ToolDetail,
  phase: "streaming" | "complete",
): ToolEntry {
  return {
    callId: key,
    status: phase === "streaming" ? "running" : "completed",
    category,
    target: "",
    targetIsCode: false,
    filePath: null,
    diff: [],
    error: null,
    detail,
    images: [],
  };
}

/** The verb a row starts with, in its current state. */
export function rowVerb(entry: ToolEntry): string {
  const wording = WORDING[entry.category];
  if (entry.status === "running") return wording.running;
  if (entry.status === "failed") return wording.failed;
  return wording.done;
}

/** A run's summary line: what its latest running step is doing, or the summary once all have finished. */
export function runLabel(entries: readonly ToolEntry[]): string {
  const running = entries.filter((entry) => entry.status === "running").at(-1);
  if (!running) return summarize(entries);
  const object = running.targetIsCode ? (CODE_SUBJECT[running.category] ?? "") : running.target;
  return `${WORDING[running.category].running} ${object}`.trim();
}

/** "Read 3 files, ran 2 commands (1 failed)", or "Read and edited foo.ts" when every call touched one file. */
export function summarize(entries: readonly ToolEntry[]): string {
  const counted = entries.filter((entry) => WORDING[entry.category].one);
  if (counted.length === 0) return WORDING.thinking.done;
  const onlyFile = sharedFilePath(counted);
  if (onlyFile) {
    const verbs = unique(counted.map((entry) => WORDING[entry.category].done.toLowerCase()));
    return capitalize(`${joinWithAnd(verbs)} ${fileName(onlyFile)}`);
  }

  const byCategory = new Map<Category, ToolEntry[]>();
  for (const entry of counted) {
    byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry]);
  }
  const groups = [...byCategory.entries()];
  const clauses = groups.map(([category, group]) => clause(category, group));
  if (clauses.length <= MAX_CLAUSES) return capitalize(clauses.join(", "));

  const kept = MAX_CLAUSES - 1;
  const restCount = groups.slice(kept).reduce((sum, [, group]) => sum + group.length, 0);
  return capitalize([...clauses.slice(0, kept), `and ${restCount} more actions`].join(", "));
}

export function diffCounts(diff: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: diff.filter((line) => line.sign === "+").length,
    removed: diff.filter((line) => line.sign === "-").length,
  };
}

function clause(category: Category, group: readonly ToolEntry[]): string {
  const wording = WORDING[category];
  const text = group.length === 1 ? wording.one : wording.many.replace("#", String(group.length));
  const failed = group.filter((entry) => entry.status === "failed").length;
  const stopped = group.filter((entry) => entry.status === "canceled").length;
  const notes = [failed ? `${failed} failed` : "", stopped ? `${stopped} stopped` : ""].filter(
    Boolean,
  );
  return notes.length ? `${text} (${notes.join(", ")})` : text;
}

function sharedFilePath(entries: readonly ToolEntry[]): string | null {
  const first = entries[0]?.filePath;
  if (!first) return null;
  return entries.every((entry) => entry.filePath === first) ? first : null;
}

function parseUnifiedDiff(text: string): DiffLine[] {
  const diff: DiffLine[] = [];
  for (const line of text.split("\n")) {
    if (line === "" || /^(---|\+\+\+|diff |index |\\)/.test(line)) continue;
    if (line.startsWith("@@")) diff.push({ sign: "@", text: line });
    else if (line[0] === "+" || line[0] === "-" || line[0] === " ")
      diff.push({ sign: line[0], text: line.slice(1) });
  }
  return diff;
}

/** A line diff by longest common subsequence, for edits that arrive without a unified diff. */
function lineDiff(before: string, after: string): DiffLine[] {
  const old = lines(before);
  const next = lines(after);
  // common[i][j] is the longest common run of old[i..] and next[j..].
  const common = Array.from({ length: old.length + 1 }, () =>
    new Array<number>(next.length + 1).fill(0),
  );
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = next.length - 1; j >= 0; j--) {
      common[i]![j] =
        old[i] === next[j]
          ? common[i + 1]![j + 1]! + 1
          : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < old.length || j < next.length) {
    if (i < old.length && j < next.length && old[i] === next[j]) {
      diff.push({ sign: " ", text: old[i]! });
      i++;
      j++;
    } else if (j >= next.length || (i < old.length && common[i + 1]![j]! >= common[i]![j + 1]!)) {
      diff.push({ sign: "-", text: old[i]! });
      i++;
    } else {
      diff.push({ sign: "+", text: next[j]! });
      j++;
    }
  }
  return diff;
}

export function lines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

export function fileName(path: string): string {
  return path.split("/").pop() || path;
}

/** "mcp__obsidian__search_vault" reads as "search vault". */
function toolTitle(name: string): string {
  return (name.split("__").pop() ?? name).replace(/_/g, " ");
}

function errorText(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return JSON.stringify(error);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function joinWithAnd(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
