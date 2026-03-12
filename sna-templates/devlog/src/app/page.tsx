"use client";

import { useEffect, useState, useRef } from "react";
import { useSkillEvents } from "@/hooks/use-skill-events";
import type { SkillEvent } from "@/hooks/use-skill-events";
import { useTerminalStore } from "@/stores/terminal-store";

interface Summary {
  total_commits: number;
  total_insertions: number;
  active_repos: number;
  active_days: number;
}

interface DayRow    { date: string; commits: number; insertions: number }
interface RepoRow   { repo: string; commits: number; insertions: number }
interface HourRow   { hour: string; commits: number }
interface CommitRow { date: string; time: string; repo: string; message: string; insertions: number; deletions: number }

interface DevlogData {
  summary: Summary;
  by_date: DayRow[];
  by_repo: RepoRow[];
  by_hour: HourRow[];
  recent: CommitRow[];
}

function Bar({ value, max, color = "bg-violet-500" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(3, (value / max) * 100) : 3;
  return (
    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function EventFeed({ events }: { events: SkillEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events]);

  const TYPE_STYLE: Record<string, string> = {
    invoked:           "text-white/30",
    called:            "text-white/50",
    success:           "text-emerald-400",
    failed:            "text-red-400",
    permission_needed: "text-amber-400/80",
    start:             "text-white/35",
    progress:          "text-white/25",
    milestone:         "text-violet-400/80",
    complete:          "text-emerald-400/70",
    error:             "text-red-400/70",
  };
  const TYPE_PREFIX: Record<string, string> = {
    invoked:           "·",
    called:            "→",
    success:           "✓",
    failed:            "✗",
    permission_needed: "⚠",
    start:             "▶",
    progress:          "·",
    milestone:         "◆",
    complete:          "✓",
    error:             "✗",
  };

  return (
    <div className="w-56 flex-shrink-0 border-r border-white/5 flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-white/5 flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] text-white/25 font-mono">skill events</span>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto px-3 py-2">
        {events.length === 0 ? (
          <p className="text-[10px] text-white/15 font-mono mt-2">no events yet</p>
        ) : (
          <div className="space-y-1.5">
            {events.map((e) => (
              <div key={e.id} className={`font-mono text-[10px] ${TYPE_STYLE[e.type]}`}>
                <span className="mr-1">{TYPE_PREFIX[e.type]}</span>
                <span className="text-white/15">[{e.skill}]</span>
                <span className="block pl-3 mt-0.5 text-[10px] leading-relaxed">{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillButton({
  icon, label, desc, running, onClick,
}: {
  skill: string; icon: string; label: string; desc: string;
  running: boolean; runningLabel: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={running}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-left transition-all
        ${running
          ? "bg-violet-500/10 border-violet-500/25 cursor-not-allowed"
          : "bg-white/3 border-white/8 hover:bg-white/6 hover:border-white/15 cursor-pointer"
        }`}
    >
      <span className="text-base flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className={`text-xs font-medium leading-none mb-0.5 ${running ? "text-violet-400" : "text-white/70"}`}>
          {running ? (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse inline-block" />
              Running...
            </span>
          ) : label}
        </div>
        <div className="text-[10px] text-white/25 truncate">{desc}</div>
      </div>
    </button>
  );
}

export default function DevlogPage() {
  const [data, setData] = useState<DevlogData | null>(null);
  const [loading, setLoading] = useState(true);
  const { sendToTerminal, setOpen } = useTerminalStore();

  const runSkill = (skillName: string) => {
    fetch("/api/emit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: skillName, type: "invoked", message: `${skillName} invoked` }),
    });
    sendToTerminal(`/${skillName}`);
    setTimeout(() => sendToTerminal("\r"), 50);
  };

  const refreshData = () => {
    fetch("/api/devlog")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const { events, isRunning } = useSkillEvents({
    onEvent: (e) => {
      if (e.type === "complete" || e.type === "success") refreshData();
    },
    onNeedPermission: () => setOpen(true),
  });

  useEffect(() => { refreshData(); }, []);

  if (loading) {
    return (
      <div className="h-screen bg-[#0a0a0f] flex items-center justify-center text-white/30 font-mono text-sm">
        loading...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-screen bg-[#0a0a0f] flex flex-col items-center justify-center gap-4">
        <p className="text-white/40 text-sm">No data yet.</p>
        <SkillButton
          skill="devlog-collect"
          icon="⟳"
          label="Sync repos"
          desc="run /devlog-collect"
          running={isRunning("devlog-collect")}
          runningLabel="Running..."
          onClick={() => runSkill("devlog-collect")}
        />
        <p className="text-white/20 text-[10px] font-mono">open the terminal and run /devlog-collect</p>
      </div>
    );
  }

  const { summary, by_date, by_repo, by_hour, recent } = data;
  const maxByDay  = Math.max(...by_date.map((d) => d.commits), 1);
  const maxByRepo = Math.max(...by_repo.map((r) => r.commits), 1);
  const maxByHour = Math.max(...by_hour.map((h) => h.commits), 1);

  return (
    <div className="h-screen bg-[#0a0a0f] text-[#e8e8f0] flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="border-b border-white/5 px-5 py-3 flex items-center justify-between flex-shrink-0">
        <span className="font-mono text-xs text-white/30">devlog</span>
        <div className="flex items-center gap-2">
          <SkillButton skill="devlog-collect" icon="⟳" label="Sync repos"    desc="/devlog-collect" running={isRunning("devlog-collect")} runningLabel="Running..." onClick={() => runSkill("devlog-collect")} />
          <SkillButton skill="devlog-analyze" icon="◈" label="Analyze"       desc="/devlog-analyze" running={isRunning("devlog-analyze")} runningLabel="Running..." onClick={() => runSkill("devlog-analyze")} />
          <SkillButton skill="devlog-report"  icon="↗" label="Weekly report" desc="/devlog-report"  running={isRunning("devlog-report")}  runningLabel="Running..." onClick={() => runSkill("devlog-report")}  />
          <div className="flex items-center gap-1.5 text-[10px] font-mono ml-1 pl-3 border-l border-white/8">
            {isRunning("devlog-collect") || isRunning("devlog-analyze") || isRunning("devlog-report") ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                <span className="text-violet-400/60">skill running</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
                <span className="text-white/20">ready</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        <EventFeed events={events} />

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6" style={{ minWidth: 0 }}>
          <div>
            <h1 className="text-lg font-bold text-white">Dev Coding Tracker</h1>
            <p className="text-white/30 text-xs mt-0.5">your git activity, analyzed by Claude Code skills</p>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "commits",     value: summary.total_commits,                           color: "text-violet-400" },
              { label: "lines added", value: `+${summary.total_insertions.toLocaleString()}`, color: "text-emerald-400" },
              { label: "repos",       value: summary.active_repos,                            color: "text-blue-400" },
              { label: "active days", value: summary.active_days,                             color: "text-amber-400" },
            ].map((c) => (
              <div key={c.label} className="p-4 rounded-xl border border-white/8 bg-white/2">
                <div className={`text-xl font-bold font-mono ${c.color}`}>{c.value}</div>
                <div className="text-white/25 text-[10px] mt-0.5">{c.label}</div>
              </div>
            ))}
          </div>

          {/* Activity by day */}
          <div className="p-5 rounded-xl border border-white/8 bg-white/2">
            <h2 className="text-xs font-semibold text-white/50 mb-4">Daily Activity</h2>
            <div className="space-y-2">
              {by_date.slice(0, 10).map((row) => (
                <div key={row.date} className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-white/25 w-20 flex-shrink-0">{row.date}</span>
                  <div className="flex-1"><Bar value={row.commits} max={maxByDay} color="bg-violet-500/50" /></div>
                  <span className="font-mono text-[10px] text-white/30 w-8 text-right">{row.commits}</span>
                  <span className="font-mono text-[10px] text-emerald-500/50 w-12 text-right">+{row.insertions}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-5 rounded-xl border border-white/8 bg-white/2">
              <h2 className="text-xs font-semibold text-white/50 mb-4">By Repo</h2>
              <div className="space-y-2.5">
                {by_repo.map((r) => (
                  <div key={r.repo}>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="font-mono text-white/50 truncate">{r.repo}</span>
                      <span className="text-white/25 ml-2">{r.commits}</span>
                    </div>
                    <Bar value={r.commits} max={maxByRepo} color="bg-blue-500/40" />
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 rounded-xl border border-white/8 bg-white/2">
              <h2 className="text-xs font-semibold text-white/50 mb-4">Peak Hours</h2>
              <div className="space-y-2.5">
                {by_hour.map((h) => (
                  <div key={h.hour}>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="font-mono text-white/50">{h.hour}:00</span>
                      <span className="text-white/25">{h.commits}</span>
                    </div>
                    <Bar value={h.commits} max={maxByHour} color="bg-amber-500/40" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent commits */}
          <div className="p-5 rounded-xl border border-white/8 bg-white/2">
            <h2 className="text-xs font-semibold text-white/50 mb-4">Recent Commits</h2>
            <div className="space-y-2.5">
              {recent.map((c, i) => (
                <div key={i} className="flex items-start gap-3 py-1.5 border-b border-white/4 last:border-0">
                  <div className="flex-shrink-0 w-16 text-right">
                    <div className="font-mono text-[10px] text-white/20">{c.date}</div>
                    <div className="font-mono text-[10px] text-white/15">{c.time}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/60 truncate">{c.message}</p>
                    <p className="font-mono text-[10px] text-white/25 mt-0.5">{c.repo}</p>
                  </div>
                  <div className="flex-shrink-0 font-mono text-[10px]">
                    <span className="text-emerald-500/50">+{c.insertions}</span>
                    <span className="text-white/15 mx-0.5">/</span>
                    <span className="text-red-500/40">-{c.deletions}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
