import { cn } from "@/lib/utils";

// The one empty-state pattern: a flat dashed panel with a title, a hint and an optional action. Reuse it on every empty list.
export function EmptyState({ title, description, children, className }: {
  title: string; description?: React.ReactNode; children?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-dashed border-input px-4 py-8 text-center", className)}>
      <p className="font-semibold">{title}</p>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {children && <div className="mt-3 flex justify-center">{children}</div>}
    </div>
  );
}
