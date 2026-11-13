/** Shared identity between prepared HyperFrames assets and the Remotion component. */
export function graphicKey(props: { from: number; to: number; html: string; css?: string; motion: unknown; author?: string }): string {
  const text = JSON.stringify([props.from, props.to, props.html, props.css ?? "", props.motion, props.author ?? "split"]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `hypergraphic:${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}
