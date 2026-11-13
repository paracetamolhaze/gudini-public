import React from "react";
import { Composition, registerRoot } from "remotion";
import { FPS, Main, layout } from "./Main";
import { OpusChart } from "./OpusChart";
import type { NewsPlan } from "./plan";

const Root: React.FC = () =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(Composition, {
      id: "News",
      component: Main as unknown as React.FC<Record<string, unknown>>,
      fps: FPS,
      width: 1080,
      height: 1920,
      durationInFrames: 30,
      defaultProps: { plan: { clips: {}, lines: {}, segments: [], hits: [], music: null } },
      // длина ролика — из плана: сумма кусков и короткий хвост
      calculateMetadata: ({ props }) => ({ durationInFrames: Math.max(30, layout((props as { plan: NewsPlan }).plan).total) }),
    }),
    // график «Опус 5.5» (runner/opus/chart.ts): отдельный клип, длина — frames из задания
    React.createElement(Composition, {
      id: "OpusChart",
      component: OpusChart as unknown as React.FC<Record<string, unknown>>,
      fps: FPS,
      width: 1080,
      height: 1920,
      durationInFrames: 120,
      defaultProps: { coin: "Биткоин", invested: "1 $", points: [], frames: 120 },
      calculateMetadata: ({ props }) => ({ durationInFrames: Math.max(30, Math.round(Number((props as { frames?: number }).frames) || 120)) }),
    }),
  );

registerRoot(Root);
