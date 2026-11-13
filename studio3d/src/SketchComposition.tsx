import React, { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { fontsReady } from "./fonts";
import { InputContext, type SketchInput } from "./input";
import { Scene } from "./scene/Scene";

export const SketchComposition: React.FC<SketchInput> = (input) => {
  const [handle] = useState(() => delayRender("Шрифты 3Д"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fontsReady.then(() => {
      setReady(true);
      continueRender(handle);
    });
  }, [handle]);
  if (!ready) return null;
  return (
    <InputContext.Provider value={input}>
      <Scene />
    </InputContext.Provider>
  );
};
