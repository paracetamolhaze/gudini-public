import type { Surface } from "./ScreenApps";
import type { Vec3 } from "./util";

/**
 * Where the room's two monitors hang on their dual arm (key units): the centre of the monitor's body, its turn
 * (0 faces the camera side, +z) and the size of its screen. One description for the set (RoomSet.tsx), the light
 * the screens throw, the glow behind them and the camera measurements of director/shots.test.ts.
 *
 * The owner (2026-10-23): «добавь кронштейны и переставь мониторы» — a landscape monitor behind Claude and a 9:16
 * portrait one to its left, both on one arm clamped to the back of the desk, bottoms nearly level, the portrait one turned
 * in toward the chair. It stands on the owner's camera line ~27 keys behind him: his close-up sees its lower half
 * with the bezels on both sides, so it reads as a monitor and not as a wall of light.
 */
export type MonitorPlace = { centre: Vec3; yaw: number; width: number; height: number };
export const MONITORS: Record<Surface, MonitorPlace> = {
  monitor: { centre: [5, 10, -16], yaw: -0.035, width: 27, height: 16 },
  vertical: { centre: [-19.5, 13, -15.5], yaw: 0.42, width: 11.5, height: 20.5 },
};

/** The dual arm's pole, clamped to the desk's back edge in the gap between the monitors: x, z. */
export const ARM_POLE: [number, number] = [-11.6, -24.2];
/** How high the arms leave the pole. */
export const ARM_HEIGHT = 15;

/** The screen's plane sits this far in front of the centre of the monitor's body. */
export const SCREEN_DEPTH = 0.51;
/** A point in a monitor's own frame (x along the screen, y up, z out of it) in the room. */
export const onMonitor = (m: MonitorPlace, [x, y, z]: Vec3): Vec3 => [
  m.centre[0] + x * Math.cos(m.yaw) + z * Math.sin(m.yaw),
  m.centre[1] + y,
  m.centre[2] - x * Math.sin(m.yaw) + z * Math.cos(m.yaw),
];
