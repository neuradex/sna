"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            sideOffset={6}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              background: "#1a1a2e",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              color: "rgba(255,255,255,0.8)",
              fontSize: 11,
              fontFamily: "var(--sna-font-mono)",
              whiteSpace: "nowrap",
              zIndex: 9999,
              animationDuration: "0.15s",
            }}
          >
            {content}
            <TooltipPrimitive.Arrow
              style={{ fill: "#1a1a2e" }}
              width={10}
              height={5}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
