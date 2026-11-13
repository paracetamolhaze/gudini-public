import React from "react";
import { Act, Actor, Face, Look, Panel, Pop, Prop, Shot, Sketch } from "../kit";

// Test direction for the studio and kit checks: every allowed shot once, the owner looking at Claude the whole
// time (as directors write it), reaction icons through close, medium and wide; the director replaces this file.
export const Scene: React.FC = () => (
  <Sketch>
    <Actor id="me" at={[-2.24, 0.56]} />
    <Actor id="claude" at={[2.24, 0.56]} />
    <Panel behind="me" depth={8} height={5.5} size={2} title="BTC/USDT" lines={["64 210 ▼ −8.4%", "vol 31.2B", "1h  −1.9%"]} tone="terminal" />
    <Panel behind="claude" depth={9} height={4.2} size={2.4} title="wallet" lines={["balance: 0.00 BTC", "error: invalid token", "approve: ok"]} tone="alert" />
    <Prop kind="phone" held="me" from={0.9} to={1.6} label="BTC / +2.1%" />
    <Prop kind="coin" held="claude" variant="btc" />
    <Shot from={0} to={0.5} on="both" kind="wide" />
    <Shot from={0.5} to={1} on="me" kind="close" />
    <Shot from={1} to={1.5} on="me" kind="medium" move="push" />
    <Shot from={1.5} to={2} on="me" kind="wide" />
    <Shot from={2} to={2.5} on="me" kind="low" />
    <Shot from={2.5} to={3} on="claude" kind="close" />
    <Shot from={3} to={3.5} on="claude" kind="medium" side="right" />
    <Shot from={3.5} to={4} on="claude" kind="wide" />
    <Shot from={4} to={4.5} on="claude" kind="low" side="right" />
    <Shot from={4.5} to={5.16} on="me" kind="high" />
    <Look who="me" from={0} to={5.16} at="claude" />
    <Look who="claude" from={0} to={5.16} at="me" />
    <Act who="me" from={0.9} to={1.6} do="phone" />
    <Act who="claude" from={3.5} to={4.2} do="tilt" />
    <Face who="me" from={0.5} to={2} mood="shocked" />
    <Face who="claude" from={2.5} to={3.6} mood="smug" />
    <Face who="me" from={4} to={5.16} mood="worried" sweat />
    <Pop who="claude" at={0.02} icon="!" for={0.48} />
    <Pop who="me" at={0.55} icon="skull" for={1.9} />
    <Pop who="claude" at={2.55} icon="?!" for={1.9} />
  </Sketch>
);
