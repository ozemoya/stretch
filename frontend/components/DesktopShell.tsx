"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { readCheckoutDraft } from "@/lib/checkout-draft";
import SketchIcon, { type SketchIconName } from "./SketchIcon";

const navigation: [string, string, SketchIconName | "◈"][] = [
  ["/dashboard", "Dashboard", "◈"], ["/plan", "Grocery list", "bag"],
  ["/lists", "Saved lists", "list"],
];

export default function DesktopShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [area, setArea] = useState("Choose starting area");
  const [notice, setNotice] = useState(false);
  useEffect(() => {
    setArea(readCheckoutDraft(sessionStorage)?.origin?.label ?? "Choose starting area");
  }, [path]);
  if (path === "/") return <>{children}</>;
  return <div className={`desktop-shell ${collapsed ? "sidebar-collapsed" : ""} ${path === "/dashboard" ? "dashboard-shell" : ""}`}>
    <aside className="desktop-sidebar" aria-label="Main navigation">
      <Link href="/" className="desktop-brand"><img src="/assets/stretch-logo-transparent.png" alt="Stretch" /></Link>
      <button className="sidebar-toggle" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? "→" : "←"}</button>
      <span className="nav-caption">SHOPPING</span>
      <nav>{navigation.map(([href, label, icon]) => <Link key={href} href={href} title={label} className={path === href ? "active" : ""} aria-current={path === href ? "page" : undefined}><span aria-hidden="true">{icon === "◈" ? icon : <SketchIcon name={icon} size={27} />}</span><span>{label}</span></Link>)}</nav>
      <div className="sidebar-foot"><span className="pilot-dot" /> <span>Atlanta pilot<small>Store coverage varies.</small></span></div>
    </aside>
    <div className="desktop-body">
      <header className="desktop-topbar">
        <Link href="/plan?panel=settings" className="desktop-location"><span aria-hidden="true">⌖</span> {area}</Link>
        <button className="profile-control" aria-expanded={notice} onClick={() => setNotice(!notice)} aria-label="Guest profile and storage information">G</button>
        {notice && <div className="guest-popover" role="status"><strong>Shopping as a guest</strong><p>Your saved lists stay on this device. Account sync and notifications are not available yet.</p><Link href="/plan?panel=settings" onClick={() => setNotice(false)}>Manage trip preferences →</Link></div>}
      </header>
      <div className="desktop-content">{children}</div>
    </div>
  </div>;
}
