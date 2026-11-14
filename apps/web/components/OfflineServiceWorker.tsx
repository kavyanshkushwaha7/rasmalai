"use client";

import { useEffect } from "react";

export function OfflineServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    let cancelled = false;
    const register = () => {
      if (!cancelled) void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(() => {});
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
