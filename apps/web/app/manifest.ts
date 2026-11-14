import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rasmalai — Good games, good company",
    short_name: "Rasmalai",
    description: "Play classic local board games with friends and family.",
    start_url: "/games",
    scope: "/",
    display: "standalone",
    background_color: "#071411",
    theme_color: "#071411",
    icons: [
      { src: "/rasmalai-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/rasmalai-icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/rasmalai-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/rasmalai-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/rasmalai-icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
