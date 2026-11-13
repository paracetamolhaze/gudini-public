import type { PublishCtx } from "./instagram";

/** Persist before publishing; uncertain sends are only recovered, never blindly repeated. */
export async function publishThreadsReplies(ctx: PublishCtx) {
  const call = async (method: "GET" | "POST", path: string, params: Record<string,string> = {}) => {
    const url = new URL(`${ctx.account.graph}/${path}`);
    const form = new URLSearchParams(params);
    if (method === "GET") url.search = form.toString();
    const response = await ctx.deps.fetch(url.toString(), {method, ...(method === "POST" ? {body:form.toString()} : {}), signal:AbortSignal.timeout(ctx.deps.timeoutMs)});
    if (!response.ok) throw new Error("Threads не подтвердил запрос продолжения");
    return response.json();
  };
  try {
    if (!ctx.load().mediaId) throw new Error("Не найден опубликованный пост для продолжения");
    ctx.save(s => {s.status = "running"; s.stage = "verifying"; s.error = undefined;});
    for (let i = 0; i < (ctx.load().replies?.length ?? 0); i++) {
      let part = ctx.load().replies![i];
      if (part.mediaId) continue;
      const parent = i ? ctx.load().replies![i-1].mediaId! : ctx.load().mediaId!;
      if (part.sentAt) {
        // A timeout can hide a successful publish. Require a unique matching own reply.
        const rows = await call("GET", `${parent}/replies`);
        const matches = (rows.data ?? []).filter((r: any) => r.text === part.text && r.replied_to?.id === parent && Date.parse(r.timestamp) >= Date.parse(part.sentAt!) - 5000);
        if (matches.length !== 1) throw new Error(`Исход комментария ${i+1} не подтверждён. Нажмите «Проверить статус» позже; повторная отправка заблокирована.`);
        ctx.save(s => {s.replies![i].mediaId = String(matches[0].id);});
        continue;
      }
      if (!part.containerId) {
        const result = await call("POST", `${ctx.account.igUserId}/media`, {media_type:"TEXT", caption:part.text, reply_to_id:parent});
        if (!result.id) throw new Error("Threads не вернул контейнер комментария");
        ctx.save(s => {s.replies![i].containerId = String(result.id);});
      }
      part = ctx.load().replies![i];
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const status = await call("GET", part.containerId!, {fields:"status_code"});
        if (status.status_code === "FINISHED") {ready = true; break;}
        if (["ERROR", "EXPIRED", "PUBLISHED"].includes(status.status_code)) throw new Error("Проверьте статус контейнера комментария Threads");
        await ctx.deps.sleep(2000);
      }
      if (!ready) throw new Error("Threads пока не подготовил комментарий. Повторите проверку позже.");
      ctx.save(s => {s.replies![i].sentAt = new Date(ctx.deps.now()).toISOString();});
      const result = await call("POST", `${ctx.account.igUserId}/media_publish`, {creation_id:part.containerId!});
      if (!result.id) throw new Error("Threads не подтвердил публикацию комментария");
      ctx.save(s => {s.replies![i].mediaId = String(result.id); s.log.push({at:new Date(ctx.deps.now()).toISOString(),text:`Продолжение Threads ${i+1} опубликовано`});});
    }
    return ctx.save(s => {s.status = "published"; s.stage = "done"; s.error = undefined; s.retryable = false; s.note = "Карусель и все комментарии-продолжения опубликованы";});
  } catch (error) {
    return ctx.save(s => {s.status = "uncertain"; s.stage = "verifying"; s.retryable = false; s.error = `Карусель опубликована, продолжение не завершено: ${(error as Error).message}`;});
  }
}
