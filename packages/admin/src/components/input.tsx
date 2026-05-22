import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const Input = forwardRef<
  ComponentRef<"input">,
  ComponentPropsWithoutRef<"input">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cx(
      "focus-ring h-10 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] px-3 text-sm text-[var(--fg)] shadow-sm transition placeholder:text-[var(--fg-faint)] hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
