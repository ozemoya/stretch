import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Stretch — bring more home",
  description:
    "Compare your whole grocery basket and the fuel to bring it home.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
