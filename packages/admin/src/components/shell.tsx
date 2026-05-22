import { Link, Outlet } from "@tanstack/react-router";
import { KeyRound, LayoutDashboard, ListChecks, Server, ShieldCheck } from "lucide-react";
import { useAuthToken } from "../auth-token";
import { useHealthQuery } from "../queries";
import { StatusBadge } from "./ui";

const navItems = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/authorization", label: "Authorization", icon: ShieldCheck },
  { to: "/sessions", label: "Sessions", icon: ListChecks },
] as const;

export function Shell() {
  const { token } = useAuthToken();
  const health = useHealthQuery();
  const connected = health.isSuccess && health.data?.ok;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-stone-950 text-white">
              <Server size={20} />
            </div>
            <div>
              <h1 className="text-3xl font-bold leading-tight tracking-normal text-stone-950">SNA Admin</h1>
              <p className="text-sm text-stone-600">Local daemon control surface</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={connected ? "good" : health.isError ? "bad" : "neutral"}>
            {connected ? "Connected" : health.isError ? "Error" : "Checking"}
          </StatusBadge>
          <StatusBadge tone={token ? "good" : "warn"}>
            <KeyRound size={13} className="mr-1" />
            {token ? "Token set" : "Token required"}
          </StatusBadge>
        </div>
      </header>

      <nav className="flex gap-1 rounded-lg border border-stone-300 bg-white/80 p-1 shadow-sm">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold text-stone-600 transition hover:bg-stone-100 [&.active]:bg-stone-950 [&.active]:text-white"
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
