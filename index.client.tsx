import type { PluginTimelineData } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { readMediaRpc } from "./shared/media";
import {
  type ToolEntry,
  describeImages,
  describeThought,
  describeTodos,
  describeToolCall,
} from "./client/describe";
import { inCurrentTurn, recordPrompt, recordReply, recordStep } from "./client/runs";
import { toolImagePaths } from "./client/tool-image";
import { ToolItem, toolItemSchema } from "./client/tool-row";
import { installPagePatch } from "./client/web";

/** Calls Paseo draws in its own special way; replacing them would lose that. */
const NATIVE_TOOLS = new Set(["speak", "exitplanmode", "plan_approval"]);
/** Claude Code's word that a background task ended; Claude Desktop keeps these out of the transcript. */
const TASK_NOTIFICATION = "task_notification";

/** Files a step under its run; a run's first step draws the run, the others have no row. */
function stepItem(entry: ToolEntry) {
  if (!recordStep(entry)) return { items: [] };
  // The entry is JSON from the timeline, but its types allow `unknown` tool input.
  const data = { entry } as unknown as PluginTimelineData;
  return { items: [{ type: "plugin" as const, kind: "tool", version: 1, data }] };
}

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addTimelineTransformer({
      id: "tool-call",
      query: { itemType: "tool_call" },
      transform({ item }) {
        if (item.name === TASK_NOTIFICATION) return { items: [] };
        if (item.detail.type === "plan" || NATIVE_TOOLS.has(item.name.toLowerCase()))
          return undefined;
        return stepItem(describeToolCall(item));
      },
    }),
    client.addTimelineTransformer({
      id: "thinking",
      query: { itemType: "reasoning" },
      transform({ item, phase }) {
        if (!item.text.trim()) return { items: [] };
        return stepItem(inCurrentTurn(describeThought(item.text, phase)));
      },
    }),
    client.addTimelineTransformer({
      id: "todo",
      query: { itemType: "todo" },
      transform({ item }) {
        return stepItem(inCurrentTurn(describeTodos(item.items)));
      },
    }),
    // A tool's image arrives as its own message and joins the run; any other
    // reply ends the run and is left to Paseo.
    client.addTimelineTransformer({
      id: "tool-image",
      query: { itemType: "assistant_message" },
      transform({ item }) {
        const paths = toolImagePaths(item.text);
        if (paths) return stepItem(inCurrentTurn(describeImages(paths)));
        // Paseo draws nothing for an empty reply, so it splits no run.
        if (item.text.trim()) recordReply();
        return undefined;
      },
    }),
    client.addTimelineTransformer({
      id: "prompt",
      query: { itemType: "user_message" },
      transform({ item }) {
        recordPrompt(item.messageId ?? item.clientMessageId ?? item.text);
        return undefined;
      },
    }),
    client.addTimelineRenderer({
      kind: "tool",
      version: 1,
      schema: toolItemSchema,
      Component: ToolItem,
    }),
    installPagePatch((input) => client.rpc(readMediaRpc, input)),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
