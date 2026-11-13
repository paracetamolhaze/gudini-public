import { createContext, useContext } from "react";

/** Screen area a block occupies for a while; captions and the camera make room for it. */
export type Zone = "bottom" | "top" | "left" | "right" | "full" | "card" | "sheet" | "word" | "board";
/**
 * `text`: words the block already shows big, so captions do not repeat them.
 * `top`: the upper edge of a bottom sheet. `captionY`: where captions stand on a full-screen board;
 * `onCard`: that band lies on the author's card (captions keep their outline there).
 */
export type Occupied = { from: number; to: number; zone: Zone; text?: string; top?: number; captionY?: number; onCard?: boolean };

export const LayoutContext = createContext<Occupied[]>([]);
export const useOccupied = () => useContext(LayoutContext);

/** Zones of blocks that are on screen at any moment of [from, to): a word shown before a block appears already makes room for it. */
export function zonesDuring(occupied: Occupied[], from: number, to: number): Occupied[] {
  return occupied.filter(o => o.from < to && o.to > from);
}

export function zonesAt(occupied: Occupied[], t: number): Zone[] {
  return occupied.filter(o => t >= o.from && t < o.to).map(o => o.zone);
}
