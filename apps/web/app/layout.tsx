import type { Metadata } from "next";
import { OfflineServiceWorker } from "@/components/OfflineServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Rasmalai — Good games, good company", template: "%s · Rasmalai" },
  description: "A friendly place for classic board games, new friends, and good company.",
  applicationName: "Rasmalai",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><OfflineServiceWorker />{children}</body></html>;
}
