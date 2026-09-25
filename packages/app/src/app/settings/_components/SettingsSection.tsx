import type { ReactNode } from "react";

/** One stacked section: a heading and a one-line description over its body. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={`settings-${id}`}
      aria-labelledby={`settings-${id}-title`}
      className="scroll-mt-2 py-5 pb-7 not-first:shadow-[0_-1px_0_var(--neutral-border-subtle)]"
    >
      <h2
        id={`settings-${id}-title`}
        tabIndex={-1}
        className="text-[15px] font-semibold text-neutral-fg focus:outline-none"
      >
        {title}
      </h2>
      <p className="mt-0.5 mb-4 text-sm text-neutral-fg-subtle">
        {description}
      </p>
      {children}
    </section>
  );
}

/** A label on its own line above the value or control it names. */
export function SettingsField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-neutral-fg-subtle">
        {label}
      </span>
      {children}
      {hint && <p className="text-xs text-neutral-fg-subtle">{hint}</p>}
    </div>
  );
}

/** A row in a settings list: identity on the left, actions on the right. */
export function SettingsListRow({
  name,
  meta,
  actions,
}: {
  name: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2.5 transition-colors duration-150 not-first:shadow-[0_-1px_0_var(--neutral-border-subtle)] hover:bg-neutral-bg-subtle motion-reduce:transition-none">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-neutral-fg">
          {name}
        </div>
        {meta && (
          <div className="truncate text-xs text-neutral-fg-subtle">{meta}</div>
        )}
      </div>
      {actions && <div className="flex shrink-0 gap-1">{actions}</div>}
    </li>
  );
}
