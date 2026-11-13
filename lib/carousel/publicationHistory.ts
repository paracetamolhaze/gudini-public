import type { Carousel, PublishState } from "./types";

/** Successful posts remain available when another account is selected. */
export function publishedPosts(c: Carousel): PublishState[] {
  return [...(c.publishHistory ?? []), ...(c.publish.status === "published" ? [c.publish] : [])];
}

export function publishedToAccount(c: Carousel, igUserId: string, platform: "instagram" | "threads" = "instagram"): boolean {
  return publishedPosts(c).some(p => {
    if ((p.account?.via === "threads" ? "threads" : "instagram") !== platform) return false;
    const target = p.account?.igUserId ?? p.igUserId;
    // Legacy records without an account cannot safely be sent again.
    return !target || target === igUserId;
  });
}

export function archivePublishedPost(c: Carousel): void {
  if (c.publish.status === "published") {
    c.publishHistory = [...(c.publishHistory ?? []), structuredClone(c.publish)];
  }
}
