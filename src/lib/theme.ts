/**
 * Lightweight theme customization layer.
 *
 * Stores a set of CSS variable overrides in localStorage and applies them
 * to <html> as inline custom-property styles. Lets the admin theme page
 * recolor the site without touching styles.css.
 */

export type ThemeTokens = {
  background: string;        // CSS color (any valid CSS color string)
  foreground: string;
  primary: string;
  primaryForeground: string;
  accent: string;
  destructive: string;
  success: string;
  cardTint: string;          // base color used inside glass overlays
  glow: string;
  gradientStage: string;     // full CSS background value
  gradientHero: string;      // full CSS background-image value
  panelOpacity: number;      // 0..0.6, alpha of frosted panels/cards/modals
};

export const DEFAULT_THEME: ThemeTokens = {
  background: "oklch(0.16 0.04 230)",
  foreground: "oklch(0.98 0.01 220)",
  primary: "oklch(0.80 0.16 180)",
  primaryForeground: "oklch(0.12 0.05 230)",
  accent: "oklch(0.72 0.18 155)",
  destructive: "oklch(0.65 0.22 25)",
  success: "oklch(0.72 0.17 160)",
  cardTint: "rgba(230, 245, 255, 0.028)",
  glow: "oklch(0.80 0.18 180)",
  gradientStage: [
    "radial-gradient(ellipse 80% 60% at 50% -10%, oklch(0.50 0.20 180 / 0.55), transparent 60%)",
    "radial-gradient(ellipse 65% 55% at 85% 110%, oklch(0.55 0.22 155 / 0.40), transparent 60%)",
    "radial-gradient(ellipse 65% 55% at 5% 100%, oklch(0.42 0.18 245 / 0.45), transparent 60%)",
    "radial-gradient(ellipse 50% 40% at 50% 50%, oklch(0.35 0.14 200 / 0.25), transparent 70%)",
    "linear-gradient(180deg, oklch(0.10 0.05 235), oklch(0.08 0.05 245))",
  ].join(", "),
  gradientHero:
    "linear-gradient(135deg, oklch(0.82 0.16 180), oklch(0.74 0.18 155))",
  panelOpacity: 0.10,
};


const LEGACY_OPAQUE_CARD_TINTS = new Set([
  "rgba(12, 22, 40, 0.12)",
  "rgba(230, 240, 255, 0.10)",
  "rgba(230, 240, 255, 0.14)",
]);

const STORAGE_KEY = "solaris.theme.v1";

export function loadTheme(): ThemeTokens {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw);
    const theme = { ...DEFAULT_THEME, ...parsed };
    if (LEGACY_OPAQUE_CARD_TINTS.has(String(theme.cardTint).trim())) {
      theme.cardTint = DEFAULT_THEME.cardTint;
    }
    return theme;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: ThemeTokens) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent("solaris-theme-change"));
}

export function resetTheme() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  applyTheme(DEFAULT_THEME);
  window.dispatchEvent(new CustomEvent("solaris-theme-change"));
}

export function applyTheme(theme: ThemeTokens) {
  if (typeof document === "undefined") return;
  const r = document.documentElement.style;
  r.setProperty("--background", theme.background);
  r.setProperty("--foreground", theme.foreground);
  r.setProperty("--primary", theme.primary);
  r.setProperty("--primary-foreground", theme.primaryForeground);
  r.setProperty("--accent", theme.accent);
  r.setProperty("--destructive", theme.destructive);
  r.setProperty("--success", theme.success);
  r.setProperty("--glow", theme.glow);
  r.setProperty("--ring", theme.primary);
  r.setProperty("--card-tint", theme.cardTint);
  r.setProperty("--glass-tint-strong", "rgba(230, 245, 255, 0.045)");
  r.setProperty("--gradient-stage", theme.gradientStage);
  r.setProperty("--gradient-hero", theme.gradientHero);
  const alpha = Math.max(0, Math.min(0.6, Number(theme.panelOpacity ?? 0.10)));
  r.setProperty("--panel-alpha", alpha.toFixed(3));
}

