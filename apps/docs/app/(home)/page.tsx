import Link from 'next/link';
import { appName, appTagline, gitConfig } from '@/lib/shared';

const sections: Array<{
  title: string;
  description: string;
  href: string;
}> = [
  {
    title: 'Quickstart',
    description:
      'Boot an embedded SNA server, open a session, send a prompt — under five minutes.',
    href: '/docs/quickstart',
  },
  {
    title: 'Architecture',
    description:
      'Session model, canonical history, providers, event protocol, runtime pool.',
    href: '/docs/architecture',
  },
  {
    title: 'SDKs',
    description:
      'API reference for @sna-sdk/core, @sna-sdk/client, @sna-sdk/react, and @sna-sdk/testing.',
    href: '/docs/sdks',
  },
  {
    title: 'Cookbook',
    description:
      'Recipes for streaming, permissions, multi-provider sessions, Electron embedding.',
    href: '/docs/cookbook',
  },
];

export default function HomePage() {
  return (
    <main className="flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 pt-20 pb-12 md:pt-28">
        <div className="flex flex-col gap-4">
          <span className="text-fd-muted-foreground text-sm font-medium tracking-widest uppercase">
            Skills-Native Application SDK
          </span>
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            {appName}
          </h1>
          <p className="text-fd-muted-foreground max-w-2xl text-lg md:text-xl">
            {appTagline}. One canonical session, one event protocol, one
            permission flow — across every runtime.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/docs/quickstart"
            className="bg-fd-foreground text-fd-background rounded-md px-5 py-2.5 text-sm font-medium transition hover:opacity-90"
          >
            Get started
          </Link>
          <Link
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
            className="border-fd-border hover:bg-fd-muted rounded-md border px-5 py-2.5 text-sm font-medium transition"
          >
            View on GitHub
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-12 md:grid-cols-2">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="border-fd-border hover:border-fd-foreground/30 hover:bg-fd-muted/40 group rounded-lg border p-5 transition"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <span
                aria-hidden
                className="text-fd-muted-foreground group-hover:text-fd-foreground transition"
              >
                →
              </span>
            </div>
            <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
              {s.description}
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}
