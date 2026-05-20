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
  buildTitle: string;
  buildIntro: string;
  buildItems: Section[];
  getStarted: string;
  viewGithub: string;
  sections: Section[];
}

const copy: Record<string, HomeCopy> = {
  en: {
    eyebrow: 'Skills-Native Application SDK',
    tagline:
      'Claude Code, Codex, and OpenCode as a backend runtime. One canonical session, one event protocol, one permission flow, across every runtime.',
    buildTitle: 'Build agentic applications',
    buildIntro:
      'SNA gives your product a sessionful agent runtime: a process that can use tools, ask for permission, keep history, and stream state back into your UI.',
    buildItems: [
      {
        title: 'Agentic product surfaces',
        description: 'Build product flows where the agent is part of the application runtime, not a separate chatbot bolted onto the side.',
        path: 'introduction',
      },
      {
        title: 'Sessionful agent workspaces',
        description: 'Keep project-scoped sessions, canonical history, permission state, and live events behind one product-facing API.',
        path: 'introduction/embedding',
      },
      {
        title: 'Provider harness orchestration',
        description: 'Use the CLI harnesses tuned by model providers instead of rebuilding tool use, context handling, and approvals from raw APIs.',
        path: 'introduction/what-is-sna',
      },
      {
        title: 'Multi-runtime agent products',
        description: 'Let Claude Code, Codex, and OpenCode power the same product while SNA normalizes sessions, events, and permissions.',
        path: 'cookbook/multi-provider',
      },
    ],
    getStarted: 'Get started',
    viewGithub: 'View on GitHub',
    sections: [
      {
        title: 'Introduction',
        description: 'What SNA is, install, boot the server, send your first prompt, and learn the core concepts.',
        path: 'introduction',
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
      'Claude Code, Codex, OpenCode를 앱의 백엔드 런타임처럼 다루게 해주는 SDK. 세션, 이벤트, 권한 흐름을 하나로 맞춰 런타임 교체를 제품 코드 밖으로 밀어냅니다.',
    buildTitle: '에이전틱 애플리케이션 만들기',
    buildIntro:
      'SNA는 제품 안에 세션을 가진 에이전트 런타임을 넣어줍니다. 에이전트는 툴을 쓰고, 권한을 요청하고, 히스토리를 이어가며, 상태를 UI로 스트리밍합니다.',
    buildItems: [
      {
        title: '제품의 일부가 되는 에이전트',
        description: '옆에 붙인 챗봇이 아니라, 사용자의 작업 흐름 안에서 실행되는 에이전트 기능을 만들 수 있습니다.',
        path: 'introduction',
      },
      {
        title: '세션을 가진 에이전트 워크스페이스',
        description: '프로젝트별 세션, 정규화 히스토리, 권한 상태, 라이브 이벤트를 하나의 제품용 API 뒤에 둘 수 있습니다.',
        path: 'introduction/embedding',
      },
      {
        title: 'Provider harness 오케스트레이션',
        description: '낮은 수준의 모델 API 위에 툴 사용, 컨텍스트 처리, 승인 흐름을 직접 만들지 않고 모델 제공사가 다듬어 둔 CLI harness를 활용합니다.',
        path: 'introduction/what-is-sna',
      },
      {
        title: '멀티 런타임 에이전트 제품',
        description: 'Claude Code, Codex, OpenCode가 같은 제품을 구동하게 하면서 세션, 이벤트, 권한은 SNA가 하나로 맞춥니다.',
        path: 'cookbook/multi-provider',
      },
    ],
    getStarted: '시작하기',
    viewGithub: 'GitHub에서 보기',
    sections: [
      {
        title: 'Introduction',
        description: 'SNA의 역할, 설치, 서버 실행, 첫 프롬프트, 핵심 모델까지.',
        path: 'introduction',
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
        description: '스트리밍, 권한 UI, 멀티 런타임 세션, Electron 임베딩 패턴.',
        path: 'cookbook',
      },
    ],
  },
  ja: {
    eyebrow: 'Skills-Native Application SDK',
    tagline:
      'Claude Code、Codex、OpenCode をアプリのバックエンドランタイムとして扱うための SDK。セッション、イベント、権限フローをそろえ、ランタイム差分をプロダクトコードから切り離します。',
    buildTitle: 'エージェンティックアプリケーションを作る',
    buildIntro:
      'SNA は、セッションを持つエージェントランタイムをプロダクト内に置くための SDK です。エージェントはツールを使い、権限を求め、履歴を保ち、状態を UI に返せます。',
    buildItems: [
      {
        title: 'プロダクトの一部として動くエージェント',
        description: '横に置いたチャットボットではなく、ユーザーの作業フローの中で動くエージェント機能を作れます。',
        path: 'introduction',
      },
      {
        title: 'セッションを持つエージェントワークスペース',
        description: 'プロジェクト単位のセッション、正規化履歴、権限状態、ライブイベントを 1 つのプロダクト向け API の後ろに置けます。',
        path: 'introduction/embedding',
      },
      {
        title: 'Provider harness のオーケストレーション',
        description: '低レベルのモデル API の上にツール利用、コンテキスト処理、承認フローを作り直さず、model provider が調整した CLI harness を活用します。',
        path: 'introduction/what-is-sna',
      },
      {
        title: 'マルチランタイムエージェント製品',
        description: 'Claude Code、Codex、OpenCode で同じプロダクトを動かしつつ、セッション、イベント、権限は SNA が 1 つにそろえます。',
        path: 'cookbook/multi-provider',
      },
    ],
    getStarted: 'はじめる',
    viewGithub: 'GitHub で見る',
    sections: [
      {
        title: 'Introduction',
        description: 'SNA の役割、インストール、サーバ起動、最初のプロンプト、中心モデルまで。',
        path: 'introduction',
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
        description: 'ストリーミング、権限 UI、マルチランタイムセッション、Electron 組み込みパターン。',
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
            href={docHref(lang, 'introduction')}
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

      <section className="mx-auto max-w-5xl px-6 py-8">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {c.buildTitle}
          </h2>
          <p className="text-fd-muted-foreground mt-3 text-base leading-relaxed">
            {c.buildIntro}
          </p>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {c.buildItems.map((item) => (
            <Link
              key={item.path}
              href={docHref(lang, item.path)}
              className="border-fd-border hover:border-fd-foreground/30 hover:bg-fd-muted/40 rounded-lg border p-5 transition"
            >
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
                {item.description}
              </p>
            </Link>
          ))}
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
