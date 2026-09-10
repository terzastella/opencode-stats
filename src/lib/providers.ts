/**
 * Stable pastel color per provider group (e.g. "ollama").
 * Dark theme: light pastels readable on near-black.
 * Light theme: same hue darkened for contrast on white.
 * Unknown providers get a deterministic hue from a name hash.
 */

export type ThemeName = "dark" | "light";

/** Fixed pastel assignments (hex) for known providers. */
const FIXED: Record<string, string> = {
  opencode: "#93c5fd", // powder blue
  ollama: "#9fd8ae", // sage
  lmstudio: "#eec39b", // peach
  "llama.cpp": "#c4b5fd", // lavender
  openrouter: "#e3a4b3", // dusty rose
  nvidia: "#b8cf8e", // muted lime
  groq: "#e5a58d", // terracotta pastel
  anthropic: "#dfc08a", // sand
  mistral: "#8fd0cb", // teal
  google: "#a3b8f0", // cornflower
  cerebras: "#d8a7e0", // orchid
  huggingface: "#f2dd8c", // light yellow
  alibaba: "#d98f7e", // clay
  vercel: "#e4e4e7", // monochrome (brand)
  zen: "#a1a1aa", // zinc
};

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * Color for a provider group in the given theme.
 * Always returns the same color for the same group+theme.
 * Never throws: unexpected input falls back to a hashed hue.
 */
export function providerColor(group: unknown, theme: ThemeName): string {
  const g = typeof group === "string" && group ? group.toLowerCase() : "unknown";
  const fixed = FIXED[g];
  if (fixed) {
    if (theme === "dark") return fixed;
    const [h, s] = hexToHsl(fixed);
    // Grayscale fixed colors stay readable as-is on light backgrounds.
    if (s < 8) return fixed;
    return `hsl(${h}, ${Math.min(s + 8, 70)}%, 40%)`;
  }
  const h = hashHue(g);
  return theme === "dark" ? `hsl(${h}, 45%, 72%)` : `hsl(${h}, 52%, 40%)`;
}
