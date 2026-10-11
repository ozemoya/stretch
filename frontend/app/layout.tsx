import type { Metadata } from "next";
import "./globals.css";
import DesktopShell from "@/components/DesktopShell";
import "./desktop.css";
import "./sketchbook.css";
import "./smart-cart.css";
export const metadata: Metadata = {
  title: "Stretch — bring more home",
  description:
    "Plan an Atlanta-area grocery trip using available store prices and estimated driving fuel.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><DesktopShell>{children}</DesktopShell></body>
    </html>
  );
}
