// Images a tool returned (a screenshot, an image Claude read), drawn like Claude
// Desktop: at most 360px tall with a thin border, opening a dark lightbox.
//
// Paseo files such an image as its own assistant message whose whole text is
// markdown pointing at a hashed file in its attachments folder on the daemon.
import { useEffect, useState } from "react";
import { Image, Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { readMediaRpc } from "../shared/media";
import { fileName } from "./describe";
import { loadMediaUri } from "./media";

const MAX_IMAGE_HEIGHT = 360;
const LIGHTBOX_HEIGHT_SHARE = 0.7;
const LIGHTBOX_WIDTH_SHARE = 0.75;
/** The lightbox is a dark scrim in every theme, as in Claude Desktop. */
const SCRIM = "rgba(0, 0, 0, 0.8)";
const SCRIM_FOREGROUND = "rgba(255, 255, 255, 0.7)";

const TOOL_IMAGE =
  /!\[[^\]]*\]\((file:\/\/[^)]*paseo-attachments[^)]*\/[0-9a-f]{64}\.[a-z0-9]+)\)/g;

/** The image paths of a message that holds only tool images, or null for any other message. */
export function toolImagePaths(text: string): string[] | null {
  const paths = [...text.matchAll(TOOL_IMAGE)].map((match) => match[1]!);
  if (paths.length === 0 || text.replace(TOOL_IMAGE, "").trim() !== "") return null;
  return paths;
}

export function ToolImages({ paths, theme }: { paths: readonly string[]; theme: PluginTheme }) {
  return (
    <View style={{ gap: 4, paddingVertical: 4 }}>
      {paths.map((path) => (
        <ToolImage key={path} path={path} theme={theme} />
      ))}
    </View>
  );
}

interface Size {
  width: number;
  height: number;
}

/** Images already shown, so a row scrolled back into view draws at its size at once. */
const shownImages = new Map<string, { uri: string; size: Size }>();

function ToolImage({ path, theme }: { path: string; theme: PluginTheme }) {
  const readMedia = useRpc(readMediaRpc);
  const [uri, setUri] = useState<string | null>(() => shownImages.get(path)?.uri ?? null);
  const [size, setSize] = useState<Size | null>(() => shownImages.get(path)?.size ?? null);
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (shownImages.has(path)) return;
    let current = true;
    loadMediaUri(readMedia, path)
      .then((loaded) => {
        Image.getSize(
          loaded,
          (width, height) => {
            shownImages.set(path, { uri: loaded, size: { width, height } });
            if (!current) return;
            setUri(loaded);
            setSize({ width, height });
          },
          () => current && setFailed(true),
        );
      })
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [readMedia, path]);

  if (failed) {
    return (
      <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
        Couldn't load {fileName(path)}
      </Text>
    );
  }

  // Its own size up to 360px tall; narrower screens shrink it by its ratio.
  const scale = size ? Math.min(1, MAX_IMAGE_HEIGHT / size.height) : 0;
  return (
    <View>
      {uri && size ? (
        <Pressable
          onPress={() => setLightboxOpen(true)}
          accessibilityRole="imagebutton"
          style={{ alignSelf: "flex-start", maxWidth: "100%" }}
        >
          <Image
            source={{ uri }}
            style={{
              width: size.width * scale,
              maxWidth: "100%",
              aspectRatio: size.width / size.height,
              borderRadius: 5,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          />
        </Pressable>
      ) : (
        <View
          style={{
            width: 120,
            height: 120,
            borderRadius: 6,
            backgroundColor: theme.colors.surface2,
          }}
        />
      )}
      {lightboxOpen && uri && size ? (
        <Lightbox uri={uri} size={size} onClose={() => setLightboxOpen(false)} />
      ) : null}
    </View>
  );
}

function Lightbox({ uri, size, onClose }: { uri: string; size: Size; onClose: () => void }) {
  const screen = useWindowDimensions();
  const scale = Math.min(
    1,
    (screen.height * LIGHTBOX_HEIGHT_SHARE) / size.height,
    (screen.width * LIGHTBOX_WIDTH_SHARE) / size.width,
  );
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: SCRIM, alignItems: "center", justifyContent: "center" }}
      >
        <Image
          source={{ uri }}
          style={{ width: size.width * scale, height: size.height * scale, borderRadius: 16 }}
        />
      </Pressable>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="X" size={18} color={SCRIM_FOREGROUND} />
      </Pressable>
    </Modal>
  );
}
