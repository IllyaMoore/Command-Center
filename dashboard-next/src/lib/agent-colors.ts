/**
 * Deterministic avatar color from agent folder name.
 * Returns a Tailwind-compatible bg + text class pair.
 */

const PALETTE = [
  { bg: "bg-rose-500/15", text: "text-rose-500" },
  { bg: "bg-orange-500/15", text: "text-orange-500" },
  { bg: "bg-amber-500/15", text: "text-amber-500" },
  { bg: "bg-emerald-500/15", text: "text-emerald-500" },
  { bg: "bg-teal-500/15", text: "text-teal-500" },
  { bg: "bg-cyan-500/15", text: "text-cyan-500" },
  { bg: "bg-blue-500/15", text: "text-blue-500" },
  { bg: "bg-indigo-500/15", text: "text-indigo-500" },
  { bg: "bg-violet-500/15", text: "text-violet-500" },
  { bg: "bg-fuchsia-500/15", text: "text-fuchsia-500" },
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function agentColor(folder: string): { bg: string; text: string } {
  return PALETTE[hash(folder) % PALETTE.length];
}
