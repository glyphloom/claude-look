// Reading an image, video or audio file from the daemon machine, for clients
// that cannot open its paths themselves (a phone, or a file:// path in the app).
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** The file types the plugin shows, by extension. Anything else is never read. */
export const MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

/** The MIME type of a path or file URL the plugin shows, or undefined. */
export function mediaTypeOf(path: string): string | undefined {
  const extension = path.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPES[extension];
}

export const readMediaRpc = defineRpc({
  name: "media.read",
  input: z.object({ path: z.string() }),
  output: z.object({ base64: z.string(), mimeType: z.string() }),
});
