import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import { ChatInput } from "../src/components/chat/chat-input.js";
import { MessageBubble } from "../src/components/chat/message-bubble.js";
import { ResizeHandle } from "../src/components/chat/resize-handle.js";
import { ThinkingCard } from "../src/components/chat/thinking-card.js";
import { ToolUseCard } from "../src/components/chat/tool-use-card.js";
import { TypingIndicator } from "../src/components/chat/typing-indicator.js";
import type { ChatMessage } from "../src/stores/chat-store.js";

type Listener = (event?: any) => void;

const originalDocument = globalThis.document;
const mounted = new Set<ReactTestRenderer>();

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function chatMessage(role: ChatMessage["role"], content: string, meta?: Record<string, unknown>): ChatMessage {
  return {
    id: `${role}-1`,
    role,
    content,
    timestamp: 1,
    meta,
  };
}

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  mounted.add(renderer);
  return renderer;
}

function textOf(node: ReactTestRendererJSON | ReactTestRendererJSON[] | null): string {
  if (!node) return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node.props?.dangerouslySetInnerHTML?.__html) {
    return String(node.props.dangerouslySetInnerHTML.__html);
  }
  return node.children?.map((child) => typeof child === "string" ? child : textOf(child)).join("") ?? "";
}

function installDocument() {
  const listeners = new Map<string, Set<Listener>>();
  const document = {
    body: { style: {} as Record<string, string> },
    addEventListener(type: string, listener: Listener) {
      const existing = listeners.get(type) ?? new Set();
      existing.add(listener);
      listeners.set(type, existing);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  return { document, listeners };
}

afterEach(async () => {
  for (const renderer of mounted) {
    await act(async () => {
      renderer.unmount();
    });
  }
  mounted.clear();

  Object.defineProperty(globalThis, "document", {
    value: originalDocument,
    configurable: true,
  });
});

describe("Composable chat components", () => {
  it("ChatInput sends trimmed text and blocks empty or disabled sends", async () => {
    const sent: string[] = [];
    const renderer = await render(React.createElement(ChatInput, {
      disabled: false,
      onSend: (text: string) => sent.push(text),
    }));

    const textarea = renderer.root.findByType("textarea");
    await act(async () => {
      textarea.props.onChange({ target: { value: "  hello agent  " } });
    });
    await act(async () => {
      renderer.root.findByType("button").props.onClick();
    });

    assert.deepEqual(sent, ["hello agent"]);
    assert.equal(renderer.root.findByType("textarea").props.value, "");

    await act(async () => {
      renderer.root.findByType("button").props.onClick();
    });
    assert.deepEqual(sent, ["hello agent"]);

    await act(async () => {
      renderer.update(React.createElement(ChatInput, {
        disabled: true,
        onSend: (text: string) => sent.push(text),
      }));
    });
    await act(async () => {
      renderer.root.findByType("textarea").props.onChange({ target: { value: "blocked" } });
      renderer.root.findByType("button").props.onClick();
    });
    assert.deepEqual(sent, ["hello agent"]);
  });

  it("MessageBubble renders documented message roles", async () => {
    const roles: Array<[ChatMessage["role"], string]> = [
      ["user", "user text"],
      ["assistant", "assistant text"],
      ["status", "status text"],
      ["error", "error text"],
      ["tool_result", "tool result text"],
    ];

    for (const [role, content] of roles) {
      const renderer = await render(React.createElement(MessageBubble, {
        message: chatMessage(role, content),
      }));
      assert.match(textOf(renderer.toJSON()), new RegExp(content));
    }
  });

  it("ThinkingCard and ToolUseCard expose expandable details", async () => {
    const thinking = await render(React.createElement(ThinkingCard, {
      message: chatMessage("thinking", "private reasoning", { done: true }),
    }));
    assert.match(textOf(thinking.toJSON()), /Thought/);
    await act(async () => {
      thinking.root.findByType("button").props.onClick();
    });
    assert.match(textOf(thinking.toJSON()), /private reasoning/);

    const tool = await render(React.createElement(ToolUseCard, {
      message: chatMessage("tool", "Bash", {
        toolName: "Bash",
        input: { command: "pnpm test" },
        result: "all tests passed",
      }),
    }));
    assert.match(textOf(tool.toJSON()), /Bash/);
    assert.match(textOf(tool.toJSON()), /pnpm test/);
    await act(async () => {
      tool.root.findAll((node) => typeof node.props.onClick === "function")[0].props.onClick();
    });
    assert.match(textOf(tool.toJSON()), /all tests passed/);
  });

  it("ResizeHandle translates mouse movement into width changes and cleans document state", async () => {
    const { document, listeners } = installDocument();
    const widths: number[] = [];
    const renderer = await render(React.createElement(ResizeHandle, {
      currentWidth: 360,
      onResize: (width: number) => widths.push(width),
    }));

    await act(async () => {
      renderer.root.findByType("div").props.onMouseDown({
        clientX: 100,
        preventDefault() {},
      });
    });

    assert.equal(document.body.style.cursor, "col-resize");
    listeners.get("mousemove")?.forEach((listener) => listener({ clientX: 80 }));
    assert.deepEqual(widths, [380]);
    listeners.get("mouseup")?.forEach((listener) => listener());
    assert.equal(document.body.style.cursor, "");
    assert.equal(document.body.style.userSelect, "");
  });

  it("TypingIndicator renders progress copy without a DOM document", async () => {
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true });

    const renderer = await render(React.createElement(TypingIndicator));

    assert.match(textOf(renderer.toJSON()), /Thinking/);
  });
});
