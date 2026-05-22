import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { Check } from "lucide-react";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

type CheckboxProps = Omit<ComponentPropsWithoutRef<"button">, "checked" | "onChange" | "role"> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

export const Checkbox = forwardRef<
  ComponentRef<"button">,
  CheckboxProps
>(({ checked = false, className, disabled, onCheckedChange, onClick, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    role="checkbox"
    aria-checked={checked}
    data-state={checked ? "checked" : "unchecked"}
    disabled={disabled}
    className={cx(
      "focus-ring inline-flex size-4 shrink-0 items-center justify-center rounded border border-[var(--border-strong)] bg-[var(--panel-solid)] text-[var(--accent)] shadow-sm transition hover:border-[var(--accent-border)] data-[state=checked]:border-[var(--accent-border)] data-[state=checked]:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented && !disabled) onCheckedChange?.(!checked);
    }}
    {...props}
  >
    {checked ? <Check size={13} strokeWidth={3} /> : null}
  </button>
));
Checkbox.displayName = "Checkbox";
