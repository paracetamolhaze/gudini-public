import React from "react";
import { Composition } from "remotion";
import { FaceSheet } from "./FaceSheet";
import { ScreenSheet } from "./ScreenSheet";
import { SketchComposition } from "./SketchComposition";
import { sketchInputSchema, type SketchInput } from "./input";
import devInput from "./dev-input.json";

export const Root: React.FC = () => (
  <>
  <Composition
    id="FaceSheet"
    component={FaceSheet}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={1}
    defaultProps={devInput as unknown as SketchInput}
  />
  <Composition id="ScreenSheet" component={ScreenSheet} width={2400} height={3300} fps={30} durationInFrames={1} />
  <Composition
    id="Sketch3D"
    component={SketchComposition}
    schema={sketchInputSchema}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={300}
    defaultProps={devInput as unknown as SketchInput}
    calculateMetadata={({ props }) => ({
      fps: props.fps,
      durationInFrames: Math.max(1, Math.round(props.duration * props.fps)),
    })}
  />
  </>
);
