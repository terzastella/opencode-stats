import { detectLang, type Lang } from "./i18n";

export type Theme = "dark" | "light";
export type RangeKey = "daily" | "weekly" | "all";
export type ViewMode = "sum" | "split";
export type ProviderView = "bars" | "pie";

export interface Profile {
  name: string;
  emoji: string;
  theme: Theme;
  range: RangeKey;
  viewMode: ViewMode;
  providerView: ProviderView;
  lang: Lang;
  /** Short bio shown under the name (max 120 chars). */
  desc: string;
  /** Profile photo as data URL (downscaled JPEG) or "" for monogram. */
  photo: string;
}

const KEY = "opencode-stats-profile-v1";
const DESC_MAX = 120;
/** ~200KB cap: keeps localStorage comfortably below quota. */
const PHOTO_MAX = 200_000;

const DEFAULTS: Profile = {
  name: "Il mio workspace",
  emoji: "📊",
  theme: "dark",
  range: "daily",
  viewMode: "sum",
  providerView: "bars",
  lang: "it",
  desc: "",
  photo: "",
};

function cleanPhoto(v: unknown): string {
  if (typeof v !== "string") return "";
  if (!v.startsWith("data:image/")) return "";
  if (v.length > PHOTO_MAX) return "";
  return v;
}

export function loadProfile(): Profile {
  const lang = detectLang();
  const defaultName = lang === "en" ? "My workspace" : DEFAULTS.name;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, lang, name: defaultName };
    const p = JSON.parse(raw) as Partial<Profile>;
    return {
      name: typeof p.name === "string" && p.name.trim() ? p.name : defaultName,
      emoji: typeof p.emoji === "string" && p.emoji ? p.emoji : DEFAULTS.emoji,
      theme: p.theme === "light" ? "light" : "dark",
      range: p.range === "weekly" || p.range === "all" ? p.range : "daily",
      viewMode: p.viewMode === "split" ? "split" : "sum",
      providerView: p.providerView === "pie" ? "pie" : "bars",
      lang: p.lang === "en" ? "en" : p.lang === "it" ? "it" : lang,
      desc: typeof p.desc === "string" ? p.desc.slice(0, DESC_MAX) : "",
      photo: cleanPhoto(p.photo),
    };
  } catch {
    return { ...DEFAULTS, lang, name: defaultName };
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

export const EMOJI_CHOICES = ["📊", "🚀", "🧠", "⚡", "🦙", "🤖", "💻", "📈"];

export const DESC_MAX_LENGTH = DESC_MAX;
export const PHOTO_MAX_BYTES = PHOTO_MAX;
