/** Asset keys shared by the kit and the director: what a block asks for and where the prepared file is filed. */

/** A screenshot of a real web page, scrolled to the phrase that is marked on it. */
export const screenKey = (s: { url: string; find?: string }) => `screen:${s.url.trim()}#${(s.find ?? "").trim()}`;

/** A real photo cut out along its subject for a paper collage. */
export const cutoutKey = (c: { query: string; wiki?: string }) => `cutout:${(c.wiki ?? c.query).trim()}`;
