import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readMedia } from "./server/media";
import { readMediaRpc } from "./shared/media";

export default function contribute(server: PluginServerContext) {
  server.handle(readMediaRpc, readMedia);
  return () => {};
}
