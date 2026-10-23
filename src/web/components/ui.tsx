import React, { useEffect, useRef, useState } from 'react';
import { Collapsible, Dialog, DropdownMenu, Slider, Switch as RSwitch, Tooltip } from 'radix-ui';
import { ChevronDown, LoaderCircle, X } from 'lucide-react';
import { cn, clamp } from '../lib/utils';

// ---------------------------------------------------------------------------
// Tooltip & icon buttons
// ---------------------------------------------------------------------------

export const Tip: React.FC<{ label: React.ReactNode; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: React.ReactElement }> = ({
  label,
  shortcut,
  side = 'bottom',
  children,
}) => (
  <Tooltip.Root delayDuration={350}>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        side={side}
        sideOffset={6}
        className="glass-pop z-[100] flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-text"
      >
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);

export const IconBtn = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean; side?: 'top' | 'bottom' | 'left' | 'right' }
>(({ label, shortcut, active, side, className, children, ...rest }, ref) => (
  <Tip label={label} shortcut={shortcut} side={side}>
    <button
      ref={ref}
      aria-label={label}
      className={cn('btn btn-ghost btn-icon text-muted hover:text-text', active && 'bg-accent/15 text-accent-ink hover:text-accent-ink', className)}
      {...rest}
    >
      {children}
    </button>
  </Tip>
));
IconBtn.displayName = 'IconBtn';

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="rounded border border-line-2 bg-panel-2 px-1 font-mono text-[10px] text-muted">{children}</kbd>
);

export const Spinner: React.FC<{ className?: string }> = ({ className }) => <LoaderCircle className={cn('size-4 animate-spin', className)} />;

export const ProgressBar: React.FC<{ value: number; className?: string; tone?: 'accent' | 'ok' | 'danger' }> = ({ value, className, tone = 'accent' }) => (
  <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-panel-3', className)}>
    <div
      className={cn('h-full rounded-full transition-[width] duration-300', tone === 'ok' ? 'bg-ok' : tone === 'danger' ? 'bg-danger' : 'bg-gradient-to-r from-accent to-accent-2')}
      style={{ width: `${clamp(value, 0, 1) * 100}%` }}
    />
  </div>
);

export const Empty: React.FC<{ icon?: React.ReactNode; title: string; children?: React.ReactNode; className?: string }> = ({ icon, title, children, className }) => (
  <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-10 text-center', className)}>
    {icon && <div className="tile size-14 rounded-2xl text-accent-2">{icon}</div>}
    <div className="font-semibold text-text">{title}</div>
    {children && <div className="max-w-xs text-xs leading-relaxed text-muted">{children}</div>}
  </div>
);

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export const Modal: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}> = ({ open, onOpenChange, title, description, children, footer, className, bodyClassName }) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-[#03040a]/55 backdrop-blur-md" />
      <Dialog.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 glass-pop flex-col overflow-hidden rounded-2xl outline-none',
          className,
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="brand-hairline flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <Dialog.Title className="text-base font-bold">{title}</Dialog.Title>
            {description ? <Dialog.Description className="mt-0.5 text-xs text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{String(title)}</Dialog.Description>}
          </div>
          <Dialog.Close className="btn btn-ghost btn-icon text-muted" aria-label="Close">
            <X className="size-4" />
          </Dialog.Close>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export const Menu: React.FC<{ trigger: React.ReactElement; items: (MenuItem | 'separator')[]; align?: 'start' | 'end' }> = ({ trigger, items, align = 'end' }) => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={align} sideOffset={4} className="glass-pop z-[90] min-w-44 rounded-xl p-1">
        {items.map((it, i) =>
          it === 'separator' ? (
            <DropdownMenu.Separator key={i} className="my-1 h-px bg-line" />
          ) : (
            <DropdownMenu.Item
              key={i}
              disabled={it.disabled}
              onSelect={it.onSelect}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-panel-3',
                it.danger && 'text-danger',
              )}
            >
              {it.icon && <span className={cn('[&>svg]:size-4', it.danger ? 'text-danger' : 'text-accent-2-ink')}>{it.icon}</span>}
              {it.label}
            </DropdownMenu.Item>
          ),
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export const Field: React.FC<{ label?: React.ReactNode; hint?: React.ReactNode; className?: string; children: React.ReactNode; inline?: boolean }> = ({ label, hint, className, children, inline }) =>
  inline ? (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      {label && <span className="text-xs text-muted">{label}</span>}
      {children}
    </div>
  ) : (
    <div className={cn('flex flex-col', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 text-[11px] leading-snug text-dim">{hint}</span>}
    </div>
  );

export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean; className?: string }> = ({ checked, onChange, label, disabled, className }) => (
  <label className={cn('flex cursor-pointer items-center justify-between gap-3 text-[13px]', disabled && 'cursor-not-allowed opacity-50', className)}>
    {label && <span className="text-muted">{label}</span>}
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className="relative h-[18px] w-8 shrink-0 rounded-full bg-panel-3 transition-colors data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-accent data-[state=checked]:to-[#ff8a4c] data-[state=checked]:shadow-[0_0_12px_-2px_rgb(255_90_31/0.7)]"
    >
      <RSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[16px]" />
    </RSwitch.Root>
  </label>
);

/** Text input that keeps its own draft and commits on change (debounced by the caller) or blur. */
export const TextInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  commit?: 'change' | 'blur';
  type?: string;
  autoFocus?: boolean;
  mono?: boolean;
}> = ({ value, onChange, placeholder, className, commit = 'change', type = 'text', autoFocus, mono }) => {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      type={type}
      value={draft}
      autoFocus={autoFocus}
      placeholder={placeholder}
      spellCheck={false}
      className={cn('field', mono && 'font-mono text-xs', className)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (commit === 'blur' && draft !== value) onChange(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && commit === 'blur') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (commit === 'change') onChange(e.target.value);
      }}
    />
  );
};

export const TextArea: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  mono?: boolean;
  commit?: 'change' | 'blur';
}> = ({ value, onChange, placeholder, className, rows = 3, mono, commit = 'change' }) => {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      value={draft}
      rows={rows}
      placeholder={placeholder}
      spellCheck={!mono}
      className={cn('field', mono && 'font-mono text-xs leading-relaxed', className)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (commit === 'blur' && draft !== value) onChange(draft);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (commit === 'change') onChange(e.target.value);
      }}
    />
  );
};

/**
 * Number input with a draggable label (scrub horizontally to change the value),
 * committing on Enter/blur.
 */
export const NumberField: React.FC<{
  label?: string;
  value: number | undefined;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  precision?: number;
  className?: string;
  placeholder?: string;
}> = ({ label, value, onChange, min = -Infinity, max = Infinity, step = 1, unit, precision = 2, className, placeholder }) => {
  const fmt = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? '' : String(Math.round(v * 10 ** precision) / 10 ** precision));
  const [draft, setDraft] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || Number.isNaN(n)) return setDraft(fmt(value));
    const v = clamp(n, min, max);
    setDraft(fmt(v));
    if (v !== value) onChange(v);
  };
  const scrub = (e: React.PointerEvent) => {
    if (value === undefined) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value;
    let last = start;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const mult = (ev.shiftKey ? 10 : 1) * (ev.altKey ? 0.1 : 1);
      const v = Number(clamp(start + Math.round(dx / 3) * step * mult, min, max).toFixed(precision));
      if (v !== last) {
        last = v;
        setDraft(fmt(v));
        onChange(v);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <label className={cn('flex min-w-0 items-center rounded-lg border border-line bg-black/28 shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] focus-within:border-accent/80 focus-within:shadow-[0_0_0_3px_rgb(255_90_31/0.14)]', className)}>
      {label && (
        <span onPointerDown={scrub} className="cursor-ew-resize select-none whitespace-nowrap pl-2 pr-1 text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-muted" title="Drag to adjust">
          {label}
        </span>
      )}
      <input
        value={draft}
        placeholder={placeholder}
        inputMode="decimal"
        className="w-full min-w-0 bg-transparent px-2 py-1.5 text-right tabular-nums outline-none"
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = clamp((value ?? 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), min, max);
            setDraft(fmt(v));
            onChange(Number(v.toFixed(6)));
          }
        }}
      />
      {unit && <span className="pr-2 text-[11px] text-dim">{unit}</span>}
    </label>
  );
};

export const SelectField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
  className?: string;
  placeholder?: string;
}> = ({ value, onChange, options, className, placeholder }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={cn('field cursor-pointer appearance-none bg-[length:12px] pr-7', className)} style={{ backgroundImage: SELECT_ARROW, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      return (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      );
    })}
  </select>
);

const SELECT_ARROW = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a92a8' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export const RangeField: React.FC<{
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  className?: string;
}> = ({ label, value, onChange, min, max, step = 0.01, format, className }) => (
  <div className={cn('flex flex-col gap-1.5', className)}>
    {label && (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-dim">{format ? format(value) : value}</span>
      </div>
    )}
    <Slider.Root className="relative flex h-4 w-full touch-none select-none items-center" value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0] ?? value)}>
      <Slider.Track className="relative h-1 grow rounded-full bg-panel-3">
        <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-accent-2 to-accent" />
      </Slider.Track>
      <Slider.Thumb className="block size-3.5 rounded-full border-2 border-accent bg-white shadow-[0_0_10px_-1px_rgb(255_90_31/0.8)] outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-label={label} />
    </Slider.Root>
  </div>
);

const toHex = (c: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7);
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
  return '#000000';
};

export const ColorField: React.FC<{ value: string | undefined; onChange: (v: string) => void; placeholder?: string; className?: string; allowClear?: boolean; onClear?: () => void }> = ({
  value,
  onChange,
  placeholder = 'none',
  className,
  allowClear,
  onClear,
}) => (
  <div className={cn('flex items-center gap-1.5', className)}>
    <label className="checker relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line">
      <span className="absolute inset-0" style={{ background: value || 'transparent' }} />
      <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={toHex(value ?? '#000000')} onChange={(e) => onChange(e.target.value.toUpperCase())} />
    </label>
    <TextInput value={value ?? ''} onChange={(v) => v.trim() && onChange(v.trim())} commit="blur" placeholder={placeholder} mono className="py-1" />
    {allowClear && value && (
      <button className="btn btn-ghost btn-icon text-dim" onClick={onClear} aria-label="Clear color">
        <X className="size-3.5" />
      </button>
    )}
  </div>
);

export const Segmented = <T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  className?: string;
  size?: 'sm' | 'md';
}) => (
  <div className={cn('inline-flex rounded-[10px] border border-line bg-black/30 p-0.5 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]', className)}>
    {options.map((o) => (
      <button
        key={o.value}
        title={o.title}
        onClick={() => onChange(o.value)}
        className={cn(
          'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold text-muted transition-colors hover:text-text',
          size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
          value === o.value && 'bg-gradient-to-b from-white/[0.13] to-white/[0.07] text-text shadow-md shadow-black/40 ring-1 ring-white/[0.1] [&>svg]:text-accent',
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const Section: React.FC<{ title: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({
  title,
  defaultOpen = true,
  right,
  children,
  className,
}) => (
  <Collapsible.Root defaultOpen={defaultOpen} className={cn('border-b border-line', className)}>
    <div className="flex items-center gap-2 px-3 py-2">
      <Collapsible.Trigger className="group flex flex-1 items-center gap-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted hover:text-text">
        <ChevronDown className="size-3.5 text-accent transition-transform group-data-[state=closed]:-rotate-90" />
        {title}
      </Collapsible.Trigger>
      {right}
    </div>
    <Collapsible.Content className="flex flex-col gap-3 px-3 pb-3">{children}</Collapsible.Content>
  </Collapsible.Root>
);

export const Badge: React.FC<{ children: React.ReactNode; tone?: 'default' | 'accent' | 'ok' | 'warn' | 'danger'; className?: string }> = ({ children, tone = 'default', className }) => (
  <span
    className={cn(
      'chip',
      tone === 'accent' && 'bg-accent/15 text-accent-ink',
      tone === 'ok' && 'bg-ok/15 text-ok',
      tone === 'warn' && 'bg-warn/15 text-warn',
      tone === 'danger' && 'bg-danger/15 text-danger',
      className,
    )}
  >
    {children}
  </span>
);
