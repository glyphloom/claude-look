// Media files from the daemon machine as data URIs, shared by the tool image
// rows and the page's video and audio players.
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { readMediaRpc } from "../shared/media";

export type ReadMedia = (
  input: RpcInput<typeof readMediaRpc>,
) => Promise<RpcOutput<typeof readMediaRpc>>;

/** Recently shown files stay loaded so scrolling back does not fetch them again. */
const MAX_CACHED_FILES = 20;

const uris = new Map<string, Promise<string>>();

export function loadMediaUri(read: ReadMedia, path: string): Promise<string> {
  const cached = uris.get(path);
  if (cached) return cached;
  const uri = read({ path }).then(({ base64, mimeType }) => `data:${mimeType};base64,${base64}`);
  uris.set(path, uri);
  uri.catch(() => uris.delete(path));
  for (const oldest of uris.keys()) {
    if (uris.size <= MAX_CACHED_FILES) break;
    uris.delete(oldest);
  }
  return uri;
}
