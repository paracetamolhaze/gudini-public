import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { frameShot, shotPicture as kitPicture, type Framing } from "../src/kit/Camera";
import { gestureLift, placePop } from "../src/kit/Pop";
import { popInk } from "../src/kit/textures";
import { KEY_TRAVEL, restSink } from "../src/kit/ground";
import {
  actorPlace,
  actorRestYaw,
  actorYaw,
  STEP_RANGE,
  type ActProps,
  type LookProps,
  type MoveProps,
  type ShotKind,
  type ShotProps,
  type Timeline,
} from "../src/kit/timeline";
import { MONITORS, SCREEN_DEPTH, type MonitorPlace } from "../src/kit/layout";
import { ACTOR_PLACES, analyzeScene, shotPicture, SOLO_SIDES, STEP_X } from "./validate";

// The owner (2026-10-22) on the trade video: «ракурсы, когда просто боком показывает, лица не видно», «сзади только
// стена розовая, нужен красивый фон», «череп на голове плохо вставлен». These tests measure every shot the director
// may ask for with the kit's own camera, against the permanent room (scene-layout.json, RoomSet.tsx).

const CAST = { me: { kind: "human" as const }, claude: { kind: "blocky" as const } };
const ASPECT = 1080 / 1920;
const HEAD_TURN = 1; // Human.tsx turns the head at most 1 rad past the body toward a Look target
type Places = Record<string, [number, number]>;

const timeline = (looks: LookProps[] = [], shots: ShotProps[] = [], more: { places?: Places; acts?: ActProps[]; moves?: MoveProps[] } = {}): Timeline => {
  const places = more.places ?? ACTOR_PLACES;
  return {
    shots, acts: more.acts ?? [], faces: [], looks, moves: more.moves ?? [], lights: [], pops: [], channels: [], screens: [], held: [],
    actors: [{ id: "me", at: places.me }, { id: "claude", at: places.claude }],
  };
};
/** As directors write it: the owner looks at Claude the whole video (Claude's block ignores an id look). */
const LOOKS: Record<string, LookProps[]> = {
  rest: [],
  partner: [{ who: "me", from: 0, to: 99, at: "claude" }, { who: "claude", from: 0, to: 99, at: "me" }],
  away: [{ who: "me", from: 0, to: 99, at: "away" }, { who: "claude", from: 0, to: 99, at: "away" }],
};

/** Yaw the face points at: the body's rest turn plus the head turn of an active Look (Human.tsx, Blocky.tsx). */
const faceYaw = (tl: Timeline, id: string, t: number) => {
  const body = actorRestYaw(tl, id, t);
  const look = tl.looks.find((l) => l.who === id && t >= l.from && t <= l.to);
  if (!look) return body;
  if (CAST[id as keyof typeof CAST].kind === "blocky") return look.at === "away" ? body + 0.65 * (body > 0 ? -1 : 1) : body;
  if (look.at === "away") return body - 0.7;
  if (!tl.actors.some((a) => a.id === look.at)) return body;
  const [x, z] = actorPlace(tl, id, t);
  const [ox, oz] = actorPlace(tl, look.at, t);
  const rel = Math.atan2(ox - x, oz - z) - body;
  return body + Math.max(-HEAD_TURN, Math.min(HEAD_TURN, rel));
};
const deg = (r: number) => (Math.abs(Math.atan2(Math.sin(r), Math.cos(r))) * 180) / Math.PI;
/** How far from the camera the hero's face turns in this frame, degrees. */
const faceOff = (tl: Timeline, f: Framing, id: string, t: number) => {
  const [x, z] = actorPlace(tl, id, t);
  return deg(Math.atan2(f.eye[0] - x, f.eye[2] - z) - faceYaw(tl, id, t));
};

// ---- the room as rays see it
type Hit = { t: number; cls: string };
const rect = (o: THREE.Vector3, d: THREE.Vector3, c: [number, number, number], yaw: number, w: number, h: number, cls: string): Hit | null => {
  const n = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const centre = new THREE.Vector3(...c);
  const denom = d.dot(n);
  if (Math.abs(denom) < 1e-9) return null;
  const t = centre.clone().sub(o).dot(n) / denom;
  if (t <= 0) return null;
  const p = o.clone().addScaledVector(d, t).sub(centre);
  return Math.abs(p.dot(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)))) <= w / 2 && Math.abs(p.y) <= h / 2 ? { t, cls } : null;
};
const box = (o: THREE.Vector3, d: THREE.Vector3, min: number[], max: number[], cls: string): Hit | null => {
  let t0 = 0;
  let t1 = Infinity;
  const oo = [o.x, o.y, o.z];
  const dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-12) {
      if (oo[i] < min[i] || oo[i] > max[i]) return null;
      continue;
    }
    const a = (min[i] - oo[i]) / dd[i];
    const b = (max[i] - oo[i]) / dd[i];
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
    if (t0 > t1) return null;
  }
  return { t: t0, cls };
};
/** What a ray from the camera meets first: a hero, a screen of the room, the desk, a bare wall or the open void. */
const meet = (o: THREE.Vector3, d: THREE.Vector3, places: Places): string => {
  const [mx, mz] = places.me;
  const [cx, cz] = places.claude;
  const hits: (Hit | null)[] = [
    box(o, d, [mx - 0.4, 0, mz - 0.4], [mx + 0.4, 2.05, mz + 0.4], "hero"),
    box(o, d, [cx - 0.55, 0, cz - 0.4], [cx + 0.55, 0.9, cz + 0.4], "hero"),
    // the screens' planes sit in front of the monitor bodies, turned like RoomSet.tsx turns them (layout.ts)
    ...Object.values(MONITORS).map((m: MonitorPlace) => rect(o, d, [m.centre[0] + SCREEN_DEPTH * Math.sin(m.yaw), m.centre[1], m.centre[2] + SCREEN_DEPTH * Math.cos(m.yaw)], m.yaw, m.width + 0.6, m.height + 0.6, "screen")),
    // the lit bookcase in the corner (RoomDecor.tsx) dresses the wall behind the owner's screen
    box(o, d, [-44.9, -42, -35], [-39.9, 24.6, -24.2], "decor"),
    box(o, d, [19.4, -0.75, -21.75], [30.6, 21.55, -6.25], "screen"),
    box(o, d, [-9, -1.1, -3.9], [9, 0, 3.9], "desk"),
    box(o, d, [-33, -2.75, -25.5], [33, -1.1, 13.5], "desk"),
  ];
  const back = rect(o, d, [0, 31.5, -35], 0, 91, 147, "wall");
  if (back) {
    const p = o.clone().addScaledVector(d, back.t);
    // the wooden blinds dress the back wall; only its plaster beside them is bare
    if (p.x >= -42 && p.x <= 14 && p.y >= 4.8 && p.y <= 63.2) back.cls = "blinds";
    if (p.x >= -45) hits.push(back);
  }
  const left = rect(o, d, [-45, 31.5, 10], Math.PI / 2, 90, 147, "wall");
  if (left && o.clone().addScaledVector(d, left.t).z >= -35) hits.push(left);
  const first = hits.filter((h): h is Hit => !!h).sort((a, b) => a.t - b.t)[0];
  return first?.cls ?? "void";
};

const camera = (f: Framing) => {
  const cam = new THREE.PerspectiveCamera(f.fov, ASPECT, 0.05, 800);
  cam.position.set(...f.eye);
  cam.lookAt(...f.aim);
  cam.updateMatrixWorld();
  return cam;
};

/** Shares of the background (everything but the heroes) by what it is, over a 36 × 64 grid of the frame. */
const background = (f: Framing, places: Places = ACTOR_PLACES) => {
  const cam = camera(f);
  const counts: Record<string, number> = {};
  for (let i = 0; i < 36; i++)
    for (let j = 0; j < 64; j++) {
      const d = new THREE.Vector3(((i + 0.5) / 36) * 2 - 1, ((j + 0.5) / 64) * 2 - 1, 0.5).unproject(cam).sub(cam.position).normalize();
      const c = meet(cam.position.clone(), d, places);
      counts[c] = (counts[c] ?? 0) + 1;
    }
  const bg = 36 * 64 - (counts.hero ?? 0);
  const share = (k: string) => (counts[k] ?? 0) / bg;
  return { screen: share("screen"), bare: share("wall") + share("void"), desk: share("desk") };
};
// The monitors hang on an arm (2026-10-23) and a shot sees them as monitors, bezels and the arm round the screen:
// a screen is a third of the background or more, the rest the desk, the blinds and the bookcase, never the bare wall.
const backdropOk = (kind: ShotKind, bg: ReturnType<typeof background>) => (kind === "high" ? bg.desk >= 0.9 : bg.screen >= 0.3 && bg.bare <= 0.25);
const bgLabel = (bg: ReturnType<typeof background>) => `экраны ${(bg.screen * 100).toFixed(0)}%, голая стена и пустота ${(bg.bare * 100).toFixed(0)}%`;

const KINDS: ShotKind[] = ["close", "medium", "wide", "low", "high"];
const MOVES = ["still", "push", "pull", "orbit", "rise", "whip", "shake"] as const;
/** Every single shot the validator lets through: each hero, each of his sides, each kind and move. */
const allowedSolo = () =>
  Object.entries(SOLO_SIDES).flatMap(([on, sides]) =>
    [undefined, ...sides].flatMap((side) => KINDS.flatMap((kind) => MOVES.map((move) => ({ on, kind, side: side as ShotProps["side"], move })))),
  );

test("every allowed single shot shows the hero's face, not a profile or the back of the head", () => {
  for (const [name, looks] of Object.entries(LOOKS)) {
    for (const s of allowedSolo()) {
      const shot: ShotProps = { from: 0, to: 2, ...s };
      const tl = timeline(looks, [shot]);
      // both ends of the shot: an orbit swings, a whip snaps, a push travels
      for (const t of [0, 1, 1.99]) {
        const off = faceOff(tl, frameShot(shot, tl, CAST, t), s.on, t);
        assert.ok(off <= 46, `${s.on} ${s.kind} ${s.side ?? "-"} ${s.move} (${name}, ${t} s): лицо повёрнуто на ${off.toFixed(0)}° от камеры`);
      }
    }
  }
});

test("behind every allowed single shot stands a screen of the room, never the bare wall or the void", () => {
  for (const s of allowedSolo().filter((x) => x.move === "still" || x.move === "orbit")) {
    const shot: ShotProps = { from: 0, to: 2, ...s };
    const tl = timeline(LOOKS.partner, [shot]);
    for (const t of [0, 1.99]) {
      const bg = background(frameShot(shot, tl, CAST, t));
      assert.ok(backdropOk(s.kind, bg), `${s.on} ${s.kind} ${s.side ?? "-"} ${s.move} ${t} s: ${bgLabel(bg)}`);
    }
  }
});

test("a hero stepping anywhere along his row keeps his face and the screens behind him in every shot", () => {
  // the corners of STEP_RANGE for both heroes, at once: the partner's step turns the hero too
  for (const mx of [STEP_RANGE.left[0], ACTOR_PLACES.me[0], STEP_RANGE.left[1]]) {
    for (const cx of [STEP_RANGE.right[0], ACTOR_PLACES.claude[0], STEP_RANGE.right[1]]) {
      const places: Places = { me: [mx, ACTOR_PLACES.me[1]], claude: [cx, ACTOR_PLACES.claude[1]] };
      for (const s of allowedSolo().filter((x) => x.move === "still" || x.move === "orbit")) {
        const shot: ShotProps = { from: 0, to: 2, ...s };
        for (const [name, looks] of Object.entries(LOOKS)) {
          const tl = timeline(looks, [shot], { places });
          for (const t of [0, 1.99]) {
            const f = frameShot(shot, tl, CAST, t);
            const off = faceOff(tl, f, s.on, t);
            const label = `me x=${mx}, claude x=${cx}: ${s.on} ${s.kind} ${s.side ?? "-"} ${s.move} ${t} с (${name})`;
            assert.ok(off <= 46, `${label}: лицо повёрнуто на ${off.toFixed(0)}°`);
            if (name === "partner") {
              const bg = background(f, places);
              assert.ok(backdropOk(s.kind, bg), `${label}: ${bgLabel(bg)}`);
            }
          }
        }
      }
    }
  }
});

test("old scenes keep the heroes on their rows: a step off the row or a turn in degrees is drawn the allowed way", () => {
  // the reviewer's cases: forward on z shows the owner at 54° against the bare wall, facing={12} at 57-59°
  const moves: MoveProps[] = [
    { who: "me", from: 0, to: 0.5, place: [-2.24, 2.5] },
    { who: "claude", from: 0, to: 0.5, place: [-1, -2] },
  ];
  const tl = timeline(LOOKS.partner, [], { moves });
  assert.deepEqual(actorPlace(tl, "me", 1), [-2.24, 0.56]);
  assert.deepEqual(actorPlace(tl, "claude", 1), [1, 0.56]);
  assert.deepEqual(actorPlace(timeline([], [], { moves: [{ who: "me", from: 0, to: 0.5, place: [-9, 0] }] }), "me", 1), [-3, 0.56]);
  const turned: Timeline = { ...timeline(LOOKS.partner), actors: [{ id: "me", at: ACTOR_PLACES.me, facing: 12 }, { id: "claude", at: ACTOR_PLACES.claude, facing: -12 }] };
  for (const id of ["me", "claude"]) assert.equal(actorRestYaw(turned, id, 1), actorRestYaw(timeline(LOOKS.partner), id, 1));
  // the validator teaches the same row the kit keeps
  assert.deepEqual(STEP_X.me, [...STEP_RANGE.left]);
  assert.deepEqual(STEP_X.claude, [...STEP_RANGE.right]);
});

test("old scenes keep re-rendering well: the kit draws refused sides and over-the-shoulder like the allowed shots", () => {
  // a dub re-renders the scene as it was written (the trade video had side="front", side="left" and kind="over")
  for (const on of ["me", "claude"]) {
    for (const shot of [
      { on, kind: "close", side: "front" },
      { on, kind: "close", side: "left" },
      { on, kind: "over" },
      ...(on === "me" ? [{ on, kind: "medium", side: "right" }] : []),
    ] as Omit<ShotProps, "from" | "to">[]) {
      const full: ShotProps = { from: 0, to: 2, ...shot };
      const tl = timeline(LOOKS.partner, [full]);
      const f = frameShot(full, tl, CAST, 1);
      const off = faceOff(tl, f, on, 1);
      const bg = background(f);
      assert.ok(off <= 46 && bg.screen >= 0.4 && bg.bare <= 0.25, `${on} ${shot.kind} ${shot.side ?? "-"}: лицо ${off.toFixed(0)}°, экраны ${(bg.screen * 100).toFixed(0)}%`);
    }
  }
});

test("a two-shot is taken from the front whatever side it names", () => {
  const tl = timeline();
  for (const kind of ["wide", "low", "high"] as ShotKind[]) {
    const front = frameShot({ from: 0, to: 2, on: "both", kind }, tl, CAST, 1);
    for (const side of ["left", "right", "front"] as const) assert.deepEqual(frameShot({ from: 0, to: 2, on: "both", kind, side }, tl, CAST, 1), front);
  }
});

// ---- two shots in a row
const SPECS: Omit<ShotProps, "from" | "to">[] = [
  ...["me", "claude"].flatMap((on) =>
    (["close", "medium", "wide", "low", "high", "over"] as ShotKind[]).flatMap((kind) => [undefined, "left", "right", "front"].map((side) => ({ on, kind, side: side as ShotProps["side"] }))),
  ),
  ...(["wide", "low", "high"] as ShotKind[]).map((kind) => ({ on: "both", kind })),
];

test("the validator and the kit agree which shots draw the same picture", () => {
  for (const a of SPECS) {
    for (const b of SPECS) {
      const shots: ShotProps[] = [{ from: 0, to: 2, ...a }, { from: 2, to: 4, ...b }];
      const tl = timeline([], shots);
      const own = (s: ShotProps) => kitPicture(s, timeline([], [s]), CAST);
      const same = JSON.stringify(own(shots[0])) === JSON.stringify(own(shots[1]));
      const label = `${a.on} ${a.kind} ${a.side ?? "-"} -> ${b.on} ${b.kind} ${b.side ?? "-"}`;
      assert.equal(shotPicture(a.on, a.kind, a.side) === shotPicture(b.on, b.kind, b.side), same, label);
      // a repeat on one hero is redrawn at the other size of the angle: the cut changes the picture, not twitches
      const [p, q] = shots.map((s) => kitPicture(s, tl, CAST));
      if (b.on !== "both" && a.on === b.on) assert.ok(p.kind !== q.kind || p.side !== q.side, `${label}: тот же кадр подряд`);
    }
  }
});

test("old scenes with the same picture twice in a row cut to another size, not a zoom twitch", () => {
  // out/try/seed1 and trade4: close push -> over push, close still -> over shake, close still -> close side=left push
  for (const [a, b] of [
    [{ kind: "close", move: "push" }, { kind: "over", move: "push" }],
    [{ kind: "close" }, { kind: "over", move: "shake" }],
    [{ kind: "close" }, { kind: "close", side: "left", move: "push" }],
    [{ kind: "close" }, { kind: "close", move: "push" }],
  ] as Partial<ShotProps>[][]) {
    const shots: ShotProps[] = [{ from: 0, to: 2, on: "me", kind: "close", ...a }, { from: 2, to: 4, on: "me", kind: "close", ...b }];
    const tl = timeline(LOOKS.partner, shots);
    const before = frameShot(shots[0], tl, CAST, 1.99);
    const after = frameShot(shots[1], tl, CAST, 2);
    const dist = (f: Framing) => Math.hypot(f.eye[0] - ACTOR_PLACES.me[0], f.eye[2] - ACTOR_PLACES.me[1]);
    const ratio = dist(after) / dist(before);
    assert.ok(ratio > 1.3 || ratio < 0.77, `${JSON.stringify(a)} -> ${JSON.stringify(b)}: камера сдвинулась в ${ratio.toFixed(2)} раза`);
  }
});

/** The screen box of an actor's head (or of Claude's whole block), the face turned as in the shot, lifted as drawn. */
const headBox = (tl: Timeline, id: string, t: number, cam: THREE.PerspectiveCamera) => {
  const human = id === "me";
  const [x, z] = actorPlace(tl, id, t);
  const yaw = human ? faceYaw(tl, id, t) : actorYaw(tl, id, t);
  // standing on the pressed key, the head is that much lower; a jump lifts it from there
  const lift = gestureLift(tl, id, !human, t) - restSink(x, z);
  const [w, d, y0, y1] = human ? [0.46, 0.46, 1.44, 2.0] : [0.9, 0.5, 0.3, 0.86];
  const pts: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [y0 + lift, y1 + lift]) {
    const lx = (sx * w) / 2;
    const lz = (sz * d) / 2;
    pts.push(new THREE.Vector3(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), y, z - lx * Math.sin(yaw) + lz * Math.cos(yaw)).project(cam));
  }
  return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
};

/** The icon on the screen: its drawn box (the art is ~80% of the sprite, overshooting 15% at the pop-in) and pixels. */
const iconOnScreen = (f: Framing, placed: { pos: THREE.Vector3; size: number }) => {
  const cam = camera(f);
  const c = placed.pos.clone().project(cam);
  const depth = placed.pos.clone().sub(cam.position).dot(new THREE.Vector3(...f.aim).sub(cam.position).normalize());
  const tanV = Math.tan((f.fov * Math.PI) / 360);
  // the drawing of the «!» the checks pop: narrow across, the full art high
  const half = (0.4 * placed.size * 1.15) / depth;
  const halfX = (popInk("!") * placed.size * 1.15) / depth;
  const box = { x0: c.x - halfX / (tanV * ASPECT), x1: c.x + halfX / (tanV * ASPECT), y0: c.y - half / tanV, y1: c.y + half / tanV };
  // the sprite's share of the frame width
  const share = (0.5 * placed.size) / (depth * tanV * ASPECT);
  return { cam, box, share, px: { x: ((c.x + 1) / 2) * 1080, y: ((1 - c.y) / 2) * 1920, h: (placed.size / depth / tanV) * 960 } };
};

/** Every frame of a pop through one shot: beside the head and never on it, inside the frame, small, never jumping. */
const checkPop = (tl: Timeline, shot: ShotProps, who: string, label: string, opts: { at?: number; dur?: number } = {}) => {
  const at = opts.at ?? shot.from;
  const dur = opts.dur ?? shot.to - shot.from;
  let prev: { x: number; y: number; h: number } | null = null;
  for (let frame = Math.ceil(at * 30); frame / 30 <= at + dur && frame / 30 < shot.to; frame++) {
    const t = frame / 30;
    const f = frameShot(shot, tl, CAST, t);
    const placed = placePop(tl, CAST, ASPECT, { who, at, icon: "!", for: dur }, t);
    if (!placed) {
      assert.ok(shot.kind === "high", `${label}, ${t.toFixed(2)} с: значка нет`);
      prev = null;
      continue;
    }
    const icon = iconOnScreen(f, placed);
    const head = headBox(tl, who, t, icon.cam);
    const b = icon.box;
    const apart = b.x1 <= head.x0 || b.x0 >= head.x1 || b.y0 >= head.y1 || b.y1 <= head.y0;
    assert.ok(apart, `${label}, ${t.toFixed(2)} с: значок на голове`);
    assert.ok(b.x0 >= -1 && b.x1 <= 1 && b.y0 >= -1 && b.y1 <= 1, `${label}, ${t.toFixed(2)} с: значок за краем кадра`);
    // small: the sprite takes 7-15% of the frame width, a push or a pull inside the shot changes it a little
    const share = icon.share;
    const snapping = shot.move === "whip" && t - shot.from < 0.4;
    if (!snapping) assert.ok(share <= 0.16 && share >= 0.06, `${label}, ${t.toFixed(2)} с: значок ${(share * 100).toFixed(0)}% ширины кадра`);
    // between two frames the icon drifts with the camera; a re-chosen side or size moves it by its own width
    if (prev && !snapping && shot.move !== "shake") {
      const step = Math.hypot(icon.px.x - prev.x, icon.px.y - prev.y) + Math.abs(icon.px.h - prev.h);
      assert.ok(step <= 12, `${label}, ${t.toFixed(2)} с: значок прыгнул на ${step.toFixed(0)} px`);
    }
    prev = icon.px;
  }
};

test("a reaction icon sits beside the head through every frame of every allowed shot, never on it, never jumping", () => {
  const shots: ShotProps[] = [
    ...allowedSolo().map((s) => ({ from: 0, to: 2, ...s })),
    ...MOVES.flatMap((move) => (["wide", "low"] as ShotKind[]).map((kind) => ({ from: 0, to: 2, on: "both", kind, move }))),
  ];
  for (const [name, looks] of Object.entries(LOOKS)) {
    for (const shot of shots) {
      for (const who of shot.on === "both" ? ["me", "claude"] : [shot.on]) {
        checkPop(timeline(looks, [shot]), shot, who, `${who} в ${shot.on} ${shot.kind} ${shot.side ?? "-"} ${shot.move} (${name})`);
      }
    }
  }
});

test("a reaction icon stays clear of a hero who jumps or hops under it", () => {
  // the reviewer's case: Claude's close-up, the '!' above his corner, a jump lifting the block into it
  // at the top of the jump the block is 0.5 over the key, and the key it left has sprung back up
  assert.ok(Math.abs(gestureLift(timeline([], [], { acts: [{ who: "claude", from: 0, to: 2, do: "jump" }] }), "claude", true, 0.375) - (0.5 + KEY_TRAVEL)) < 0.02);
  for (const who of ["claude", "me"]) {
    for (const act of ["jump", "hop", "bounce", "cheer"] as const) {
      for (const shot of [
        { from: 0, to: 2.5, on: who, kind: "close" },
        { from: 0, to: 2.5, on: who, kind: "close", move: "push" },
        { from: 0, to: 2.5, on: who, kind: "medium" },
        ...(who === "claude" ? [{ from: 0, to: 2.5, on: who, kind: "close", side: "right" }] : []),
      ] as ShotProps[]) {
        const tl = timeline(LOOKS.partner, [shot], { acts: [{ who, from: 1.5, to: 2.25, do: act }] });
        checkPop(tl, shot, who, `${who} ${act} в ${shot.kind} ${shot.side ?? "-"} ${shot.move ?? "still"}`, { at: 1.4, dur: 1 });
      }
    }
  }
});

// ---- the owner's right hand with a held prop (Human.tsx: arm, forearm, the hold point; Props.tsx: sizes)
type V3 = [number, number, number];
const POSES: Record<string, { shoulder: V3; elbow: V3; torso?: V3 }> = {
  rest: { shoulder: [0, 0, -0.07], elbow: [-0.12, 0, 0] },
  talkLow: { shoulder: [-0.2, 0, -0.1], elbow: [-0.65, 0, 0] },
  talkHigh: { shoulder: [-0.2, 0, -0.1], elbow: [-0.45, 0, 0] },
  phone: { shoulder: [-0.5, 0, 0.25], elbow: [-1.35, 0, 0] },
};
const HELD: Record<string, { half: V3; centre: V3; scale: number }> = {
  wallet: { half: [0.21, 0.12, 0.05], centre: [0, 0.12, 0], scale: 0.7 },
  phone: { half: [0.085, 0.16, 0.0125], centre: [0, 0.16, 0], scale: 1 },
};
const heldCorners = (tl: Timeline, t: number, pose: { shoulder: V3; elbow: V3; torso?: V3 }, prop: { half: V3; centre: V3; scale: number }) => {
  const [x, z] = actorPlace(tl, "me", t);
  const root = new THREE.Object3D();
  root.position.set(x, 0, z);
  root.rotation.set(0, actorYaw(tl, "me", t), 0);
  const torso = new THREE.Object3D();
  torso.position.set(0, 0.86, 0);
  torso.rotation.set(...(pose.torso ?? [0, 0, 0]));
  const arm = new THREE.Object3D();
  arm.position.set(-0.33, 0.55, 0);
  arm.rotation.set(...pose.shoulder);
  const fore = new THREE.Object3D();
  fore.position.set(0, -0.3, 0);
  fore.rotation.set(...pose.elbow);
  const hold = new THREE.Object3D();
  hold.position.set(0, -0.36, 0.05);
  hold.rotation.set(Math.PI / 2, 0, 0);
  const item = new THREE.Object3D();
  item.scale.setScalar(prop.scale);
  root.add(torso);
  torso.add(arm);
  arm.add(fore);
  fore.add(hold);
  hold.add(item);
  root.updateMatrixWorld(true);
  const pts = [new THREE.Vector3(0, 0, 0).applyMatrix4(fore.matrixWorld)];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push(new THREE.Vector3(prop.centre[0] + sx * prop.half[0], prop.centre[1] + sy * prop.half[1], prop.centre[2] + sz * prop.half[2]).applyMatrix4(item.matrixWorld));
  }
  return pts;
};

test("in the owner's medium the hand with a held prop stays in the frame through every move", () => {
  // the trade video, 4.16-6.17 s: medium push with a wallet in his hand, the wallet cut in half at the left edge
  for (const move of MOVES.filter((m) => m !== "shake")) {
    const shot: ShotProps = { from: 0, to: 2, on: "me", kind: "medium", move };
    for (const [name, looks] of Object.entries(LOOKS)) {
      const tl = timeline(looks, [shot]);
      for (let frame = 0; frame < 60; frame++) {
        const t = frame / 30;
        if (move === "whip" && t < 0.4) continue;
        const cam = camera(frameShot(shot, tl, CAST, t));
        for (const [pn, pose] of Object.entries(POSES)) {
          for (const [qn, prop] of Object.entries(HELD)) {
            for (const p of heldCorners(tl, t, pose, prop)) {
              const s = p.project(cam);
              assert.ok(Math.abs(s.x) <= 0.98 && Math.abs(s.y) <= 0.98, `medium ${move} (${name}), ${t.toFixed(2)} с, ${pn} с ${qn}: рука с предметом за краем кадра (${s.x.toFixed(2)}, ${s.y.toFixed(2)})`);
            }
          }
        }
      }
    }
  }
});

// ---- the validator
const facts = { duration: 10, cast: ["me", "claude"], lines: [] };
const scene = (body: string, actors = '<Actor id="me" at={[-2.24, 0.56]} />\n    <Actor id="claude" at={[2.24, 0.56]} />') => `import React from "react";
import { Sketch, Actor, Shot, Prop, Panel, Move, Screen, Face } from "../kit";
export const Scene: React.FC = () => (
  <Sketch>
    ${actors}
    ${body}
  </Sketch>
);`;
// the sketch opens on the face of whoever says the first line
const DESK = `<Shot from={0} to={2} on="me" kind="medium" move="push" />\n    <Face who="me" from={0} to={2} mood="happy" />`;
const shotsAround = (shot: string) => `${DESK}\n    <Shot from={2} to={5} on="both" kind="wide" />\n    ${shot}`;

test("the validator teaches the shots and props the owner refused", () => {
  const refused: [string, RegExp][] = [
    ['<Shot from={5} to={10} on="me" kind="close" side="front" />', /одна сторона камеры — без side/],
    ['<Shot from={5} to={10} on="me" kind="close" side="left" />', /вертикального экрана/],
    ['<Shot from={5} to={10} on="me" kind="medium" side="right" />', /крупность/],
    ['<Shot from={5} to={10} on="claude" kind="close" side="front" />', /side="right"/],
    ['<Shot from={5} to={10} on="claude" kind="close" side="left" />', /перед своим чатом/],
    ['<Shot from={5} to={10} on="me" kind="over" />', /close на того, кто его слышит/],
    ['<Shot from={5} to={10} on="claude" kind="over" />', /из-за плеча/],
    ['<Shot from={5} to={10} on="both" kind="wide" side="left" />', /спереди, без side/],
  ];
  for (const [shot, teach] of refused) {
    const problems = analyzeScene(scene(shotsAround(shot)), facts);
    assert.ok(problems.some((p) => teach.test(p)), `${shot}: ${problems.join(" | ")}`);
  }
  // the punchline lives in the line and the subtitles: no sign
  const sign = analyzeScene(scene(`${shotsAround('<Shot from={5} to={10} on="me" kind="close" />')}\n    <Prop kind="sign" at={[0, 0, 1]} label="x100" />`), facts);
  assert.ok(sign.some((p) => /табличек/.test(p) && /субтитрах/.test(p)), sign.join(" | "));
  // the owner (2026-10-23): «окошко летает просто как эмоция» — no window in the air, wherever it hangs
  for (const panel of [
    '<Panel at={[0, 1.6, -8]} title="x100" lines={["x100"]} />',
    '<Panel behind="me" depth={8} height={5.5} size={2} title="BTC" lines={["64 210"]} />',
    '<Panel title="BTC" lines={["64 210"]} tone="chart" />',
  ]) {
    const problems = analyzeScene(scene(`${shotsAround('<Shot from={5} to={10} on="me" kind="close" />')}\n    ${panel}`), facts);
    assert.ok(problems.some((p) => /окон в воздухе/.test(p) && /<Screen/.test(p)), `${panel}: ${problems.join(" | ")}`);
  }
});

test("the validator refuses the same picture twice in a row and teaches a change of size", () => {
  const pairs: [string, string, RegExp][] = [
    ['<Shot from={2} to={5} on="me" kind="close" />', '<Shot from={5} to={10} on="me" kind="close" move="push" />', /меняют крупность/],
    ['<Shot from={2} to={5} on="claude" kind="medium" side="right" />', '<Shot from={5} to={10} on="claude" kind="medium" side="right" move="pull" />', /фон: без side — его чат/],
    ['<Shot from={2} to={5} on="both" kind="wide" />', '<Shot from={5} to={10} on="both" kind="wide" move="pull" />', /одним планом/],
  ];
  for (const [a, b, teach] of pairs) {
    const problems = analyzeScene(scene(`${DESK}\n    ${a}\n    ${b}`), facts);
    assert.ok(problems.some((p) => teach.test(p)), `${a} -> ${b}: ${problems.join(" | ")}`);
  }
  for (const [a, b] of [
    ['<Shot from={2} to={5} on="me" kind="close" />', '<Shot from={5} to={10} on="me" kind="medium" move="push" />'],
    ['<Shot from={2} to={5} on="claude" kind="close" />', '<Shot from={5} to={10} on="claude" kind="close" side="right" />'],
    ['<Shot from={2} to={5} on="me" kind="close" />', '<Shot from={5} to={10} on="claude" kind="close" />'],
  ]) {
    assert.deepEqual(analyzeScene(scene(`${DESK}\n    ${a}\n    ${b}`), facts), [], `${a} -> ${b}`);
  }
});

test("the validator keeps the heroes on their places and rows", () => {
  const body = shotsAround('<Shot from={5} to={10} on="me" kind="close" />');
  const turned = analyzeScene(scene(body, '<Actor id="me" at={[-2.24, 0.56]} facing={12} />\n    <Actor id="claude" at={[2.24, 0.56]} />'), facts);
  assert.ok(turned.some((p) => /facing не нужен/.test(p) && /Look/.test(p)), turned.join(" | "));
  for (const move of [
    '<Move who="me" from={2} to={3} place={[-2.24, 2.5]} />',
    '<Move who="me" from={2} to={3} place={[-7, 0.56]} />',
    '<Move who="claude" from={2} to={3} place={[2.24, -1]} />',
    '<Move who="claude" from={2} to={3} place={[0, 0.56]} />',
  ]) {
    const problems = analyzeScene(scene(`${body}\n    ${move}`), facts);
    assert.ok(problems.some((p) => /вдоль ряда/.test(p)), `${move}: ${problems.join(" | ")}`);
  }
  for (const move of ['<Move who="me" from={2} to={3} place={[-1.3, 0.56]} />', '<Move who="claude" from={2} to={3} place={[5, 0.56]} />']) {
    assert.deepEqual(analyzeScene(scene(`${body}\n    ${move}`), facts), [], move);
  }
});

test("every sketch opens on the speaker's face, and the whole desk is a rare shot after it", () => {
  // 10.11.2026, the audit of 23 sketches: the dark desk from afar was the first frame, 59% of YouTube swiped away
  const desk = analyzeScene(scene('<Shot from={0} to={2} on="both" kind="desk" move="push" />\n    <Shot from={2} to={10} on="me" kind="close" />'), facts);
  assert.ok(desk.some((p) => /открывается лицом говорящего/.test(p)), desk.join(" | "));
  const calm = analyzeScene(scene('<Shot from={0} to={5} on="me" kind="close" />\n    <Shot from={5} to={10} on="claude" kind="close" />'), facts);
  assert.ok(calm.some((p) => /Face who="me" from=\{0\}/.test(p)), calm.join(" | "));
  const face = `${DESK}\n    <Shot from={2} to={5} on="claude" kind="close" />`;
  assert.deepEqual(analyzeScene(scene(`${face}\n    <Shot from={5} to={7} on="both" kind="desk" />\n    <Shot from={7} to={10} on="me" kind="close" />`), facts), []);
  const long = analyzeScene(scene(`${face}\n    <Shot from={5} to={10} on="both" kind="desk" />`), facts);
  assert.ok(long.some((p) => /общий план стола идёт 5\.0 с/.test(p)), long.join(" | "));
  const again = analyzeScene(scene(`${face}\n    <Shot from={5} to={7} on="both" kind="desk" />\n    <Shot from={7} to={9} on="me" kind="close" />\n    <Shot from={9} to={10.6} on="both" kind="desk" />`), { ...facts, duration: 10.6 });
  assert.ok(again.some((p) => /не больше одного раза/.test(p)), again.join(" | "));
  const tl = timeline([], [{ from: 0, to: 2, on: "both", kind: "desk", move: "push" }]);
  const f = frameShot(tl.shots[0], tl, CAST, 1);
  // the camera sees the desk from the chair side and above it, far enough for both monitors
  assert.ok(f.eye[2] > 20 && f.eye[1] > 20, `камера ${f.eye.map((v) => v.toFixed(1)).join(", ")}`);
});

test("the validator lets every allowed side and the other props through", () => {
  const body = [
    DESK,
    '<Shot from={2} to={4} on="me" kind="close" move="push" />',
    '<Shot from={4} to={6} on="claude" kind="medium" side="right" />',
    '<Shot from={6} to={8} on="claude" kind="close" />',
    '<Shot from={8} to={10} on="me" kind="low" />',
    '<Prop kind="paper" held="me" label="apple / river" />',
    '<Prop kind="coin" held="claude" variant="btc" />',
    '<Screen on="vertical" from={2} to={8} app="position" title="BTC/USDT ×100" lines={["LONG ×100", "Вход 64 210", "Статус: ликвидирован"]} trend="dump" />',
  ].join("\n    ");
  assert.deepEqual(analyzeScene(scene(body), facts), []);
});

test("the middle of the frame stays clear: no prop on the keys, no chart, no window between the heroes", () => {
  // the owner (2026-10-22): «снова посередине что-то вставил … ни табличку, ни графики, ничего такого»
  const body = shotsAround('<Shot from={5} to={10} on="me" kind="close" />');
  const refused: [string, RegExp][] = [
    ['<Prop kind="coin" at={[0, 0, 1]} variant="btc" />', /на клавиатуре/],
    ['<Prop kind="wallet" near="me" />', /на клавиатуре/],
    ['<Prop kind="chart" held="me" />', /графиков в кадре нет/],
    ['<Prop kind="chart" at={[0, 0, 1]} variant="down" />', /графиков в кадре нет/],
    ['<Panel at={[0, 1.6, -8]} title="BTC" lines={["64 210"]} />', /окон в воздухе/],
    ['<Prop kind="coin" variant="btc" />', /held="me" или held="claude"/],
    ['<Prop kind="coin" at={[10, 0, 0]} variant="btc" />', /на клавиатуре/],
    ['<Panel at={[0, 5, -20]} title="BTC" lines={["64 210"]} />', /окон в воздухе/],
  ];
  for (const [el, teach] of refused) {
    const problems = analyzeScene(scene(`${body}\n    ${el}`), facts);
    assert.ok(problems.some((p) => teach.test(p)), `${el}: ${problems.join(" | ")}`);
    // every fix it teaches leads out of the middle, never back into it with coordinates
    assert.ok(!problems.some((p) => /между героями x|для плана на двоих|at=\{\[x, y, z\]\}/.test(p)), `${el}: ${problems.join(" | ")}`);
  }
});
