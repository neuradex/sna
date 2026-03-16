# sna — Skills-Native Application

Claude Code をランタイムとして使うアプリケーションフレームワーク。

```
Traditional:  your code → LLM API → parse → act
SNA:          SKILL.md → Claude Code → scripts → SQLite → SSE → UI
```

## インストール

```bash
npm install sna
# or
pnpm add sna
```

## CLI

```bash
sna up          # 全サービス起動（DB初期化 → WebSocket → dev server）
sna down        # 全サービス停止
sna status      # 稼働状況表示
sna restart     # 再起動
sna init        # .claude/settings.json + skills 初期化
```

## ワークフローエンジン

低知能モデル（Haiku）がステップを飛ばしたりイベント発行を忘れる問題を解決する仕組み。
**CLI がステップ順序・データ検証・イベント発行を強制する。**

### 概念

従来の SKILL.md ベースの実行では、モデルが自由にスクリプトを実行し、自分でイベントを emit する。
ワークフローエンジンでは、`workflow.yml` で定義されたステップを CLI が管理し、
モデルは CLI の指示に従ってデータを提出するだけ。

```
                     ┌─────────────────────────────────────────┐
                     │              workflow.yml                │
                     │  step 1 (exec) → step 2 (instruction)  │
                     └──────────┬──────────────────────────────┘
                                │
          sna new ──────────────┤
                                ▼
                     ┌─────────────────────┐
                     │  CLI auto-executes   │ ← exec steps
                     │  curl, extract, emit │
                     └──────────┬──────────┘
                                │ stops at instruction
                                ▼
                     ┌─────────────────────┐
                     │  Model does work     │ ← searches, collects data
                     └──────────┬──────────┘
                                │
          sna <id> next ────────┤ ← submits JSON via stdin
                                ▼
                     ┌─────────────────────┐
                     │  CLI validates       │ ← schema check
                     │  CLI runs handler    │ ← curl to app API
                     │  CLI extracts result │ ← from API response
                     │  CLI emits event     │ ← to SQLite
                     └─────────────────────┘
```

### ステップタイプ

#### exec — CLI が自動実行

```yaml
- id: get-existing
  name: "既存データ確認"
  exec: "curl -s http://localhost:3000/api/targets"
  extract:
    existing_names: "[.[] | .company_name]"
  event: "既存データ確認完了"
```

- CLI がシェルコマンドを実行し、レスポンスからフィールドを抽出
- 連続する exec ステップは自動で全部実行（instruction で止まる）
- `extract` は簡易 jq: `.field`, `[.[] | .field]`, `.`

#### instruction — モデルが作業し、構造化データを提出

```yaml
- id: search
  name: "会社検索"
  instruction: |
    「{{query}}」で検索して JSON 配列で提出してください。
  submit:
    type: array
    items:
      company_name: { type: string, required: true }
      url: { type: string, required: true }
      form_url: { type: string, required: true }
      notes: { type: string }
  handler: |
    curl -s -X POST http://localhost:3000/api/targets/batch \
      -H 'Content-Type: application/json' -d '{{submitted}}'
  extract:
    registered: ".registered"
    skipped: ".skipped"
  event: "{{registered}}社を登録（{{skipped}}社スキップ）"
```

- `instruction` がモデルに表示される
- `submit` で受け取る JSON のスキーマを定義（`required` はデフォルト false）
- モデルは `sna <id> next <<'EOF' ... EOF` で JSON を stdin に渡す
- `handler` で CLI が API にリクエスト（`{{submitted}}` = JSON 文字列）
- `extract` で API レスポンスからフィールド抽出 → context に格納
- **API がソースオブトゥルース** — モデルの自己申告ではない

### データフロー

```
Model  ──stdin JSON──▶  CLI  ──validate──▶  CLI  ──handler(curl)──▶  App API
                                                                        │
                                                                    response
                                                                        │
                                                              CLI ◀──extract──┘
                                                                │
                                                          context に格納
                                                                │
                                                          event 発行 → SQLite
```

### CLI の使い方

```bash
# タスク生成（exec ステップは自動実行、instruction で停止）
sna new company-search --query "東京のSaaS企業"

# モデルが作業した後、構造化データを提出
sna 0317143052 next <<'EOF'
[
  {"company_name": "Foo Corp", "url": "https://foo.co", "form_url": "https://foo.co/contact"},
  {"company_name": "Bar Inc", "url": "https://bar.io", "form_url": "https://bar.io/inquiry"}
]
EOF

# スカラー値の提出（data パターン）
sna 0317143052 next --registered-count 8 --skipped-count 3

# タスク再開
sna 0317143052 start

# ヘルプ
sna help              # 全コマンド一覧
sna help workflow     # workflow.yml 仕様
sna help submit       # データ提出パターン
sna new --help        # new コマンドのヘルプ
```

### workflow.yml 完全仕様

```yaml
version: 1
skill: <skill-name>            # スキル名（.claude/skills/<name>/ と一致）

params:                          # "sna new" の CLI フラグ
  query:
    type: string                 # string | integer | number | boolean
    required: true

steps:
  - id: <unique-id>             # ステップ識別子
    name: "表示名"

    # --- exec ステップ ---
    exec: "shell command"        # {{param}} で context 値を参照
    extract:                     # JSON レスポンスからフィールド抽出
      key: ".json_field"
    event: "メッセージ {{key}}"   # milestone イベント

    # --- instruction ステップ ---
    instruction: |               # モデルに表示するテキスト
      {{param}} を使って作業してください。
    submit:                      # stdin JSON のスキーマ
      type: array                # array | object
      items:
        field: { type: string, required: true }
    handler: |                   # API 呼び出しテンプレート
      curl -s -X POST url -d '{{submitted}}'
    extract:                     # API レスポンスから抽出
      result: ".field"
    event: "{{result}}"

    # --- data (従来パターン) ---
    data:
      - key: count
        when: after              # before | after
        type: integer
        label: "件数"

complete: "完了メッセージ {{key}}"  # 全ステップ完了時
error: "エラー: {{error}}"         # エラー時（{{error}} は自動設定）
```

### タスク状態

`.sna/tasks/<task-id>.json` に保存。

```json
{
  "task_id": "0317143052",
  "skill": "company-search",
  "status": "in_progress",
  "started_at": "2026-03-17T14:30:52Z",
  "params": { "query": "東京のSaaS企業" },
  "context": { "query": "...", "existing_names": [...], "registered": 8 },
  "current_step": 1,
  "steps": {
    "get-existing": { "status": "completed" },
    "search": { "status": "in_progress" }
  }
}
```

### バリデーション

CLI が自動で検証する項目:

| 対象 | 検証内容 |
|------|---------|
| params | 型チェック、必須チェック |
| submit (stdin JSON) | JSON パース、配列/オブジェクト型、必須フィールド |
| data (CLI flags) | 型チェック（integer, number, boolean）、必須チェック |
| handler レスポンス | JSON パース、extract フィールド存在 |

エラー時は正しいフォーマットを再表示:
```
✗ バリデーションエラー:
  [0].company_name: 必須フィールドです

Example:
  sna <task-id> next <<'EOF'
  [{"company_name": "...", "url": "...", ...}]
  EOF
```

### イベントプロトコル

ワークフローエンジンが自動発行するイベント:

| タイミング | type | message |
|-----------|------|---------|
| `sna new` | `start` | Task {id} started |
| exec ステップ完了 | `milestone` | step.event の展開値 |
| handler 完了 | `milestone` | step.event の展開値 |
| 全ステップ完了 | `complete` | workflow.complete の展開値 |
| エラー発生 | `error` | workflow.error の展開値 |

イベントは SQLite `skill_events` テーブルに INSERT され、
フロントエンドが `/api/events` (SSE) で購読してリアルタイム UI 更新する。

## コンポーネント

| モジュール | インポート | 役割 |
|-----------|----------|------|
| SnaProvider | `sna/components/sna-provider` | ルートラッパー、ターミナルドロワー注入 |
| TerminalSpacer | `sna/components/terminal-spacer` | スクロールパディング |
| useSkillEvents | `sna/hooks` | SSE サブスクリプション |
| getDb | `sna/db/schema` | SQLite シングルトン |
| Hono routes | `sna/server/routes/*` | `/api/events`, `/api/emit`, `/api/run` |
| Terminal server | `sna/server/terminal` | WebSocket + node-pty |

## テックスタック

- TypeScript (ESM)
- Hono (API サーバー)
- better-sqlite3 (SQLite, WAL mode)
- js-yaml (workflow.yml パーサー)
- node-pty + WebSocket (ターミナル)
- React 18+ (コンポーネント)
- Zustand (ターミナルパネル状態)
- tsup (ビルド)
