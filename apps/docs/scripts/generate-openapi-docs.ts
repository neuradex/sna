import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';
import { createOpenApiApp } from '../../../packages/core/src/server/routes/openapi.ts';

type Method = 'get' | 'post' | 'patch' | 'delete';
type Locale = 'en' | 'ko' | 'ja';

interface Endpoint {
  method: Method;
  route: string;
  path: string;
  title: Record<Locale, string>;
  description: Record<Locale, string>;
}

const endpoints: Endpoint[] = [
  e('get', '/health', 'health/get', ['Health check', 'Health check', 'Health check'], ['Verify the SNA server is running.', 'SNA 서버가 실행 중인지 확인합니다.', 'SNA サーバが稼働しているか確認します。']),
  e('get', '/api/sna-port', 'api/sna-port/get', ['Get SNA API port', 'SNA API 포트 조회', 'SNA API ポート取得'], ['Return the dynamically allocated SNA API port.', '동적으로 할당된 SNA API 포트를 반환합니다.', '動的に割り当てられた SNA API ポートを返します。']),
  e('post', '/agent/sessions', 'agent/sessions/post', ['Create a session', '세션 생성', 'セッション作成'], ['Create an agent session record without starting a process.', '프로세스를 시작하지 않고 에이전트 세션 레코드를 생성합니다.', 'プロセスを開始せずにエージェントセッションレコードを作成します。']),
  e('get', '/agent/sessions', 'agent/sessions/get', ['List sessions', '세션 목록 조회', 'セッション一覧取得'], ['List agent sessions.', '에이전트 세션 목록을 조회합니다.', 'エージェントセッション一覧を取得します。']),
  e('patch', '/agent/sessions/{id}', 'agent/sessions/id/patch', ['Update session', '세션 갱신', 'セッション更新'], ['Update session metadata: label, meta, and cwd.', '세션의 label, meta, cwd를 갱신합니다.', 'セッションの label、meta、cwd を更新します。']),
  e('delete', '/agent/sessions/{id}', 'agent/sessions/id/delete', ['Remove a session', '세션 삭제', 'セッション削除'], ['Remove an agent session and its history.', '에이전트 세션과 히스토리를 삭제합니다.', 'エージェントセッションと履歴を削除します。']),
  e('post', '/agent/start', 'agent/start/post', ['Start agent', '에이전트 시작', 'エージェント開始'], ['Start an agent process inside a session.', '세션 안에서 에이전트 프로세스를 시작합니다.', 'セッション内でエージェントプロセスを開始します。']),
  e('post', '/agent/send', 'agent/send/post', ['Send message', '메시지 전송', 'メッセージ送信'], ['Send a message to the active agent. Images are supported.', '활성 에이전트에 메시지를 보냅니다. 이미지도 함께 전송할 수 있습니다.', 'アクティブなエージェントへメッセージを送信します。画像も送信できます。']),
  e('post', '/agent/restart', 'agent/restart/post', ['Restart agent', '에이전트 재시작', 'エージェント再起動'], ['Kill and re-spawn an agent.', '에이전트를 종료한 뒤 다시 spawn합니다.', 'エージェントを終了して再 spawn します。']),
  e('post', '/agent/resume', 'agent/resume/post', ['Resume session', '세션 재개', 'セッション再開'], ['Resume a session with database history injected.', 'DB 히스토리를 주입해 세션을 재개합니다.', 'DB 履歴を注入してセッションを再開します。']),
  e('post', '/agent/interrupt', 'agent/interrupt/post', ['Interrupt agent', '에이전트 중단', 'エージェント中断'], ['Interrupt the current agent turn.', '현재 에이전트 턴을 중단합니다.', '現在のエージェントターンを中断します。']),
  e('post', '/agent/set-model', 'agent/set-model/post', ['Set model', '모델 변경', 'モデル変更'], ['Change the model for a live session.', '실행 중인 세션의 모델을 변경합니다.', '実行中セッションのモデルを変更します。']),
  e('post', '/agent/set-permission-mode', 'agent/set-permission-mode/post', ['Set permission mode', '권한 모드 변경', '権限モード変更'], ['Change permission mode for a live session.', '실행 중인 세션의 권한 모드를 변경합니다.', '実行中セッションの権限モードを変更します。']),
  e('patch', '/agent/session', 'agent/session/patch', ['Patch session config', '세션 설정 patch', 'セッション設定 patch'], ['Apply a unified session config patch.', '통합 세션 설정 patch를 적용합니다.', '統一セッション設定 patch を適用します。']),
  e('post', '/agent/kill', 'agent/kill/post', ['Kill agent', '에이전트 종료', 'エージェント終了'], ['Kill the agent process while preserving the session record.', '세션 레코드는 유지하고 에이전트 프로세스를 종료합니다.', 'セッションレコードは残し、エージェントプロセスを終了します。']),
  e('get', '/agent/status', 'agent/status/get', ['Agent status', '에이전트 상태', 'エージェント状態'], ['Return a session status snapshot.', '세션 상태 스냅샷을 반환합니다.', 'セッション状態スナップショットを返します。']),
  e('post', '/agent/run-once', 'agent/run-once/post', ['Run once', '단발 실행', '単発実行'], ['Run one temporary agent execution and return the final result.', '임시 에이전트 실행을 한 번 수행하고 최종 결과를 반환합니다.', '一時的なエージェント実行を 1 回行い、最終結果を返します。']),
  e('post', '/agent/run-once/stream', 'agent/run-once/stream/post', ['Run once stream', '단발 실행 스트림', '単発実行ストリーム'], ['Run one temporary execution and stream AgentEvent objects over SSE.', '임시 실행을 한 번 수행하고 AgentEvent를 SSE로 스트리밍합니다.', '一時実行を 1 回行い、AgentEvent を SSE でストリーミングします。']),
  e('post', '/agent/completion', 'agent/completion/post', ['Completion', 'Completion', 'Completion'], ['Run a lightweight one-shot LLM completion without session management.', '세션 관리 없이 가벼운 단발 LLM completion을 실행합니다.', 'セッション管理なしで軽量な単発 LLM completion を実行します。']),
  e('post', '/agent/permission-request', 'agent/permission-request/post', ['Permission request', '권한 요청', '権限要求'], ['Submit a permission request and wait for a decision.', '권한 요청을 제출하고 결정을 기다립니다.', '権限要求を送信し、判断を待ちます。']),
  e('post', '/agent/permission-respond', 'agent/permission-respond/post', ['Permission respond', '권한 응답', '権限応答'], ['Approve or deny a pending permission request.', '대기 중인 권한 요청을 승인하거나 거부합니다.', '保留中の権限要求を承認または拒否します。']),
  e('get', '/agent/permission-pending', 'agent/permission-pending/get', ['Pending permissions', 'Pending 권한 요청', 'Pending 権限要求'], ['List pending permission requests.', '대기 중인 권한 요청 목록을 조회합니다.', '保留中の権限要求一覧を取得します。']),
  e('post', '/agent/list-models', 'agent/list-models/post', ['List models', '모델 목록 조회', 'モデル一覧取得'], ['Inspect available models for a provider runtime.', 'provider runtime에서 사용할 수 있는 모델을 조회합니다.', 'provider runtime で利用可能なモデルを調べます。']),
  e('get', '/agent/events', 'agent/events/get', ['Agent event SSE stream', '에이전트 이벤트 SSE 스트림', 'エージェントイベント SSE ストリーム'], ['Stream session AgentEvent objects over Server-Sent Events.', '세션 AgentEvent를 Server-Sent Events로 스트리밍합니다.', 'セッションの AgentEvent を Server-Sent Events でストリーミングします。']),
  e('get', '/chat/sessions', 'chat/sessions/get', ['List chat sessions', 'Chat 세션 목록 조회', 'Chat セッション一覧取得'], ['List chat sessions stored in the database.', 'DB에 저장된 chat 세션 목록을 조회합니다.', 'DB に保存された chat セッション一覧を取得します。']),
  e('post', '/chat/sessions', 'chat/sessions/post', ['Create chat session', 'Chat 세션 생성', 'Chat セッション作成'], ['Create a chat session in the database.', 'DB에 chat 세션을 생성합니다.', 'DB に chat セッションを作成します。']),
  e('delete', '/chat/sessions/{id}', 'chat/sessions/id/delete', ['Delete chat session', 'Chat 세션 삭제', 'Chat セッション削除'], ['Delete a chat session.', 'chat 세션을 삭제합니다.', 'chat セッションを削除します。']),
  e('get', '/chat/sessions/{id}/messages', 'chat/sessions/id/messages/get', ['List chat messages', 'Chat 메시지 목록 조회', 'Chat メッセージ一覧取得'], ['List messages for a chat session.', 'chat 세션의 메시지 목록을 조회합니다.', 'chat セッションのメッセージ一覧を取得します。']),
  e('post', '/chat/sessions/{id}/messages', 'chat/sessions/id/messages/post', ['Create chat message', 'Chat 메시지 생성', 'Chat メッセージ作成'], ['Append a normalized chat message.', '정규화된 chat 메시지를 추가합니다.', '正規化された chat メッセージを追加します。']),
  e('delete', '/chat/sessions/{id}/messages', 'chat/sessions/id/messages/delete', ['Clear chat messages', 'Chat 메시지 삭제', 'Chat メッセージ削除'], ['Clear all messages in a chat session.', 'chat 세션의 모든 메시지를 삭제합니다.', 'chat セッション内のすべてのメッセージを削除します。']),
  e('get', '/chat/images/{sessionId}/{filename}', 'chat/images/sessionid/filename/get', ['Serve image', '이미지 제공', '画像提供'], ['Serve a stored chat image embed.', '저장된 chat 이미지 embed를 제공합니다.', '保存済み chat 画像 embed を提供します。']),
];

function e(
  method: Method,
  route: string,
  pagePath: string,
  title: [string, string, string],
  description: [string, string, string],
): Endpoint {
  return {
    method,
    route,
    path: pagePath,
    title: { en: title[0], ko: title[1], ja: title[2] },
    description: { en: description[0], ko: description[1], ja: description[2] },
  };
}

const groups = [
  { en: 'System', ko: '시스템', ja: 'システム', pages: endpoints.slice(0, 2) },
  { en: 'Sessions', ko: '세션', ja: 'セッション', pages: endpoints.slice(2, 6) },
  { en: 'Agent lifecycle', ko: '에이전트 라이프사이클', ja: 'エージェントライフサイクル', pages: endpoints.slice(6, 16) },
  { en: 'One-shot calls', ko: '단발 호출', ja: '単発呼び出し', pages: endpoints.slice(16, 19) },
  { en: 'Permissions', ko: '권한', ja: '権限', pages: endpoints.slice(19, 22) },
  { en: 'Models and events', ko: '모델과 이벤트', ja: 'モデルとイベント', pages: endpoints.slice(22, 24) },
  { en: 'Chat history', ko: 'Chat 히스토리', ja: 'Chat 履歴', pages: endpoints.slice(24) },
];

const dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(dirname, '..');
const repoRoot = path.resolve(docsRoot, '../..');
const schemaDir = path.join(docsRoot, 'openapi');
const endpointsDir = path.join(docsRoot, 'content/docs/api/endpoints');

async function writeOpenApiSchema() {
  const app = await createOpenApiApp();
  const packageJson = JSON.parse(
    await fs.readFile(path.join(repoRoot, 'packages/core/package.json'), 'utf8'),
  ) as { version?: string };
  const document = app.getOpenAPIDocument({
    openapi: '3.1.0',
    info: {
      title: 'SNA SDK API',
      version: packageJson.version ?? '0.0.0',
      description:
        'Skills-Native Application SDK — HTTP API for spawning and communicating with AI agent providers (Claude Code, Codex, OpenCode).',
    },
  });

  for (const endpoint of endpoints) {
    const operation = document.paths?.[endpoint.route]?.[endpoint.method];
    if (!operation) continue;
    operation.operationId ??= `${endpoint.method}_${endpoint.path.replaceAll('/', '_').replaceAll('-', '_')}`;
    operation.tags = [findGroup(endpoint.path).en];
  }

  document.tags = groups.map((group) => ({ name: group.en }));

  await fs.mkdir(schemaDir, { recursive: true });
  for (const locale of ['en', 'ko', 'ja'] as const) {
    await fs.writeFile(
      path.join(schemaDir, `sna${locale === 'en' ? '' : `.${locale}`}.json`),
      `${JSON.stringify(localizeDocument(document, locale), null, 2)}\n`,
    );
  }
}

function localizeDocument(document: any, locale: Locale) {
  const localized = structuredClone(document);
  localized.info = {
    ...localized.info,
    description: {
      en: 'Skills-Native Application SDK — HTTP API for spawning and communicating with AI agent providers (Claude Code, Codex, OpenCode).',
      ko: 'Skills-Native Application SDK — AI agent provider(Claude Code, Codex, OpenCode)를 backend process로 spawn하고 통신하기 위한 HTTP API입니다.',
      ja: 'Skills-Native Application SDK — AI agent provider (Claude Code、Codex、OpenCode) を backend process として spawn し、通信するための HTTP API です。',
    }[locale],
  };
  localized.servers = [
    {
      url: 'http://localhost:3099',
      description: {
        en: 'Local SNA server',
        ko: '로컬 SNA 서버',
        ja: 'ローカル SNA サーバ',
      }[locale],
    },
  ];
  localized.tags = groups.map((group) => ({ name: group[locale] }));

  for (const endpoint of endpoints) {
    const operation = localized.paths?.[endpoint.route]?.[endpoint.method];
    if (!operation) continue;

    operation.summary = endpoint.title[locale];
    operation.description = endpoint.description[locale];
    operation.tags = [findGroup(endpoint.path)[locale]];
    localizeResponses(operation.responses, locale);
  }

  return localized;
}

function localizeResponses(responses: Record<string, { description?: string }> | undefined, locale: Locale) {
  if (!responses || locale === 'en') return;

  const translations: Record<string, Partial<Record<Locale, string>>> = {
    'Server is healthy.': { ko: '서버가 정상입니다.', ja: 'サーバは正常です。' },
    'Port number.': { ko: '포트 번호입니다.', ja: 'ポート番号です。' },
    'SNA API not running.': { ko: 'SNA API가 실행 중이 아닙니다.', ja: 'SNA API が実行されていません。' },
    'Session created.': { ko: '세션이 생성되었습니다.', ja: 'セッションが作成されました。' },
    'Session list.': { ko: '세션 목록입니다.', ja: 'セッション一覧です。' },
    'Session updated.': { ko: '세션이 갱신되었습니다.', ja: 'セッションが更新されました。' },
    'Session removed.': { ko: '세션이 삭제되었습니다.', ja: 'セッションが削除されました。' },
    'Session not found.': { ko: '세션을 찾을 수 없습니다.', ja: 'セッションが見つかりません。' },
    'Internal server error.': { ko: '서버 내부 오류입니다.', ja: 'サーバ内部エラーです。' },
    'Agent started or already running.': { ko: '에이전트가 시작되었거나 이미 실행 중입니다.', ja: 'エージェントが開始済み、または既に実行中です。' },
    'Start failed.': { ko: '시작에 실패했습니다.', ja: '開始に失敗しました。' },
    'Message sent.': { ko: '메시지를 전송했습니다.', ja: 'メッセージを送信しました。' },
    'No active session or empty message.': { ko: '활성 세션이 없거나 메시지가 비어 있습니다.', ja: 'アクティブなセッションがないか、メッセージが空です。' },
    'Agent restarted.': { ko: '에이전트를 재시작했습니다.', ja: 'エージェントを再起動しました。' },
    'Restart failed.': { ko: '재시작에 실패했습니다.', ja: '再起動に失敗しました。' },
    'Session resumed.': { ko: '세션을 재개했습니다.', ja: 'セッションを再開しました。' },
    'Resume failed.': { ko: '재개에 실패했습니다.', ja: '再開に失敗しました。' },
    'Interrupted.': { ko: '중단했습니다.', ja: '中断しました。' },
    'Model updated.': { ko: '모델을 갱신했습니다.', ja: 'モデルを更新しました。' },
    'Permission mode updated.': { ko: '권한 모드를 갱신했습니다.', ja: '権限モードを更新しました。' },
    'Patch applied.': { ko: 'Patch가 적용되었습니다.', ja: 'Patch が適用されました。' },
    'Agent killed.': { ko: '에이전트를 종료했습니다.', ja: 'エージェントを終了しました。' },
    'Session status.': { ko: '세션 상태입니다.', ja: 'セッション状態です。' },
    'Execution result.': { ko: '실행 결과입니다.', ja: '実行結果です。' },
    'Missing message.': { ko: '`message`가 없습니다.', ja: '`message` がありません。' },
    'Execution failed or timed out.': { ko: '실행 실패 또는 timeout입니다.', ja: '実行失敗、または timeout です。' },
    'Completion result with usage and cost.': { ko: '사용량과 비용을 포함한 completion 결과입니다.', ja: '使用量とコストを含む completion 結果です。' },
    'Missing prompt.': { ko: '`prompt`가 없습니다.', ja: '`prompt` がありません。' },
    'Completion failed.': { ko: 'Completion에 실패했습니다.', ja: 'Completion に失敗しました。' },
    'Permission decision result.': { ko: '권한 결정 결과입니다.', ja: '権限判断結果です。' },
    'Permission responded.': { ko: '권한 요청에 응답했습니다.', ja: '権限要求に応答しました。' },
    'No pending permission.': { ko: '대기 중인 권한 요청이 없습니다.', ja: '保留中の権限要求がありません。' },
    'Pending permissions.': { ko: '대기 중인 권한 요청입니다.', ja: '保留中の権限要求です。' },
    'Available models for the runtime.': { ko: 'runtime에서 사용 가능한 모델입니다.', ja: 'runtime で利用可能なモデルです。' },
    'Unknown runtime.': { ko: '알 수 없는 runtime입니다.', ja: '不明な runtime です。' },
    'listModels call failed.': { ko: 'listModels 호출에 실패했습니다.', ja: 'listModels 呼び出しに失敗しました。' },
    'Chat sessions.': { ko: 'Chat 세션 목록입니다.', ja: 'Chat セッション一覧です。' },
    'Chat session created.': { ko: 'Chat 세션이 생성되었습니다.', ja: 'Chat セッションが作成されました。' },
    'Chat session deleted.': { ko: 'Chat 세션이 삭제되었습니다.', ja: 'Chat セッションが削除されました。' },
    'Chat messages.': { ko: 'Chat 메시지 목록입니다.', ja: 'Chat メッセージ一覧です。' },
    'Message created.': { ko: '메시지가 생성되었습니다.', ja: 'メッセージが作成されました。' },
    'Messages cleared.': { ko: '메시지가 삭제되었습니다.', ja: 'メッセージが削除されました。' },
    'Image binary.': { ko: '이미지 바이너리입니다.', ja: '画像バイナリです。' },
    'Image not found.': { ko: '이미지를 찾을 수 없습니다.', ja: '画像が見つかりません。' },
    'Database error.': { ko: '데이터베이스 오류입니다.', ja: 'データベースエラーです。' },
  };

  for (const response of Object.values(responses)) {
    if (!response.description) continue;
    response.description = translations[response.description]?.[locale] ?? response.description;
  }
}

function findGroup(endpointPath: string) {
  const group = groups.find((candidate) =>
    candidate.pages.some((endpoint) => endpoint.path === endpointPath),
  );
  if (!group) throw new Error(`Missing endpoint group: ${endpointPath}`);
  return group;
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const current = path.join(dir, entry.name);
      return entry.isDirectory() ? collectFiles(current) : [current];
    }),
  );
  return files.flat();
}

async function writeMetaFiles() {
  const localized = {
    en: { suffix: '', title: 'Endpoint Reference', description: 'OpenAPI-rendered HTTP endpoint reference.' },
    ko: { suffix: '.ko', title: '엔드포인트 레퍼런스', description: 'OpenAPI에서 렌더링한 HTTP 엔드포인트 레퍼런스입니다.' },
    ja: { suffix: '.ja', title: 'エンドポイントリファレンス', description: 'OpenAPI からレンダリングした HTTP エンドポイントリファレンスです。' },
  } as const;

  for (const [locale, info] of Object.entries(localized)) {
    const pages: string[] = ['index'];
    for (const group of groups) {
      pages.push(`---${group[locale as keyof typeof localized] ?? group.en}---`);
      pages.push(...group.pages.map((endpoint) => endpoint.path));
    }

    await fs.writeFile(
      path.join(endpointsDir, `meta${info.suffix}.json`),
      `${JSON.stringify({ title: info.title, description: info.description, icon: 'Route', pages }, null, 2)}\n`,
    );
  }
}

async function writeIndexPages() {
  const localized = {
    en: {
      suffix: '',
      base: '/docs/api/endpoints',
      title: 'Endpoint reference',
      description: 'OpenAPI-rendered HTTP endpoint reference.',
      intro:
        'These pages are generated from the same OpenAPI document served by the SNA runtime. Each endpoint page renders request parameters, request bodies, responses, schemas, and example request snippets from the schema.',
    },
    ko: {
      suffix: '.ko',
      base: '/ko/docs/api/endpoints',
      title: '엔드포인트 레퍼런스',
      description: 'OpenAPI에서 렌더링한 HTTP 엔드포인트 레퍼런스입니다.',
      intro:
        '이 페이지들은 SNA runtime이 제공하는 것과 같은 OpenAPI 문서에서 생성됩니다. 각 엔드포인트 페이지는 요청 파라미터, 요청 본문, 응답, schema, 예제 요청 snippet을 schema에서 렌더링합니다.',
    },
    ja: {
      suffix: '.ja',
      base: '/ja/docs/api/endpoints',
      title: 'エンドポイントリファレンス',
      description: 'OpenAPI からレンダリングした HTTP エンドポイントリファレンスです。',
      intro:
        'これらのページは、SNA runtime が提供するものと同じ OpenAPI ドキュメントから生成されます。各エンドポイントページは、リクエストパラメータ、リクエスト本文、レスポンス、schema、リクエスト例 snippet を schema からレンダリングします。',
    },
  } as const;

  for (const [locale, info] of Object.entries(localized)) {
    let content = `---\ntitle: ${info.title}\ndescription: ${info.description}\nicon: Route\n---\n\n${info.intro}\n\n`;

    for (const group of groups) {
      content += `## ${group[locale as keyof typeof localized] ?? group.en}\n\n<Cards>\n`;
      for (const endpoint of group.pages) {
        content += `  <Card title="${endpoint.method.toUpperCase()} ${endpoint.route}" href="${info.base}/${endpoint.path}" />\n`;
      }
      content += '</Cards>\n\n';
    }

    await fs.writeFile(path.join(endpointsDir, `index${info.suffix}.mdx`), content);
  }
}

async function main() {
  await writeOpenApiSchema();
  await fs.rm(endpointsDir, { recursive: true, force: true });

  await generateOpenApiPages('en', endpointsDir);
  await generateLocalizedOpenApiPages('ko');
  await generateLocalizedOpenApiPages('ja');
  await writeMetaFiles();
  await writeIndexPages();
}

async function generateOpenApiPages(locale: Locale, output: string) {
  const openapi = createOpenAPI({
    input: [`./openapi/sna${locale === 'en' ? '' : `.${locale}`}.json`],
  });

  await generateFiles({
    input: openapi,
    output,
    groupBy: 'route',
    includeDescription: true,
    meta: false,
  });
}

async function generateLocalizedOpenApiPages(locale: Exclude<Locale, 'en'>) {
  const output = path.join(docsRoot, `.openapi-${locale}`);
  await fs.rm(output, { recursive: true, force: true });
  await generateOpenApiPages(locale, output);

  const files = await collectFiles(output);
  for (const file of files.filter((candidate) => candidate.endsWith('.mdx'))) {
    const relative = path.relative(output, file);
    const destination = path.join(endpointsDir, relative.replace(/\.mdx$/, `.${locale}.mdx`));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(file, destination);
  }

  await fs.rm(output, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
