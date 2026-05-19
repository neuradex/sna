import Link from 'next/link';
import { appName, gitConfig } from '@/lib/shared';
import { i18n } from '@/lib/i18n';

interface Section {
  title: string;
  description: string;
  path: string;
}

interface HomeCopy {
  eyebrow: string;
  tagline: string;
  getStarted: string;
  viewGithub: string;
  sections: Section[];
}

const copy: Record<string, HomeCopy> = {
  en: {
    eyebrow: 'Skills-Native Application SDK',
    tagline:
      'Claude Code, Codex, and OpenCode as a backend runtime. One canonical session, one event protocol, one permission flow, across every runtime.',
    getStarted: 'Get started',
    viewGithub: 'View on GitHub',
    sections: [
      {
        title: 'Quickstart',
        description: 'What SNA is, install, boot the server, send your first prompt.',
        path: 'quickstart',
      },
      {
        title: 'Concepts',
        description: 'Sessions, canonical history, providers, permissions: the why behind the wire.',
        path: 'concepts',
      },
      {
        title: 'API Spec',
        description: 'HTTP routes, WebSocket protocol, event types, live OpenAPI spec.',
        path: 'api',
      },
      {
        title: 'SDKs',
        description: 'Reference for @sna-sdk/core, @sna-sdk/client, @sna-sdk/react, @sna-sdk/testing.',
        path: 'sdks',
      },
      {
        title: 'Cookbook',
        description: 'Streaming, permissions, multi-provider sessions, Electron embedding.',
        path: 'cookbook',
      },
    ],
  },
  ko: {
    eyebrow: 'Skills-Native Application SDK',
    tagline:
      'Claude Code, Codex, OpenCode를 백엔드 런타임으로 감싸는 SDK. 하나의 세션 모델, 하나의 이벤트 프로토콜, 하나의 권한 흐름으로 모든 런타임을 통합합니다.',
    getStarted: '시작하기',
    viewGithub: 'GitHub에서 보기',
    sections: [
      {
        title: 'Quickstart',
        description: 'SNA가 무엇인지, 설치, 서버 부팅, 첫 프롬프트 전송까지.',
        path: 'quickstart',
      },
      {
        title: 'Concepts',
        description: '세션, 정규화 히스토리, 프로바이더, 권한: 와이어 뒤의 이유.',
        path: 'concepts',
      },
      {
        title: 'API Spec',
        description: 'HTTP 라우트, WebSocket 프로토콜, 이벤트 타입, 라이브 OpenAPI 스펙.',
        path: 'api',
      },
      {
        title: 'SDKs',
        description: '@sna-sdk/core, @sna-sdk/client, @sna-sdk/react, @sna-sdk/testing 레퍼런스.',
        path: 'sdks',
      },
      {
        title: 'Cookbook',
        description: '스트리밍, 권한, 멀티 프로바이더 세션, Electron 임베딩 레시피.',
        path: 'cookbook',
      },
    ],
  },
  ja: {
    eyebrow: 'Skills-Native Application SDK',
    tagline:
      'Claude Code、Codex、OpenCode をバックエンドランタイムとしてラップする SDK。1 つのセッションモデル、1 つのイベントプロトコル、1 つの権限フローで、すべてのランタイムを統合します。',
    getStarted: 'はじめる',
    viewGithub: 'GitHub で見る',
    sections: [
      {
        title: 'Quickstart',
        description: 'SNA とは何か、インストール、サーバ起動、最初のプロンプト送信まで。',
        path: 'quickstart',
      },
      {
        title: 'Concepts',
        description: 'セッション、正規化履歴、プロバイダ、権限：ワイヤの背後にある理由。',
        path: 'concepts',
      },
      {
        title: 'API Spec',
        description: 'HTTP ルート、WebSocket プロトコル、イベント型、ライブ OpenAPI 仕様。',
        path: 'api',
      },
      {
        title: 'SDKs',
        description: '@sna-sdk/core、@sna-sdk/client、@sna-sdk/react、@sna-sdk/testing リファレンス。',
        path: 'sdks',
      },
      {
        title: 'Cookbook',
        description: 'ストリーミング、権限、マルチプロバイダセッション、Electron 組み込みのレシピ。',
        path: 'cookbook',
      },
    ],
  },
};

function docHref(lang: string, path: string): string {
  if (lang === i18n.defaultLanguage) return `/docs/${path}`;
  return `/${lang}/docs/${path}`;
}

export default async function HomePage(props: PageProps<'/[lang]'>) {
  const { lang } = await props.params;
  const c = copy[lang] ?? copy.en;
  const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

  return (
    <main className="flex-1">
      <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 pt-20 pb-12 md:pt-28">
        <div className="flex flex-col gap-4">
          <span className="text-fd-muted-foreground text-sm font-medium tracking-widest uppercase">
            {c.eyebrow}
          </span>
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            {appName}
          </h1>
          <p className="text-fd-muted-foreground max-w-2xl text-lg md:text-xl">
            {c.tagline}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={docHref(lang, 'quickstart')}
            className="bg-fd-foreground text-fd-background rounded-md px-5 py-2.5 text-sm font-medium transition hover:opacity-90"
          >
            {c.getStarted}
          </Link>
          <Link
            href={githubUrl}
            className="border-fd-border hover:bg-fd-muted rounded-md border px-5 py-2.5 text-sm font-medium transition"
          >
            {c.viewGithub}
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-12 md:grid-cols-2">
        {c.sections.map((s) => (
          <Link
            key={s.path}
            href={docHref(lang, s.path)}
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

export function generateStaticParams() {
  return i18n.languages.map(lang => ({ lang }));
}
