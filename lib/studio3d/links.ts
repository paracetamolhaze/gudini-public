/**
 * Which main-site project is a hidden «3Д» mirror (lib/studio3d/publish.ts), and where links to it lead.
 * No imports on purpose: the live shared file lib/publications.ts imports this through the build-time patch
 * in studio3d/deploy/site/patch-live.mjs, and it must stay as light as that file.
 */

/** The field that marks a mirror in the main site's db.json; the main projects list hides such projects. */
export const MIRROR_MARK = "studio3dId";

/** The 3D project a main project mirrors, or null for an ordinary main project. */
export function mirrorOf(project: unknown): string | null {
  const mark = project && typeof project === "object" ? (project as Record<string, unknown>)[MIRROR_MARK] : null;
  return typeof mark === "string" && mark ? mark : null;
}

/**
 * Links of the main publications page (history, schedules, TikTok jobs): an entry of a mirror leads to its
 * 3D video at /3d/<id>, never to the main editor of the hidden mirror; any other project keeps /project/<id>.
 * Built once per overview from the projects it already read.
 */
export function projectLinks(projects: readonly { id: string }[]): (projectId: string) => string {
  const mirrors = new Map<string, string>();
  for (const p of projects) {
    const studio3dId = mirrorOf(p);
    if (studio3dId) mirrors.set(p.id, studio3dId);
  }
  return (projectId) => {
    const studio3dId = mirrors.get(projectId);
    return studio3dId ? `/3d/${encodeURIComponent(studio3dId)}` : `/project/${projectId}`;
  };
}
