import type { Metadata } from "next";
import "./globals.css";
import { NavLink } from "./nav-link";

export const metadata: Metadata = {
  title: "Dossier",
  description: "Track your job and PhD applications and find the exact files you sent to each one.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full">
        <nav aria-label="Main" className="flex w-48 shrink-0 flex-col gap-1 border-r border-foreground/15 p-4">
          <span className="mb-4 px-3 text-lg font-semibold">Dossier</span>
          <NavLink href="/">Dashboard</NavLink>
          <NavLink href="/tracks">Tracks</NavLink>
          <NavLink href="/settings">Settings</NavLink>
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </body>
    </html>
  );
}
