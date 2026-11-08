"use client";

import * as React from "react";

/** True when the media query matches. Starts false (server render = desktop layout), then syncs. */
export function useMedia(query: string) {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** Phones (below Tailwind's md breakpoint). */
export const useIsPhone = () => useMedia("(max-width: 767px)");
