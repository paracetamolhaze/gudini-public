import { createHash, createHmac } from "crypto";
import { getSettings } from "../store";
import type { PublishAccount } from "./types";

export type ThreadsAccountInfo = { account: PublishAccount | null; problems: string[] };
const bridge = () => `${(process.env.THREADS_URL || "http://localhost:8600").replace(/\/$/, "")}/threads/api/carousel`;
const headers = () => ({ cookie: `gudini_auth=${createHash("sha256").update(`gudini:${process.env.SITE_PASSWORD ?? ""}`).digest("hex")}` });
export async function threadsAccountInfo(): Promise<ThreadsAccountInfo> {
  try {
    const response=await fetch(`${bridge()}/account`,{headers:headers(),signal:AbortSignal.timeout(5000),cache:"no-store"});
    if(!response.ok) throw new Error();
    const result=await response.json() as ThreadsAccountInfo;
    if(!Array.isArray(result.problems)) throw new Error();
    if(!/^https:\/\//i.test(getSettings().publicBaseUrl ?? "")) result.problems.push("Для слайдов нужен публичный HTTPS-адрес сайта.");
    return result;
  } catch { return {account:null,problems:["Не удалось подключиться к разделу Тредс. Проверьте, что он запущен."]}; }
}

/** Adapts the shared, persisted carousel state machine to the Threads service. */
export function threadsGraphFetch(account: PublishAccount): typeof fetch {
  return async (input, init) => {
    const url=new URL(String(input));
    const params=Object.fromEntries(init?.method === "POST" ? new URLSearchParams(String(init.body)) : url.searchParams);
    delete params.access_token;
    const body=JSON.stringify({accountId:account.igUserId,method:init?.method ?? "GET",path:url.pathname.replace(/^\/v1\//,""),params});
    const stamp=String(Date.now());
    const signature=createHmac("sha256",process.env.SITE_PASSWORD ?? "").update(`${stamp}\n${body}`).digest("hex");
    const r=await fetch(`${bridge()}/graph`,{method:"POST",headers:{...headers(),"content-type":"application/json","x-carousel-time":stamp,"x-carousel-signature":signature},body,signal:init?.signal});
    if(r.ok) return r;
    return new Response(JSON.stringify({error:{message:"Threads не подтвердил запрос. Проверьте подключение и статус публикации."}}),{status:r.status});
  };
}
