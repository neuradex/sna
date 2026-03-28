# SNA — Skills-Native Application SDK

**Claude Code をランタイムとして使うアプリケーションフレームワーク。**

従来のAIアプリは LLM API を呼び出してレスポンスをパースする。SNA はその逆 — Claude Code 自体がアプリのロジックを実行する。

```
従来:   あなたのコード → LLM API → パース → 実行
SNA:   SKILL.md → Claude Code → スクリプト → SQLite → SSE → UI
```

## 仕組み

1. ユーザーがアプリ内のチャットUIまたはターミナルでスキルを実行（例: `/form-register`）
2. Claude Code が `.claude/skills/<name>/SKILL.md` を読み、TypeScript スクリプトを実行
3. スクリプトがアプリの SQLite DB を読み書き
4. 実行中のイベント（開始・進捗・完了）を SDK 経由でリアルタイムにフロントエンドへ配信
5. フロントエンドが自動更新

## パッケージ

| パッケージ | npm名 | 役割 |
|---------|--------|------|
| `packages/core` | `@sna-sdk/core` | サーバーランタイム、DB、CLI、イベントパイプライン、プロバイダー |
| `packages/react` | `@sna-sdk/react` | React hooks、コンポーネント、ストア |

```bash
# ビルド
cd packages/core && pnpm build
cd packages/react && pnpm build
```

## アーキテクチャ

### DB 分離

SDK とアプリケーションは別々の SQLite データベースを使う。

| データベース | オーナー | 内容 |
|----------|---------|------|
| `data/sna.db` | SDK (`@sna-sdk/core`) | `skill_events` テーブル |
| `data/<app>.db` | アプリケーション | アプリ固有テーブル |

### イベントパイプライン

スキル実行のリアルタイム通知はすべて SDK が管理する。

```
スキル実行 → emit.js → sna.db → SSE → useSkillEvents → UI
```

```bash
# スキル内でイベントを発行
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill <name> --type start --message "開始..."

node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill <name> --type complete --message "完了"
```

イベントタイプ: `start` / `progress` / `milestone` / `complete` / `error`

### SDK サーバー

SDK はスタンドアロンの Hono サーバーを提供:

- `GET /events` — SSE ストリーム
- `POST /emit` — イベント書き込み
- `GET /health` — ヘルスチェック
- `POST /agent/start` — エージェントセッション開始

## アプリケーション開発

### 依存関係

```json
{
  "@sna-sdk/core": "link:../sna/packages/core",
  "@sna-sdk/react": "link:../sna/packages/react"
}
```

### フロントエンド

```tsx
import { SnaProvider } from "@sna-sdk/react/components/sna-provider";
import { useSkillEvents } from "@sna-sdk/react/hooks";

function App() {
  return (
    <SnaProvider>
      <YourApp />
    </SnaProvider>
  );
}
```

### スキル定義

`.claude/skills/<name>/SKILL.md` にスキルを定義する。Claude Code がこのファイルを読んで実行する。

```markdown
---
description: ユーザー登録フォームを自動入力する
---

## 手順

1. イベント発行: start
2. スクリプト実行: tsx scripts/fill-form.ts
3. イベント発行: complete
```

### Vite 開発設定

`conditions: ["source"]` を使うと、SDK のソースコードを直接参照できる。SDK 側でビルド不要。

```ts
// vite.config.ts
export default defineConfig({
  resolve: {
    conditions: ["source"],
  },
  optimizeDeps: {
    exclude: ["@sna-sdk/core", "@sna-sdk/react"],
  },
});
```

## Claude Code プラグイン

SNA アプリ開発を支援する Claude Code プラグインを同梱。SDK の規約（DB 分離、イベントパイプライン、importパス）を自動的に守るエージェント。

```bash
# ローカルテスト
claude --plugin-dir ./plugins/sna-builder

# マーケットプレイスからインストール
/plugin marketplace add neuradex/sna
/plugin install sna-builder@sna
```

## ドキュメント

- [Architecture](docs/architecture.md) — DB 分離、イベントパイプライン、パッケージ構造
- [Skill Authoring](docs/skill-authoring.md) — スキル作成ガイド
- [App Setup](docs/app-setup.md) — フロントエンド・サーバー・Vite 設定

## テックスタック

- TypeScript (strict)
- Hono (API サーバー)
- better-sqlite3 (ローカル SQLite, WAL モード)
- React 19 + Zustand
- Tailwind CSS v4
- tsup (ライブラリビルド)
- pnpm 10

## リポジトリ構造

```
sna/
├── packages/
│   ├── core/                  @sna-sdk/core
│   └── react/                 @sna-sdk/react
├── docs/                      SDK ドキュメント
├── plugins/
│   └── sna-builder/           Claude Code プラグイン
├── .claude-plugin/
│   └── marketplace.json       プラグインマーケットプレイス定義
├── pnpm-workspace.yaml
└── CLAUDE.md
```
