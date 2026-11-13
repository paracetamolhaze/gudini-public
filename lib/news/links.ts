/**
 * Which main-site project is a hidden «Новости» mirror (lib/news/publish.ts), and where links to it lead.
 * No imports on purpose: the live shared file lib/publications.ts imports this through the build-time patch
 * in news/deploy/site/patch-live.mjs, and it must stay as light as that file.
 */

/** The field that marks a mirror in the main site's db.json; the main projects list hides such projects. */
export const MIRROR_MARK = "newsId";

/** The news video a main project mirrors, or null for any other main project. */
export function mirrorOf(project: unknown): string | null {
  const mark = project && typeof project === "object" ? (project as Record<string, unknown>)[MIRROR_MARK] : null;
  return typeof mark === "string" && mark ? mark : null;
}

/**
 * Links of the main publications page (history, schedules, TikTok jobs): an entry of a news mirror leads to its
 * video at /news/<id>, never to the main editor of the hidden mirror; any other project goes to `other` — the
 * 3D section's links (they lead the 3D mirrors to /3d/<id>) or the main editor. Built once per overview from the
 * projects it already read.
 */
export function projectLinks(
  projects: readonly { id: string }[],
  other: (projectId: string) => string = (projectId) => `/project/${projectId}`,
): (projectId: string) => string {
  const mirrors = new Map<string, string>();
  for (const p of projects) {
    const newsId = mirrorOf(p);
    if (newsId) mirrors.set(p.id, newsId);
  }
  return (projectId) => {
    const newsId = mirrors.get(projectId);
    return newsId ? `/news/${encodeURIComponent(newsId)}` : other(projectId);
  };
}

/**
 * The same for entries the publications page has already linked (by the 3D links, which leave every project that is
 * not a 3D mirror at /project/<id>): an entry leading to the main editor of a news mirror leads to /news/<id>
 * instead. Applied to the finished list, so the 3D patch of that file stays exactly as it is.
 */
export function relinkNews<T extends { href: string }>(entries: T[], projects: readonly { id: string }[]): T[] {
  const links = projectLinks(projects, () => "");
  return entries.map((e) => {
    const m = /^\/project\/([^/?#]+)$/.exec(e.href);
    const to = m ? links(m[1]) : "";
    return to ? { ...e, href: to } : e;
  });
}
