import {
  siAlibabacloud,
  siAnthropic,
  siDeepseek,
  siGoogle,
  siHuggingface,
  siLmstudio,
  siMeta,
  siMistralai,
  siNvidia,
  siOllama,
  siOpenrouter,
  siQwen,
  siVercel,
  type SimpleIcon,
} from "simple-icons";
import type { JSX } from "react";
import { providerColor } from "./providers";

/**
 * Provider group -> brand icon (simple-icons, CC0).
 * Groups without an official icon fall back to the colored dot.
 * Rendered on a light tile, so every brand color reads well
 * on both dark and light themes.
 */
const BRANDS: Record<string, SimpleIcon> = {
  ollama: siOllama,
  lmstudio: siLmstudio,
  openrouter: siOpenrouter,
  nvidia: siNvidia,
  anthropic: siAnthropic,
  mistral: siMistralai,
  google: siGoogle,
  huggingface: siHuggingface,
  alibaba: siAlibabacloud,
  vercel: siVercel,
  deepseek: siDeepseek,
  qwen: siQwen,
  meta: siMeta,
};

function brandIcon(group: string): SimpleIcon | null {
  if (typeof group !== "string" || !group) return null;
  return BRANDS[group.toLowerCase()] ?? null;
}

/**
 * Official vendor marks, inlined as vector paths (offline, no downloads).
 * Sources & attribution in README. Single-color renditions for 12px tiles.
 */
function OpenCodeMark() {
  return (
    <svg viewBox="0 6 24 30" width={12} height={12} aria-hidden="true">
      <path d="M18 30H6V18H18V30Z" fill="#4B4646" />
      <path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" fill="#B7B1B1" />
    </svg>
  );
}

function ZenMark() {
  return (
    <svg viewBox="0 0 84 30" width={28} height={10} aria-hidden="true">
      <path d="M24 24H6V18H18V12H24V24ZM6 18H0V12H6V18Z" fill="#4B4646" />
      <path d="M6 24H24V30H0V18H6V24ZM18 18H6V12H18V18ZM24 12H18V6H0V0H24V12Z" fill="#F1ECEC" />
      <path d="M54 18V24H36V18H54Z" fill="#4B4646" />
      <path d="M54 18H36V24H54V30H30V0H54V18ZM36 12H48V6H36V12Z" fill="#F1ECEC" />
      <path d="M78 30H66V12H78V30Z" fill="#4B4646" />
      <path d="M78 6H66V30H60V0H78V6ZM84 30H78V6H84V30Z" fill="#F1ECEC" />
    </svg>
  );
}

function GroqMark() {
  return (
    <svg viewBox="0 32 37 58" width={12} height={12} aria-hidden="true">
      <path
        d="M17.77,34.048C7.971,34.048,0,42.019,0,51.817s7.971,17.77,17.77,17.77h5.844v-6.664H17.77c-6.124,0-11.106-4.982-11.106-11.106s4.982-11.106,11.106-11.106s11.132,4.982,11.132,11.106l0,0v16.365l0,0c0,6.084-4.954,11.039-11.023,11.103c-2.904-0.024-5.681-1.191-7.729-3.25l-4.712,4.712c3.266,3.283,7.691,5.151,12.321,5.201v0.003c0.04,0,0.08,0,0.119,0h0.125v-0.003c9.659-0.131,17.48-8.005,17.525-17.686l0.006-16.881C35.302,41.785,27.422,34.048,17.77,34.048z"
        fill="#111111"
      />
    </svg>
  );
}

function CerebrasMark() {
  return (
    <svg viewBox="-20 0 315 505" width={12} height={12} aria-hidden="true">
      <path
        d="m247.63 479.03c-127.8 0-231.4-103.6-231.4-231.4 0-127.8 103.6-231.4 231.4-231.4m-119.21 374.41c-78.853-66.16-89.133-183.71-22.973-262.56 66.16-78.853 183.71-89.133 262.56-22.973m-187 267.59c-69.027-36.44-95.453-121.95-59.013-190.97 36.44-69.04 121.93-95.453 190.97-59.013m-65.333 221.23c-53.187 0-96.307-43.12-96.307-96.307s43.12-96.307 96.307-96.307"
        fill="none"
        stroke="#f15a29"
        strokeWidth={44}
        strokeMiterlimit={10}
      />
    </svg>
  );
}

const OFFICIAL: Record<string, () => JSX.Element> = {
  opencode: OpenCodeMark,
  zen: ZenMark,
  groq: GroqMark,
  cerebras: CerebrasMark,
};

/** Wide marks (e.g. Zen wordmark) get a pill tile instead of a square one. */
const WIDE_TILE = new Set(["zen"]);

function officialMark(group: string): (() => JSX.Element) | null {
  if (typeof group !== "string" || !group) return null;
  return OFFICIAL[group.toLowerCase()] ?? null;
}

/**
 * Hand-drawn marks for providers without an official icon.
 * Plain letterforms (no trademarks involved), brand-flavored colors.
 */
const CUSTOM: Record<string, { glyph: string; color: string }> = {
  "llama.cpp": { glyph: "λ", color: "#B8B8C0" },
  llamacpp: { glyph: "λ", color: "#B8B8C0" },
};

export function ProviderMark({ group, theme }: { group: string; theme: "dark" | "light" }) {
  const icon = brandIcon(group);
  if (!icon) {
    const Official = officialMark(group);
    if (Official) {
      const wide = typeof group === "string" && WIDE_TILE.has(group.toLowerCase());
      return (
        <span className={wide ? "logo-tile wide" : "logo-tile"} title={group}>
          <Official />
        </span>
      );
    }
    const custom =
      typeof group === "string" && group ? CUSTOM[group.toLowerCase()] : undefined;
    if (custom) {
      return (
        <span className="logo-tile" title={group}>
          <span className="logo-glyph" style={{ color: custom.color }}>
            {custom.glyph}
          </span>
        </span>
      );
    }
    return <span className="chip-dot" style={{ background: providerColor(group, theme) }} />;
  }
  return (
    <span className="logo-tile" title={icon.title}>
      <svg viewBox="0 0 24 24" width={12} height={12} fill={`#${icon.hex}`} aria-hidden="true">
        <path d={icon.path} />
      </svg>
    </span>
  );
}
