import { Link, Outlet } from "@tanstack/react-router";
import { Gauge, LayoutDashboard, ListChecks, Moon, ShieldCheck, Sun } from "lucide-react";
import { useHealthQuery } from "../queries";
import { useTheme } from "../theme";
import snaIcon from "../assets/sna-icon.svg";
import { StatusBadge } from "./ui";

const navItems = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/authorization", label: "Authorization", icon: ShieldCheck },
  { to: "/sessions", label: "Sessions", icon: ListChecks },
  { to: "/runtime", label: "Runtime", icon: Gauge },
] as const;

export function Shell() {
  const { theme, toggleTheme } = useTheme();
  const health = useHealthQuery();
  const connected = health.isSuccess && health.data?.ok;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <img src={snaIcon} alt="SNA" className="size-10 rounded-xl shadow-[0_0_30px_var(--accent-soft)]" />
            <div>
              <h1 className="text-2xl font-bold leading-tight tracking-normal text-[var(--fg)]">SNA Admin</h1>
              <p className="font-mono text-xs text-[var(--fg-muted)]">local daemon control surface</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="focus-ring inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-subtle)] px-2 font-mono text-[10px] font-medium text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg-soft)]"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
            {theme}
          </button>
          <StatusBadge tone={connected ? "good" : health.isError ? "bad" : "neutral"}>
            {connected ? "Connected" : health.isError ? "Error" : "Checking"}
          </StatusBadge>
          <StatusBadge tone="good">Admin</StatusBadge>
        </div>
      </header>

      <nav className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 backdrop-blur">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="focus-ring inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-transparent px-3 font-mono text-xs font-medium text-[var(--fg-muted)] transition hover:bg-[var(--panel-subtle)] hover:text-[var(--fg-soft)] [&.active]:border-[var(--accent-border)] [&.active]:bg-[var(--accent-soft)] [&.active]:text-[var(--accent)]"
              activeOptions={{ exact: item.to === "/" }}
            >
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Outlet />
    </main>
  );
}
