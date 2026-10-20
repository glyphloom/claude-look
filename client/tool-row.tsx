// The steps between two replies drawn like Claude Desktop: a tool call is a
// muted verb, the target, and a chevron that opens its card; several steps in
// a row share one summary line that opens into a card listing them.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { type DiffLine, type ToolEntry, diffCounts, lines, rowVerb, runLabel } from "./describe";
import { useRunOf } from "./runs";
import { ToolImages } from "./tool-image";
import { hostBaseFontSize, pageMark } from "./web";

const MONO = Platform.select({
  ios: "ui-monospace",
  web: "ui-monospace, SFMono-Regular, Menlo, monospace",
  default: "monospace",
});
/** Paseo forces its UI font on web except under `data-pmono`, its own mark for code. */
const MONO_SURFACE = { dataSet: { pmono: "" } } as object;
const USE_NATIVE_DRIVER = Platform.OS !== "web";

/** Claude Desktop opens a run by itself when a call in it failed and the run is this short. */
const OPEN_FAILED_RUN_UP_TO = 8;
/** Longer bodies show their start and say how much is left out. */
const MAX_BODY_LINES = 400;
const RUNNING_PULSE_MS = 800;
/** Paseo's tool rows pad their 1px-bordered label by 4px; the plugin's rows match their height. */
const PASEO_ROW_PADDING = 5;
const NATIVE_GAP_PULL = 12;
/** Claude Desktop's transcript text size, which its other sizes are relative to. */
const CLAUDE_BODY_SIZE = 14;

export const toolItemSchema = z.object({ entry: z.custom<ToolEntry>() });

/** Open and closed rows, kept by call so a row scrolled away and back stays as it was. */
const openRows = new Map<string, boolean>();

export function ToolItem({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<z.output<typeof toolItemSchema>>) {
  const { entry } = item.data;
  const run = useRunOf(entry.callId);
  const styles = stylesFor(theme);
  // Only a run's first step has a row; a row left from before its run grew draws nothing.
  if (run && run.entries[0]!.callId !== entry.callId) return null;
  return (
    <ToolRun
      entries={run?.entries ?? [entry]}
      compact={layout.compact}
      theme={theme}
      styles={styles}
    />
  );
}

interface StepProps {
  entry: ToolEntry;
  theme: PluginTheme;
  styles: Styles;
}

/**
 * A run's summary line, opening into its one step's card or a card listing its
 * steps. On a phone Paseo's list grows upward, so there it opens in a sheet, as
 * Paseo's own tool rows do.
 */
function ToolRun({
  entries,
  compact,
  theme,
  styles,
}: {
  entries: readonly ToolEntry[];
  compact: boolean;
  theme: PluginTheme;
  styles: Styles;
}) {
  const first = entries[0]!;
  const anyFailed = entries.some((entry) => entry.status === "failed");
  const allFailed = entries.every((entry) => entry.status === "failed");
  const [open, toggle] = useOpen(
    `run:${first.callId}`,
    !compact && anyFailed && entries.length <= OPEN_FAILED_RUN_UP_TO,
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const running = entries.some((entry) => entry.status === "running");
  const label = runLabel(entries);
  if (entries.length === 1 && first.category === "image") {
    return (
      <View style={styles.item} {...pageMark()}>
        <ToolImages paths={first.images} theme={theme} />
      </View>
    );
  }
  return (
    <View style={styles.item} {...pageMark()}>
      <Toggle
        open={compact ? sheetOpen : open}
        onPress={compact ? () => setSheetOpen(true) : toggle}
        running={running}
        styles={styles}
      >
        <Text style={allFailed ? styles.danger : null}>{label}</Text>
        <DiffCounts diff={entries.flatMap((entry) => entry.diff)} styles={styles} />
      </Toggle>
      {open && !compact ? <RunDetails entries={entries} theme={theme} styles={styles} /> : null}
      {compact ? (
        <Modal title={label} open={sheetOpen} onOpenChange={setSheetOpen}>
          <Modal.Content>
            <RunDetails entries={entries} theme={theme} styles={styles} />
          </Modal.Content>
        </Modal>
      ) : null}
    </View>
  );
}

/** One step's card, or a card listing a run's steps. */
function RunDetails({
  entries,
  theme,
  styles,
}: {
  entries: readonly ToolEntry[];
  theme: PluginTheme;
  styles: Styles;
}) {
  if (entries.length === 1) {
    return (
      <View style={styles.singleCard}>
        <ToolBody entry={entries[0]!} styles={styles} />
      </View>
    );
  }
  return (
    <View style={styles.runCard}>
      {entries.map((entry, index) => (
        <RunStep
          key={entry.callId}
          entry={entry}
          divided={index > 0}
          theme={theme}
          styles={styles}
        />
      ))}
    </View>
  );
}

function RunStep({ entry, divided, theme, styles }: StepProps & { divided: boolean }) {
  const [open, toggle] = useOpen(entry.callId, false);
  if (entry.category === "image") {
    return (
      <View style={[styles.runStep, divided && styles.divider]}>
        <ToolImages paths={entry.images} theme={theme} />
      </View>
    );
  }
  return (
    <View style={[styles.runStep, divided && styles.divider]}>
      <ToolRow entry={entry} open={open} onPress={toggle} styles={styles} />
      {open ? (
        <View style={styles.runStepBody}>
          <ToolBody entry={entry} styles={styles} />
        </View>
      ) : null}
    </View>
  );
}

function ToolRow({
  entry,
  open,
  onPress,
  styles,
}: {
  entry: ToolEntry;
  open: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Toggle open={open} onPress={onPress} running={entry.status === "running"} styles={styles}>
      <RowWords entry={entry} styles={styles} />
      <DiffCounts diff={entry.diff} styles={styles} />
      {entry.status === "canceled" ? <Text>{"  Stopped"}</Text> : null}
    </Toggle>
  );
}

/** "Ran" + "npm test": the verb takes the row's muted colour, the target stands out. */
function RowWords({ entry, styles }: { entry: ToolEntry; styles: Styles }) {
  return (
    <>
      <Text style={entry.status === "failed" ? styles.danger : null}>{rowVerb(entry)}</Text>
      {entry.target ? (
        <>
          {" "}
          <Text
            style={entry.targetIsCode ? styles.targetCode : styles.target}
            {...(entry.targetIsCode ? MONO_SURFACE : {})}
          >
            {entry.target}
          </Text>
        </>
      ) : null}
    </>
  );
}

function DiffCounts({ diff, styles }: { diff: readonly DiffLine[]; styles: Styles }) {
  const { added, removed } = diffCounts(diff);
  if (!added && !removed) return null;
  return (
    <>
      {"  "}
      {added ? <Text style={styles.added}>+{added}</Text> : null}
      {added && removed ? " " : null}
      {removed ? <Text style={styles.removed}>−{removed}</Text> : null}
    </>
  );
}

/** One line of muted text with a chevron after it; brighter on hover and while running. */
function Toggle({
  open,
  onPress,
  running,
  styles,
  children,
}: {
  open: boolean;
  onPress: () => void;
  running: boolean;
  styles: Styles;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const opacity = usePulse(running);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={styles.toggle}
    >
      <Animated.Text
        style={[styles.rowText, (hovered || running) && styles.rowTextBright, { opacity }]}
        numberOfLines={1}
      >
        {children}
      </Animated.Text>
      <View style={open ? styles.chevronOpen : null}>
        <Icon
          name="ChevronRight"
          size={14}
          color={hovered || open ? styles.rowTextBright.color : styles.rowText.color}
        />
      </View>
    </Pressable>
  );
}

function ToolBody({ entry, styles }: { entry: ToolEntry; styles: Styles }) {
  return (
    <View style={styles.body}>
      <DetailBody entry={entry} styles={styles} />
      {entry.error ? (
        <Text selectable style={[styles.text, styles.danger]}>
          {entry.error}
        </Text>
      ) : null}
    </View>
  );
}

function DetailBody({ entry, styles }: { entry: ToolEntry; styles: Styles }) {
  const { detail } = entry;
  switch (detail.type) {
    case "shell":
      return (
        <>
          <View style={styles.commandBox} {...MONO_SURFACE}>
            <Text selectable style={styles.code}>
              <Text style={styles.muted}>$ </Text>
              {detail.command}
            </Text>
          </View>
          {detail.output ? (
            <CodeText text={detail.output} danger={entry.status === "failed"} styles={styles} />
          ) : null}
        </>
      );
    case "read":
      return (
        <>
          <Text selectable style={styles.footnote}>
            {detail.filePath}
          </Text>
          {detail.content ? (
            <CodeCard
              lines={lines(detail.content).map((text, index) => ({
                gutter: String((detail.offset ?? 1) + index),
                text,
                tint: null,
              }))}
              styles={styles}
            />
          ) : null}
        </>
      );
    case "write":
    case "edit":
      return (
        <>
          <Text selectable style={styles.footnote}>
            {detail.filePath}
          </Text>
          <CodeCard lines={entry.diff.map(diffCodeLine)} styles={styles} />
        </>
      );
    case "search":
      if (detail.webResults?.length) {
        return (
          <View style={styles.list}>
            {detail.webResults.map((result) => (
              <Text key={result.url} selectable style={styles.text} numberOfLines={1}>
                <Text style={styles.target}>{result.title}</Text>
                {"  "}
                <Text style={styles.footnote}>{result.url}</Text>
              </Text>
            ))}
          </View>
        );
      }
      return (
        <CodeText text={detail.content ?? detail.filePaths?.join("\n") ?? ""} styles={styles} />
      );
    case "fetch":
      return <PlainText text={detail.result ?? ""} styles={styles} />;
    case "sub_agent":
      return (
        <PlainText
          text={
            detail.actions
              ?.map((action) => `${action.toolName}  ${action.summary ?? ""}`)
              .join("\n") || detail.log
          }
          styles={styles}
        />
      );
    case "plain_text":
      return <PlainText text={detail.text ?? ""} styles={styles} />;
    case "plan":
      return <PlainText text={detail.text} styles={styles} />;
    case "worktree_setup":
      return <CodeText text={detail.log} styles={styles} />;
    case "unknown":
      return (
        <>
          <Parameters input={detail.input} styles={styles} />
          {detail.output !== null && detail.output !== undefined ? (
            <CodeText text={asText(detail.output)} styles={styles} />
          ) : null}
        </>
      );
  }
}

/** A tool's input as Claude Desktop lists it: a faint `key:` and the value. */
function Parameters({ input, styles }: { input: unknown; styles: Styles }) {
  if (input === null || typeof input !== "object")
    return input ? <PlainText text={asText(input)} styles={styles} /> : null;
  return (
    <View style={styles.list}>
      {Object.entries(input).map(([key, value]) => (
        <Text key={key} selectable style={styles.text}>
          <Text style={[styles.code, styles.faint]} {...MONO_SURFACE}>
            {key}:
          </Text>{" "}
          {asText(value)}
        </Text>
      ))}
    </View>
  );
}

function PlainText({ text, styles }: { text: string; styles: Styles }) {
  if (!text) return null;
  return (
    <ScrollView style={styles.scroll} nestedScrollEnabled>
      <Text selectable style={styles.text}>
        {text}
      </Text>
    </ScrollView>
  );
}

function CodeText({
  text,
  danger = false,
  styles,
}: {
  text: string;
  danger?: boolean;
  styles: Styles;
}) {
  if (!text) return null;
  return (
    <ScrollView style={styles.scroll} nestedScrollEnabled {...MONO_SURFACE}>
      <Text selectable style={[styles.code, styles.muted, danger && styles.danger]}>
        {text}
      </Text>
    </ScrollView>
  );
}

interface CodeLine {
  gutter: string;
  text: string;
  tint: "added" | "removed" | "hunk" | null;
}

function diffCodeLine({ sign, text }: DiffLine): CodeLine {
  if (sign === "+") return { gutter: "+", text, tint: "added" };
  if (sign === "-") return { gutter: "−", text, tint: "removed" };
  if (sign === "@") return { gutter: "", text, tint: "hunk" };
  return { gutter: "", text, tint: null };
}

/** File lines in a bordered card: a gutter of line numbers or diff signs, and tinted added and removed lines. */
function CodeCard({ lines: codeLines, styles }: { lines: readonly CodeLine[]; styles: Styles }) {
  if (codeLines.length === 0) return null;
  const shown = codeLines.slice(0, MAX_BODY_LINES);
  const hidden = codeLines.length - shown.length;
  return (
    <ScrollView
      style={styles.codeCard}
      contentContainerStyle={styles.codeCardContent}
      nestedScrollEnabled
      {...MONO_SURFACE}
    >
      {shown.map((line, index) => (
        <View key={index} style={styles.codeLine}>
          {line.tint === "added" || line.tint === "removed" ? (
            <View
              style={[styles.tint, line.tint === "added" ? styles.tintAdded : styles.tintRemoved]}
            />
          ) : null}
          <Text
            style={[
              styles.code,
              styles.gutter,
              line.tint === "added" && styles.added,
              line.tint === "removed" && styles.removed,
            ]}
          >
            {line.gutter}
          </Text>
          <Text
            selectable
            style={[styles.code, styles.codeLineText, line.tint === "hunk" && styles.muted]}
          >
            {line.text || " "}
          </Text>
        </View>
      ))}
      {hidden > 0 ? (
        <Text style={[styles.footnote, styles.hiddenLines]}>{hidden} more lines</Text>
      ) : null}
    </ScrollView>
  );
}

function useOpen(key: string, initial: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(() => openRows.get(key) ?? initial);
  const toggle = () => {
    openRows.set(key, !open);
    setOpen(!open);
  };
  return [open, toggle];
}

/** Claude Desktop's running rows shimmer; this fades the row in and out instead. */
function usePulse(active: boolean): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      opacity.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: RUNNING_PULSE_MS,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: RUNNING_PULSE_MS,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [active, opacity]);
  return opacity;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

type Styles = ReturnType<typeof createStyles>;
const stylesByTheme = new WeakMap<PluginTheme, Styles>();

function stylesFor(theme: PluginTheme): Styles {
  const cached = stylesByTheme.get(theme);
  if (cached) return cached;
  const styles = createStyles(theme);
  stylesByTheme.set(theme, styles);
  return styles;
}

// Sizes follow Claude Desktop's transcript (14/20 body, 12/17 code, 8px radii),
// scaled to the text size Paseo is set to. A row's words are all one size, and
// a row is as tall as Paseo's own tool and thinking rows so they sit evenly.
function createStyles({ colors }: PluginTheme) {
  const scale = hostBaseFontSize() / CLAUDE_BODY_SIZE;
  const size = (px: number) => Math.round(px * scale);
  const code = { fontFamily: MONO, fontSize: size(12), lineHeight: size(17) } as const;
  return StyleSheet.create({
    // Paseo's phone app keeps 16px around a plugin row and a reply's own 12px
    // padding below it; pulling the row up evens the space above and below.
    // On the web the page patch sets these gaps instead.
    item: Platform.OS === "web" ? {} : { marginTop: -NATIVE_GAP_PULL },
    toggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      alignSelf: "flex-start",
      maxWidth: "100%",
      paddingVertical: PASEO_ROW_PADDING,
    },
    rowText: {
      flexShrink: 1,
      fontSize: size(14),
      lineHeight: size(17),
      color: colors.foregroundMuted,
    },
    rowTextBright: { color: colors.foreground },
    chevronOpen: { transform: [{ rotate: "90deg" }] },
    target: { color: colors.foreground },
    targetCode: { fontFamily: MONO, color: colors.foreground },
    danger: { color: colors.statusDanger },
    added: { color: colors.statusSuccess, fontVariant: ["tabular-nums"] },
    removed: { color: colors.statusDanger, fontVariant: ["tabular-nums"] },
    singleCard: {
      marginTop: 4,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
    },
    runCard: {
      marginTop: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      overflow: "hidden",
    },
    runStep: { paddingHorizontal: 10, paddingVertical: 8 - PASEO_ROW_PADDING },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    runStepBody: { paddingTop: 4 },
    body: { gap: 8 },
    list: { gap: 4 },
    text: { fontSize: size(14), lineHeight: size(20), color: colors.foregroundMuted },
    footnote: { fontSize: size(12), lineHeight: size(16), color: colors.foregroundMuted },
    code: { ...code, color: colors.foreground },
    muted: { color: colors.foregroundMuted },
    faint: { opacity: 0.7 },
    commandBox: {
      backgroundColor: colors.surface2,
      borderRadius: 8,
      paddingVertical: 4,
      paddingHorizontal: 8,
    },
    scroll: { maxHeight: 400 },
    codeCard: { maxHeight: 400, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    codeCardContent: { paddingVertical: 4 },
    codeLine: { flexDirection: "row", paddingRight: 8 },
    gutter: { width: 40, paddingRight: 10, textAlign: "right", color: colors.foregroundMuted },
    codeLineText: { flexShrink: 1 },
    tint: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0.15 },
    tintAdded: { backgroundColor: colors.statusSuccess },
    tintRemoved: { backgroundColor: colors.statusDanger },
    hiddenLines: { paddingHorizontal: 10, paddingTop: 4 },
  });
}
