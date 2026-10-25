import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PharmaStock",
    short_name: "PharmaStock",
    description: "Pharmacy till and stock control: batches, expiry alerts, FEFO, reorder lists — works offline.",
    id: "/dashboard",
    start_url: "/dashboard",
    shortcuts: [{ name: "Open the till", url: "/pos" }, { name: "Alerts", url: "/alerts" }],
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f8fafc",
    theme_color: "#1f1850",
    categories: ["medical", "business", "shopping", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
