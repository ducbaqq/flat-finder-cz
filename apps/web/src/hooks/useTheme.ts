"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const initial: Theme = prefersDark ? "dark" : "light";
    setThemeState(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
