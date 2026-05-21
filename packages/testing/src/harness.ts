import { startMockAnthropicServer, type MockServer } from "./mock-api.js";
import { startMockOpenAIServer, type MockOpenAIOptions, type MockOpenAIServer } from "./mock-openai.js";

export interface WaitForRequestOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export async function readSseData(res: Response): Promise<string[]> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("text/event-stream")) {
    throw new Error(`Expected text/event-stream response, got ${contentType || "(missing content-type)"}`);
  }
  const raw = await res.text();
  return raw
    .split("\n\n")
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
}

export async function waitForRequest<TRequest>(
  source: { requests: TRequest[] },
  predicate: (request: TRequest) => boolean = () => true,
  options: WaitForRequestOptions = {},
): Promise<TRequest> {
  const timeoutMs = options.timeoutMs ?? 1_000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const found = source.requests.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for mock request after ${timeoutMs}ms`);
}

export async function withMockAnthropicServer<T>(
  fn: (mock: MockServer) => Promise<T> | T,
): Promise<T> {
  const mock = await startMockAnthropicServer();
  try {
    return await fn(mock);
  } finally {
    mock.close();
  }
}

export async function withMockOpenAIServer<T>(
  options: MockOpenAIOptions,
  fn: (mock: MockOpenAIServer) => Promise<T> | T,
): Promise<T>;
export async function withMockOpenAIServer<T>(
  fn: (mock: MockOpenAIServer) => Promise<T> | T,
): Promise<T>;
export async function withMockOpenAIServer<T>(
  optionsOrFn: MockOpenAIOptions | ((mock: MockOpenAIServer) => Promise<T> | T),
  maybeFn?: (mock: MockOpenAIServer) => Promise<T> | T,
): Promise<T> {
  const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  if (!fn) throw new Error("withMockOpenAIServer requires a callback");

  const mock = await startMockOpenAIServer(options);
  try {
    return await fn(mock);
  } finally {
    await mock.close();
  }
}
