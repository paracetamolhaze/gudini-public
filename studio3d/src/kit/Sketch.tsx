import React from "react";
import { ThreeCanvas } from "@remotion/three";
import { Audio } from "@remotion/media";
import { AbsoluteFill, staticFile, useVideoConfig } from "remotion";
import { InputContext, useInput } from "../input";
import { Actor } from "./Actor";
import { CameraRig } from "./Camera";
import { ChannelCard } from "./Channel";
import { Pops } from "./Pop";
import { Post } from "./Post";
import { Sfx } from "./Sfx";
import { Subtitles } from "./Subtitles";
import { World } from "./World";
import { collectTimeline, TimelineContext } from "./timeline";

/**
 * The whole sketch: one 3D canvas for the entire video (shots are camera cuts, not new canvases),
 * the channel card and the subtitle layer on top, the voice under it.
 */
export const Sketch: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const input = useInput();
  const { width, height } = useVideoConfig();
  const { timeline, drawn } = collectTimeline(children, Actor);
  return (
    <AbsoluteFill style={{ backgroundColor: "#05071a" }}>
      <ThreeCanvas
        shadows
        width={width}
        height={height}
        dpr={input.dpr ?? 1}
        gl={{ antialias: input.aa ?? true, powerPreference: "high-performance" }}
        camera={{ fov: 36, near: 0.05, far: 200, position: [0, 1.6, 5] }}
      >
        <InputContext.Provider value={input}>
          <TimelineContext.Provider value={timeline}>
            <World />
            <CameraRig />
            {drawn}
            <Pops />
            {input.post ? <Post /> : null}
          </TimelineContext.Provider>
        </InputContext.Provider>
      </ThreeCanvas>
      <TimelineContext.Provider value={timeline}>
        <ChannelCard />
        <Subtitles />
        <Sfx />
      </TimelineContext.Provider>
      {input.voice ? <Audio src={staticFile(input.voice)} /> : null}
    </AbsoluteFill>
  );
};
