// Which steps sit between two replies (tool calls, thinking, todo updates, tool
// images), so the first of them can draw one summary line for all ("Read 3
// files, ran 2 commands") and the rest have no row at all.
//
// A transformer sees one item at a time with no agent or neighbours, so runs are
// worked out from the order Paseo feeds items in: a step joins the open run, and
// a prompt or a reply closes it. Items carry no session, so two sessions
// streaming at once can split or merge each other's runs; a step already filed
// stays in its run. When Paseo loads a session's history again it feeds it in
// order from a prompt already seen, and that pass files every step afresh. A thought has no id and grows while it streams, so it
// is known by its opening, and a growing one replaces the thought it extends.
import { useSyncExternalStore } from "react";
import type { ToolEntry } from "./describe";

export interface Run {
  id: number;
  entries: readonly ToolEntry[];
}

/** Old runs are dropped past this; a row whose run is gone draws itself alone. */
const MAX_RUNS = 1000;

const runs = new Map<number, Run>();
const runIdByStep = new Map<string, number>();
const seenPrompts = new Set<string>();
const listeners = new Set<() => void>();
let openRunId: number | null = null;
let nextRunId = 1;
let notifyQueued = false;
/** Whether a feeding pass is under way: Paseo feeds a pass in one go, so it ends at the next tick. */
let inPass = false;
/** Whether this pass re-feeds a finished turn in order, so steps are filed afresh. */
let refiling = false;

/** Files a step under its run; true when it is the run's first step, which draws the run. */
export function recordStep(entry: ToolEntry): boolean {
  notePass(false);
  const knownRunId = runIdByStep.get(entry.callId);
  if (knownRunId !== undefined && !refiling) {
    replaceIn(knownRunId, entry.callId, entry);
    openRunId = knownRunId;
    notify();
    return leads(knownRunId, entry.callId);
  }
  if (knownRunId !== undefined) removeFrom(knownRunId, entry.callId);

  const openRun = openRunId === null ? undefined : runs.get(openRunId);
  const last = openRun?.entries.at(-1);
  if (openRun && last && extendsThought(last, entry)) {
    runIdByStep.delete(last.callId);
    replaceIn(openRun.id, last.callId, entry);
  } else if (openRun) {
    runs.set(openRun.id, { id: openRun.id, entries: [...openRun.entries, entry] });
  } else {
    openRunId = nextRunId++;
    runs.set(openRunId, { id: openRunId, entries: [entry] });
    dropOldRuns();
  }
  runIdByStep.set(entry.callId, openRunId!);
  notify();
  return leads(openRunId!, entry.callId);
}

function leads(runId: number, stepId: string): boolean {
  return runs.get(runId)?.entries[0]?.callId === stepId;
}

/** A prompt ends the run before it; a prompt seen before starts a turn fed again in order. */
export function recordPrompt(key: string): void {
  notePass(seenPrompts.has(key));
  seenPrompts.add(key);
  openRunId = null;
}

/** A reply ends the run of steps before it. */
export function recordReply(): void {
  notePass(false);
  openRunId = null;
}

/** The run a step is filed under, kept current as steps arrive. */
export function useRunOf(stepId: string): Run | undefined {
  return useSyncExternalStore(subscribe, () => {
    const runId = runIdByStep.get(stepId);
    return runId === undefined ? undefined : runs.get(runId);
  });
}

function notePass(startsWithKnownPrompt: boolean): void {
  if (inPass) return;
  inPass = true;
  refiling = startsWithKnownPrompt;
  void Promise.resolve().then(() => {
    inPass = false;
    refiling = false;
  });
}

function replaceIn(runId: number, stepId: string, entry: ToolEntry): void {
  const run = runs.get(runId)!;
  const entries = run.entries.map((old) => (old.callId === stepId ? entry : old));
  runs.set(runId, { id: runId, entries });
}

function removeFrom(runId: number, stepId: string): void {
  const run = runs.get(runId)!;
  const entries = run.entries.filter((old) => old.callId !== stepId);
  if (entries.length === 0) runs.delete(runId);
  else runs.set(runId, { id: runId, entries });
  runIdByStep.delete(stepId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Transformers run while Paseo renders, so rows hear of a change a tick later
// rather than updating mid-render.
function notify(): void {
  if (notifyQueued) return;
  notifyQueued = true;
  void Promise.resolve().then(() => {
    notifyQueued = false;
    for (const listener of listeners) listener();
  });
}

function extendsThought(last: ToolEntry, entry: ToolEntry): boolean {
  if (last.category !== "thinking" || entry.category !== "thinking") return false;
  return thoughtText(entry).startsWith(thoughtText(last));
}

function thoughtText(entry: ToolEntry): string {
  return entry.detail.type === "plain_text" ? (entry.detail.text ?? "") : "";
}

function dropOldRuns(): void {
  for (const [id, run] of runs) {
    if (runs.size <= MAX_RUNS) return;
    for (const entry of run.entries) runIdByStep.delete(entry.callId);
    runs.delete(id);
  }
}
