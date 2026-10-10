import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import DesktopShell from "@/components/DesktopShell";
import "./desktop.css";
import "./sketchbook.css";
export const metadata: Metadata = {
  title: "Stretch — bring more home",
  description:
    "Plan an Atlanta-area grocery trip with available branch-verified prices and estimated driving fuel.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><DesktopShell>{children}</DesktopShell></body>
    </html>
  );
}
