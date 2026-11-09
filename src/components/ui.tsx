import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/format";

/**
 * Presentational primitives shared by every page.
 *
 * These components carry no hooks or state so both Server and Client
 * components can render them.
 */

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-muted text-muted ring-border-base",
  primary: "bg-primary-soft text-primary ring-primary/20",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-warning ring-warning/20",
  danger: "bg-danger-soft text-danger ring-danger/20",
  info: "bg-info-soft text-info ring-info/20",
};

const STATUS_TONES: Record<string, Tone> = {
  // Brief
  DRAFT: "neutral",
  OPEN: "info",
  CLOSED: "neutral",
  CANCELLED: "danger",
  // Invitation
  PENDING: "warning",
  ACCEPTED: "success",
  DECLINED: "danger",
  REVOKED: "neutral",
  // Quotation
  AI_DRAFT: "info",
  SUBMITTED: "info",
  UNDER_REVIEW: "warning",
  SHORTLISTED: "primary",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
  // Agreement / approval
  PENDING_APPROVAL: "warning",
  ACTIVE: "success",
  COMPLETED: "primary",
  APPROVED: "success",
  // Change request
  EXPIRED: "neutral",
  INCLUDED: "success",
  OUTSIDE_SCOPE: "warning",
  AMBIGUOUS: "info",
  // Milestone
  DELIVERED: "info",
  OVERDUE: "danger",
  // Deliverable
  UPLOADING: "warning",
  UPLOADED: "info",
  REVISION_REQUESTED: "warning",
  PROCESSING_FAILED: "danger",
  // Payment
  FAILED: "danger",
  REVIEW_REQUIRED: "warning",
  CAPTURED: "success",
  // Engagement & requirements
  DISCOVERY: "info",
  REQUIREMENTS: "warning",
  REQUIREMENTS_APPROVED: "success",
  AGREEMENT: "primary",
  IN_REVIEW: "warning",
  SUPERSEDED: "neutral",
  // Preferences
  PENDING_ACKNOWLEDGEMENT: "warning",
  CONFIRMED: "success",
};

export function statusTone(status: string | null | undefined): Tone {
  if (!status) return "neutral";
  return STATUS_TONES[status] ?? "neutral";
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {humanize(status)}
    </Badge>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-card border border-border-base bg-surface shadow-card", className)}>
      {children}
    </div>
  );
}

/**
 * The three product pillars, each with a quiet visual identity of its own.
 *
 * The accents are treatments rather than colours: a brass rule for the
 * editorial work, a sage wash for the secure work, a stone wash for the human
 * work. One system, three tones.
 */
export type Pillar = "agreement" | "delivery" | "relationship";

const PILLAR_CLASSES: Record<Pillar, string> = {
  agreement: "pillar-agreement",
  delivery: "pillar-delivery",
  relationship: "pillar-relationship",
};

export function PillarCard({
  pillar,
  children,
  className,
}: {
  pillar: Pillar;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-pillar={pillar}
      className={cn(
        "flex flex-col rounded-card border border-border-base bg-surface p-5 shadow-card",
        PILLAR_CLASSES[pillar],
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Small uppercase kicker. Brass marks the editorial pillar without shouting. */
export function PillarEyebrow({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "brass";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.16em]",
        tone === "brass" ? "text-brass-strong" : "text-muted-soft",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border-base px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

/**
 * The pillar treatments, carried into the app so the landing page's mental
 * model is honoured inside the product rather than abandoned at the door.
 */
const PILLAR_HEADER: Record<Pillar, string> = {
  agreement: "border-t-2 border-brass pt-4",
  delivery: "border-t-2 border-primary/35 pt-4",
  relationship: "border-t-2 border-border-strong pt-4",
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  pillar,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  pillar?: Pillar;
}) {
  return (
    <header
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-4",
        pillar ? PILLAR_HEADER[pillar] : undefined,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p> : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export const buttonStyles = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55",
  variant: {
    primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
    secondary: "border border-border-strong bg-surface text-foreground hover:bg-surface-muted",
    ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
    danger: "bg-danger text-danger-foreground hover:bg-danger/90",
    success: "bg-success text-success-foreground hover:bg-success/90",
    link: "text-primary underline-offset-4 hover:underline",
  },
  size: {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4",
    lg: "h-11 px-5",
  },
} as const;

export function buttonClass(
  variant: keyof typeof buttonStyles.variant = "primary",
  size: keyof typeof buttonStyles.size = "md",
  className?: string,
): string {
  return cn(buttonStyles.base, buttonStyles.variant[variant], buttonStyles.size[size], className);
}

export const inputClass =
  "w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-muted";

export const textareaClass = cn(inputClass, "min-h-24 resize-y leading-relaxed");

export const selectClass = cn(inputClass, "pr-8");

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-1 text-xs font-semibold text-foreground">
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-4 py-3 text-sm ring-1 ring-inset",
        TONE_CLASSES[tone],
        className,
      )}
      role={tone === "danger" ? "alert" : "status"}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn("leading-relaxed", title && "mt-1")}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-muted">{icon}</div> : null}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description ? <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden="true" />;
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <Card>
      <div className="space-y-3 p-5">
        <Skeleton className="h-4 w-1/3" />
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-3 w-full" />
        ))}
      </div>
    </Card>
  );
}

export function SkeletonList({ items = 3 }: { items?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: items }).map((_, index) => (
        <SkeletonCard key={index} rows={2} />
      ))}
    </div>
  );
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="tabular text-right text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-border-base", className)} />;
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-card border border-border-base bg-surface px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-lg font-semibold tracking-tight",
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-foreground",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
