import { useEffect } from "react";
import { applyTheme, loadTheme } from "@/lib/theme";

/** Applies the saved theme on mount and reacts to runtime updates. */
export function ThemeApplier() {
  useEffect(() => {
    applyTheme(loadTheme());
    const onChange = () => applyTheme(loadTheme());
    window.addEventListener("solaris-theme-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("solaris-theme-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return null;
}
