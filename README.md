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
| `packages/core` | `@sna-sdk/core` | サーバーランタイム、DB、CLI、イベントパイプライン |
| `packages/react` | `@sna-sdk/react` | React hooks、コンポーネント、ストア |

## クイックスタート

```bash
pnpm install
cd packages/core && pnpm build
cd packages/react && pnpm build
```

アプリ側の設定は [App Setup ガイド](docs/app-setup.md) を参照。

## ドキュメント

| ドキュメント | 内容 |
|-----------|------|
| [Architecture](docs/architecture.md) | DB 分離、イベントパイプライン、パッケージ構造 |
| [Skill Authoring](docs/skill-authoring.md) | スキル作成ガイド |
| [App Setup](docs/app-setup.md) | フロントエンド・サーバー・Vite 設定 |
| [Contributing](CONTRIBUTING.md) | リポジトリ構造、キーファイル、テックスタック |

## Claude Code プラグイン

SNA アプリ開発を支援するプラグインを同梱。SDK の規約を自動的に守るエージェント。

```bash
# ローカルテスト
claude --plugin-dir ./plugins/sna-builder

# マーケットプレイスからインストール
/plugin marketplace add neuradex/sna
/plugin install sna-builder@sna
```
