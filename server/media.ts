import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { RpcInput } from "@getpaseo/plugin";
import { mediaTypeOf, readMediaRpc } from "../shared/media";

/** Files above this travel badly as base64 over the client connection. */
const MAX_MEDIA_BYTES = 40 * 1024 * 1024;

export async function readMedia({ path }: RpcInput<typeof readMediaRpc>) {
  const mimeType = mediaTypeOf(path);
  if (!mimeType) throw new Error(`Not an image, video or audio file: ${path}`);
  const filePath = path.startsWith("file://") ? fileURLToPath(path) : path;
  const { size } = await stat(filePath);
  if (size > MAX_MEDIA_BYTES) throw new Error(`Too large to show (${size} bytes): ${path}`);
  const bytes = await readFile(filePath);
  return { base64: bytes.toString("base64"), mimeType };
}
