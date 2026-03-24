interface BadgeProps {
  variant: "running" | "idle" | "error" | "attention";
  children: React.ReactNode;
}

const variantClasses: Record<BadgeProps["variant"], string> = {
  running: "bg-badge-running text-text-inverse",
  idle: "bg-badge-idle text-text-inverse",
  error: "bg-badge-error text-text-inverse",
  attention: "bg-badge-attention text-text-inverse",
};

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${variantClasses[variant]}`}
    >
      {children}
    </span>
  );
}
