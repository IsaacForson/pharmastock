"use client";
import { useEffect } from "react";

/** Registers public/sw.js (production only: a cache-first SW would serve stale dev chunks). */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((e) => console.warn("Service worker registration failed", e));
  }, []);
  return null;
}
