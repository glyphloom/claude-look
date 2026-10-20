// The parts of Paseo's page the plugin API cannot reach, patched on web and
// desktop only:
// - tool rows sit as tightly as Paseo's own, with even space to the replies around them;
// - images you attach get Claude Desktop's tiles, and the image lightbox its scrim;
// - a link to a video or audio file gets a player under it, as Claude Desktop
//   shows files it shares.
//
// This works on Paseo's markup (its test ids, data attributes and `--colors-*`
// variables), so a Paseo update can break it; the rest of the plugin does not
// depend on it.
import { Platform } from "react-native";
import { mediaTypeOf } from "../shared/media";
import { type ReadMedia, loadMediaUri } from "./media";

// This plugin typechecks without the DOM library, and plugin code reaches the
// page's globals only through `globalThis`. Declare only what this module uses.
interface DomElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): DomElement | null;
  closest(selector: string): DomElement | null;
  nextElementSibling: DomElement | null;
  style: { getPropertyValue(name: string): string; setProperty(name: string, value: string): void };
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  after(...nodes: DomElement[]): void;
  append(...nodes: DomElement[]): void;
  remove(): void;
}
interface Page {
  document: {
    head: DomElement;
    body: DomElement;
    documentElement: DomElement;
    createElement(tag: string): DomElement;
  };
  getComputedStyle(element: DomElement): { getPropertyValue(name: string): string };
  localStorage: { getItem(key: string): string | null };
  MutationObserver: new (callback: () => void) => {
    observe(target: DomElement, options: { childList: boolean; subtree: boolean }): void;
    disconnect(): void;
  };
  IntersectionObserver: new (
    callback: (entries: { isIntersecting: boolean; target: DomElement }[]) => void,
  ) => {
    observe(target: DomElement): void;
    unobserve(target: DomElement): void;
    disconnect(): void;
  };
}
const page = globalThis as unknown as Page;

/** Spread onto a plugin row's root so the page can find it. */
export function pageMark(): object {
  return { dataSet: { claudeLook: "tool" } };
}

/** Paseo's base text size: its default, or what you set in its appearance settings (read on web only). */
export function hostBaseFontSize(): number {
  const fallback = Platform.OS === "web" ? 14 : 15;
  if (Platform.OS !== "web") return fallback;
  try {
    const settings = JSON.parse(page.localStorage.getItem("@paseo:app-settings") ?? "{}");
    return typeof settings.uiBaseFontSize === "number" ? settings.uiBaseFontSize : fallback;
  } catch {
    return fallback; // Settings Paseo stored in a shape this plugin does not know.
  }
}

/** Each timeline row; its first child is a wrapper whose bottom margin is the gap below the row. */
const ROW = "[data-history-row-id]";
/** What a row holds, and what the next shown row holds; the gap table below reads both. */
const ROW_KIND = "data-claude-look-row";
const NEXT_KIND = "data-claude-look-next";
type RowKind = "sequence" | "user" | "text" | "other";
const PLAYER_MARK = "data-claude-look-player";
const SEEN_LINK_MARK = "data-claude-look-seen";
/** Paragraph-level blocks of a reply; a player goes after the block holding its link. */
const BLOCK = '[data-paseo-markdown-tag="p"], [data-paseo-markdown-tag="li"]';
const ATTACHMENT = '[data-testid="user-message"] button:has(img)';
const MARKDOWN_IMAGE = '[data-paseo-markdown-tag="img"]';
const MAX_REPLY_IMAGE_HEIGHT = 360;
const FRAME = "1px solid color-mix(in srgb, var(--colors-foreground) 12%, transparent)";

const PAGE_STYLE = `
/*
 * Gaps around tool rows. Paseo packs its own tool and thinking rows together but
 * spaces plugin rows 16px apart; these pack them, and set the gap to a reply so
 * the space above a tool row and below it look the same (a reply carries 12px
 * of its own padding below its text), and the same space before your message.
 */
[${ROW_KIND}="sequence"][${NEXT_KIND}="sequence"] > div { margin-bottom: 0 !important; }
[${ROW_KIND}="sequence"][${NEXT_KIND}="text"] > div { margin-bottom: 8px !important; }
[${ROW_KIND}="text"][${NEXT_KIND}="sequence"] > div { margin-bottom: -4px !important; }
[${ROW_KIND}="sequence"][${NEXT_KIND}="user"] > div { margin-bottom: 20px !important; }

/*
 * Media keeps one size from its first draw, since Paseo's list measures a row
 * when it scrolls in and everything below jumps if the row grows afterwards.
 */

/* Attached images as Claude Desktop's tiles: the whole image at a fixed height, taller alone. */
${ATTACHMENT} {
  border-radius: 8px !important;
  border: 0.5px solid color-mix(in srgb, var(--colors-foreground) 20%, transparent) !important;
}
${ATTACHMENT}:hover { border-color: color-mix(in srgb, var(--colors-foreground) 40%, transparent) !important; }
${ATTACHMENT} > div { width: auto !important; height: auto !important; }
${ATTACHMENT} > div > div { display: none !important; }
${ATTACHMENT} img {
  position: static !important; opacity: 1 !important; display: block !important;
  width: auto !important; height: 120px !important; max-width: 240px; object-fit: contain;
}
${ATTACHMENT}:only-child img { height: 240px !important; max-width: min(480px, 100%); }

/* Images in replies: Paseo's box at the image's shape, held to 360px tall, with a thin frame. */
${MARKDOWN_IMAGE} > button { border-radius: 5px; border: ${FRAME}; }

/* The lightbox: Claude Desktop's lighter scrim and rounded image. */
[data-testid="attachment-lightbox-backdrop"] { background-color: rgba(0, 0, 0, 0.8) !important; }
[data-testid="attachment-lightbox-image"] { border-radius: 16px; overflow: hidden; }

/* Players under links to video and audio files. */
[${PLAYER_MARK}] { display: block; margin-top: 8px; }
video[${PLAYER_MARK}] {
  width: 320px; max-width: 100%; height: auto; aspect-ratio: 16 / 9;
  object-fit: contain; border-radius: 8px; background: #000;
}
div[${PLAYER_MARK}] { display: flex; flex-direction: column; gap: 4px; width: 320px; max-width: 100%; }
div[${PLAYER_MARK}] > span { font-size: 12px; line-height: 16px; color: var(--colors-foreground-muted); }
div[${PLAYER_MARK}] > audio { width: 100%; }
`;

/** Installs the page patch and returns its cleanup. Does nothing off the web. */
export function installPagePatch(readMedia: ReadMedia): () => void {
  if (Platform.OS !== "web") return () => {};

  const style = page.document.createElement("style");
  style.textContent = PAGE_STYLE;
  page.document.head.append(style);

  // A player loads its file only once it scrolls into view.
  const visibility = new page.IntersectionObserver((entries) => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) continue;
      visibility.unobserve(target);
      const media = target.getAttribute("data-src") ?? "";
      const element = target.hasAttribute("controls") ? target : target.querySelector("audio");
      void loadMediaUri(readMedia, media).then((uri) => element?.setAttribute("src", uri));
    }
  });

  const markRows = () => {
    const rows = Array.from(page.document.body.querySelectorAll(ROW));
    const kinds = rows.map(rowKind);
    rows.forEach((row, index) => {
      const next = kinds[index + 1] ?? "other";
      setIfChanged(row, ROW_KIND, kinds[index]!);
      setIfChanged(row, NEXT_KIND, next);
    });
  };

  const addPlayers = () => {
    const links = page.document.body.querySelectorAll('[data-testid="assistant-message"] a[href]');
    for (const link of Array.from(links)) {
      if (link.hasAttribute(SEEN_LINK_MARK)) continue;
      link.setAttribute(SEEN_LINK_MARK, "");
      const player = playerFor(link.getAttribute("href") ?? "");
      if (!player) continue;
      // After the paragraph, below any players already there for its earlier links.
      let before = link.closest(BLOCK) ?? link;
      while (before.nextElementSibling?.hasAttribute(PLAYER_MARK))
        before = before.nextElementSibling;
      before.after(player);
      visibility.observe(player);
    }
  };

  // Paseo sizes a reply image's box from the image's aspect ratio; a width cap
  // keeps its height in bounds. Its ratio settles when the image loads, which
  // also removes the loading spinner, so this runs again on that change.
  const capReplyImages = () => {
    for (const box of Array.from(
      page.document.body.querySelectorAll(`${MARKDOWN_IMAGE} > button`),
    )) {
      const ratio = aspectRatio(page.getComputedStyle(box).getPropertyValue("aspect-ratio"));
      if (!ratio) continue;
      const maxWidth = `${Math.round(MAX_REPLY_IMAGE_HEIGHT * ratio)}px`;
      if (box.style.getPropertyValue("max-width") !== maxWidth)
        box.style.setProperty("max-width", maxWidth);
    }
  };

  const patch = () => {
    markRows();
    capReplyImages();
    addPlayers();
  };
  patch();
  const changes = new page.MutationObserver(patch);
  changes.observe(page.document.body, { childList: true, subtree: true });

  return () => {
    changes.disconnect();
    visibility.disconnect();
    for (const player of Array.from(page.document.body.querySelectorAll(`[${PLAYER_MARK}]`)))
      player.remove();
    for (const mark of [SEEN_LINK_MARK, ROW_KIND, NEXT_KIND]) {
      for (const element of Array.from(page.document.body.querySelectorAll(`[${mark}]`)))
        element.removeAttribute(mark);
    }
    style.remove();
  };
}

function rowKind(row: DomElement): RowKind {
  // Paseo's own tool and thinking rows, and the plugin's.
  if (row.querySelector('[data-testid="tool-call-badge"], [data-claude-look]')) return "sequence";
  if (row.querySelector('[data-testid="user-message"]')) return "user";
  if (row.querySelector('[data-testid="assistant-message"]')) return "text";
  return "other";
}

/** Width over height from a computed `aspect-ratio` ("1.6 / 1", "auto 1.6"), or null. */
function aspectRatio(value: string): number | null {
  const [width, height = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
  return width && height ? width / height : null;
}

/** Writes only real changes, so marking every row on every page change stays cheap. */
function setIfChanged(element: DomElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/**
 * A video element, or a file name over an audio element, for a link to such a
 * file. The browser draws media controls light unless told the page is dark.
 */
function playerFor(href: string): DomElement | null {
  const path = filePath(href);
  if (!path.startsWith("/") && !path.startsWith("file://")) return null;
  const mimeType = mediaTypeOf(path) ?? "";
  const scheme = `color-scheme: ${themeIsDark() ? "dark" : "light"}`;
  if (mimeType.startsWith("video/")) {
    const video = page.document.createElement("video");
    video.setAttribute("style", scheme);
    video.setAttribute(PLAYER_MARK, "video");
    video.setAttribute("controls", "");
    video.setAttribute("data-src", path);
    return video;
  }
  if (mimeType.startsWith("audio/")) {
    const box = page.document.createElement("div");
    box.setAttribute("style", scheme);
    box.setAttribute(PLAYER_MARK, "audio");
    box.setAttribute("data-src", path);
    const name = page.document.createElement("span");
    name.textContent = path.split("/").pop() ?? path;
    const audio = page.document.createElement("audio");
    audio.setAttribute("controls", "");
    box.append(name, audio);
    return box;
  }
  return null;
}

/** Whether Paseo's theme is dark: its text colour (`--colors-foreground`, a hex) is light. */
function themeIsDark(): boolean {
  const foreground = page
    .getComputedStyle(page.document.documentElement)
    .getPropertyValue("--colors-foreground")
    .trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(foreground)?.[1];
  if (!hex) return false;
  const [red, green, blue] = [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const luminance = (0.299 * red! + 0.587 * green! + 0.114 * blue!) / 255;
  return luminance > 0.5;
}

/** A link's file path; Paseo keeps file URLs as they are and the daemon decodes them. */
function filePath(href: string): string {
  if (href.startsWith("file://")) return href;
  try {
    return decodeURI(href);
  } catch {
    return href; // A stray "%" in a plain path.
  }
}
