import React from "react";
import { Video } from "@remotion/media";
import { Img, staticFile } from "remotion";
import { useInput } from "../input";
import { useAbsoluteFrame, useClipOffset } from "./time";

/** Look of the blurred copy behind a moved author: the extracted blurred frames are made with the same look. */
const BLUR_FILTER = "blur(36px) brightness(0.55) saturate(1.2)";

/**
 * The author recording at the current moment, sharp or as its dark blurred copy.
 * The final render draws it from frames extracted beforehand, so every render tab loads its own picture;
 * elsewhere (studio, draft stills) the video file plays.
 */
export const AuthorShot: React.FC<{ blurred?: boolean; muted?: boolean; style?: React.CSSProperties }> = ({ blurred, muted = true, style }) => {
  const input = useInput();
  const frame = useAbsoluteFrame();
  const offset = useClipOffset();
  const frames = input.frames;
  if (frames) {
    const n = Math.min(frames.count, Math.max(1, frame + 1));
    return <Img src={staticFile(`${blurred ? frames.blur : frames.author}/${String(n).padStart(5, "0")}.jpg`)}
      style={{ width: "100%", height: "100%", objectFit: "cover", ...style }} />;
  }
  return <Video src={staticFile(input.video)} muted={muted} trimBefore={offset || undefined} objectFit="cover"
    style={{ width: "100%", height: "100%", ...(blurred ? { filter: BLUR_FILTER } : {}), ...style }} />;
};
