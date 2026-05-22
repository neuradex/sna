import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const Button = forwardRef<
  ComponentRef<"button">,
  ComponentPropsWithoutRef<"button">
>(({ className, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cx("focus-ring", className)}
    {...props}
  />
));
Button.displayName = "Button";
