import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cx(
          "fixed left-1/2 top-1/2 z-50 grid max-h-[88vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.36)]",
          className,
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-xl font-semibold tracking-normal text-[var(--fg)]">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-sm leading-6 text-[var(--fg-muted)]">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]">
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DialogHeader = forwardRef<
  ComponentRef<"div">,
  ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cx("grid gap-1", className)} {...props} />
));
DialogHeader.displayName = "DialogHeader";
