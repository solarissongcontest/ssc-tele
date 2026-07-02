import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  DEFAULT_THEME,
  loadTheme,
  resetTheme,
  saveTheme,
  type ThemeTokens,
} from "@/lib/theme";
import { RotateCcw, Save, Eye } from "lucide-react";

export const Route = createFileRoute("/admin/theme")({
  head: () => ({ meta: [{ title: "Theme — Solaris Admin" }] }),
  component: AdminTheme,
});

type ColorField = {
  key: keyof ThemeTokens;
  label: string;
  hint?: string;
};

const COLOR_FIELDS: ColorField[] = [
  { key: "background", label: "Background", hint: "Page background base color" },
  { key: "foreground", label: "Foreground / Text" },
  { key: "primary", label: "Primary (buttons, accents)" },
  { key: "primaryForeground", label: "Text on primary" },
  { key: "accent", label: "Accent" },
  { key: "destructive", label: "Destructive" },
  { key: "success", label: "Success" },
  { key: "glow", label: "Glow / Halo" },
];

const GRADIENT_FIELDS: ColorField[] = [
  {
    key: "gradientStage",
    label: "Background gradient (full CSS background)",
    hint: "Any valid CSS background value (gradients, layered).",
  },
  {
    key: "gradientHero",
    label: "Hero button gradient (Enter Booth, Vote, primary CTAs)",
    hint: "Two-color liquid-glass gradient behind every primary/hero button. Any CSS gradient value.",
  },
  {
    key: "cardTint",
    label: "Glass panel tint",
    hint: "Use rgba() with low alpha (e.g. rgba(12,22,40,0.10)).",
  },
];

function AdminTheme() {
  const [theme, setTheme] = useState<ThemeTokens>(() => loadTheme());
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTheme(loadTheme());
  }, []);

  const update = <K extends keyof ThemeTokens>(key: K, value: ThemeTokens[K]) => {
    setTheme((t) => ({ ...t, [key]: value }));
    setDirty(true);
  };

  const onSave = () => {
    saveTheme(theme);
    setDirty(false);
    toast.success("Theme saved");
  };

  const onReset = () => {
    resetTheme();
    setTheme(DEFAULT_THEME);
    setDirty(false);
    toast.success("Theme reset to defaults");
  };

  const onPreview = () => {
    saveTheme(theme);
    toast.success("Preview applied — remember to Save");
  };

  return (
    <AdminShell title="Theme">
      <div className="space-y-6 max-w-3xl">
        <section className="glass-strong rounded-2xl p-6">
          <p className="text-xs uppercase tracking-widest text-primary">
            Visual identity
          </p>
          <h2 className="mt-1 text-2xl font-bold">Theme colours</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Live-edit the colour tokens, button gradients and background of the
            entire platform. Saved per-browser via local storage.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={onSave} disabled={!dirty}>
              <Save className="h-4 w-4" /> Save
            </Button>
            <Button variant="outline" onClick={onPreview}>
              <Eye className="h-4 w-4" /> Apply preview
            </Button>
            <Button variant="ghost" onClick={onReset}>
              <RotateCcw className="h-4 w-4" /> Reset to defaults
            </Button>
          </div>
        </section>

        <section className="glass rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold">Colours</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            {COLOR_FIELDS.map((f) => (
              <ColorRow
                key={f.key}
                field={f}
                value={theme[f.key] as string}
                onChange={(v) => update(f.key, v as ThemeTokens[typeof f.key])}
              />
            ))}
          </div>
        </section>

        <section className="glass rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold">Gradients & glass</h3>
          <div className="space-y-4">
            {GRADIENT_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-sm">{f.label}</Label>
                <textarea
                  value={theme[f.key] as string}
                  onChange={(e) =>
                    update(f.key, e.target.value as ThemeTokens[typeof f.key])
                  }
                  rows={3}
                  className="w-full rounded-md border border-border bg-input/40 px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {f.hint && (
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="glass-strong rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold">Live preview</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="glass rounded-xl p-4">
              <p className="text-xs uppercase tracking-widest text-primary">
                Card
              </p>
              <p className="mt-1 text-lg font-bold">Glass panel</p>
              <p className="text-sm text-muted-foreground">
                Sample body copy on a floating glass surface.
              </p>
            </div>
            <div className="rounded-xl p-4 bg-hero text-primary-foreground">
              <p className="text-xs uppercase tracking-widest opacity-80">
                Hero gradient
              </p>
              <p className="mt-1 text-lg font-bold">Primary call to action</p>
              <Button className="mt-3" variant="secondary">
                Sample button
              </Button>
            </div>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function ColorRow({
  field,
  value,
  onChange,
}: {
  field: ColorField;
  value: string;
  onChange: (v: string) => void;
}) {
  // Try to render an HTML color input alongside the free-text field.
  // Color input only supports #rrggbb; we keep the text input authoritative.
  const isHex = /^#([0-9a-f]{6})$/i.test(value.trim());

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{field.label}</Label>
      <div className="flex items-center gap-2">
        <div
          className="h-9 w-9 shrink-0 rounded-md border border-white/30 shadow-inner"
          style={{ background: value }}
          aria-label="Color preview"
        />
        <Input
          type="color"
          value={isHex ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 shrink-0 p-1 cursor-pointer"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
      {field.hint && (
        <p className="text-xs text-muted-foreground">{field.hint}</p>
      )}
    </div>
  );
}
