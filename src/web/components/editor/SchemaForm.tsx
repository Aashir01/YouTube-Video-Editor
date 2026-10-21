import React from 'react';
import { Plus, X } from 'lucide-react';
import type { JsonSchemaProp } from '../../lib/api';
import { useStudio } from '../../lib/store';
import { ColorField, Field, NumberField, SelectField, Switch, TextArea, TextInput } from '../ui';

/** Auto-generated editor for template props, driven by the template's JSON schema. */

const LONG_TEXT = /^(text|body|quote|description|subtitle|caption|content|code|answer|explanation|narration|lines?)$/i;
const BIG = 1e12;

const humanize = (key: string) =>
  key
    .replace(/AssetId$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

const baseType = (p: JsonSchemaProp): string | undefined => {
  if (p.enum) return 'enum';
  const t = Array.isArray(p.type) ? p.type.find((x) => x !== 'null') : p.type;
  if (t) return t;
  const first = p.anyOf?.find((x) => x.type !== 'null');
  return first ? baseType(first) : undefined;
};

const resolve = (p: JsonSchemaProp): JsonSchemaProp => (p.anyOf ? { ...(p.anyOf.find((x) => x.type !== 'null') ?? {}), description: p.description, default: p.default } : p);

const emptyFor = (p: JsonSchemaProp | undefined): unknown => {
  if (!p) return '';
  const r = resolve(p);
  switch (baseType(r)) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(r.properties ?? {})) out[k] = sub.default ?? emptyFor(sub);
      return out;
    }
    case 'enum':
      return r.enum?.[0] ?? '';
    default:
      return '';
  }
};

const AssetPicker: React.FC<{ value: string | undefined; onChange: (v: string | null) => void; kinds: string[] }> = ({ value, onChange, kinds }) => {
  const assets = useStudio((s) => s.project?.assets ?? []);
  return (
    <SelectField
      value={value ?? ''}
      onChange={(v) => onChange(v || null)}
      placeholder="None"
      options={assets.filter((a) => kinds.includes(a.kind)).map((a) => ({ value: a.id, label: a.name }))}
    />
  );
};

export const PropField: React.FC<{ name: string; prop: JsonSchemaProp; value: unknown; onChange: (v: unknown) => void; compact?: boolean }> = ({ name, prop: raw, value, onChange, compact }) => {
  const prop = resolve(raw);
  const type = baseType(prop);
  const label = humanize(name);
  const hint = compact ? undefined : prop.description;

  if (/assetid$/i.test(name)) {
    const kinds = /video/i.test(name) ? ['video'] : /audio|music|sound/i.test(name) ? ['audio'] : ['image'];
    return (
      <Field label={label} hint={hint}>
        <AssetPicker value={value as string | undefined} onChange={onChange} kinds={kinds} />
      </Field>
    );
  }
  switch (type) {
    case 'enum':
      return (
        <Field label={label} hint={hint}>
          <SelectField value={String(value ?? prop.default ?? '')} onChange={onChange} options={(prop.enum ?? []).map((e) => String(e))} />
        </Field>
      );
    case 'boolean':
      return <Switch label={label} checked={Boolean(value ?? prop.default)} onChange={onChange} />;
    case 'number':
    case 'integer':
      return (
        <Field label={label} hint={hint}>
          <NumberField
            value={typeof value === 'number' ? value : typeof prop.default === 'number' ? prop.default : undefined}
            min={prop.minimum !== undefined && Math.abs(prop.minimum) < BIG ? prop.minimum : -Infinity}
            max={prop.maximum !== undefined && Math.abs(prop.maximum) < BIG ? prop.maximum : Infinity}
            step={type === 'integer' ? 1 : 0.1}
            precision={type === 'integer' ? 0 : 2}
            onChange={onChange}
          />
        </Field>
      );
    case 'array': {
      const items = Array.isArray(value) ? value : [];
      const itemSchema = prop.items ? resolve(prop.items) : undefined;
      const itemType = itemSchema ? baseType(itemSchema) : 'string';
      if (itemType === 'string' || itemType === 'number') {
        return (
          <Field label={label} hint={hint ?? 'One per line'}>
            <TextArea
              value={items.map(String).join('\n')}
              rows={Math.min(8, Math.max(2, items.length + 1))}
              onChange={(v) => {
                const lines = v.split('\n');
                onChange(itemType === 'number' ? lines.filter((l) => l.trim()).map(Number).filter((n) => !Number.isNaN(n)) : lines.filter((l, i) => l.trim() || i < lines.length - 1));
              }}
            />
          </Field>
        );
      }
      return (
        <Field label={label} hint={hint}>
          <div className="flex flex-col gap-2">
            {items.map((item, i) => (
              <div key={i} className="relative rounded-lg border border-line bg-panel p-2 pr-7">
                <button className="absolute right-1 top-1 rounded p-0.5 text-dim hover:text-danger" title="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <X className="size-3.5" />
                </button>
                <div className="flex flex-col gap-2">
                  {Object.entries(itemSchema?.properties ?? {}).map(([k, sub]) => (
                    <PropField
                      key={k}
                      compact
                      name={k}
                      prop={sub}
                      value={(item as Record<string, unknown>)?.[k]}
                      onChange={(v) => onChange(items.map((it, j) => (j === i ? { ...(it as object), [k]: v === null ? undefined : v } : it)))}
                    />
                  ))}
                </div>
              </div>
            ))}
            <button className="btn btn-sm btn-ghost border-dashed border-line text-muted" onClick={() => onChange([...items, emptyFor(itemSchema)])}>
              <Plus className="size-3.5" /> Add
            </button>
          </div>
        </Field>
      );
    }
    case 'object':
      return (
        <Field label={label} hint={hint}>
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-2">
            {Object.entries(prop.properties ?? {}).map(([k, sub]) => (
              <PropField key={k} compact name={k} prop={sub} value={(value as Record<string, unknown> | undefined)?.[k]} onChange={(v) => onChange({ ...((value as object) ?? {}), [k]: v })} />
            ))}
          </div>
        </Field>
      );
    default: {
      const v = value === undefined || value === null ? '' : String(value);
      if (/colou?r$/i.test(name) || /^(color|highlight|accent)/i.test(name)) {
        return (
          <Field label={label} hint={hint}>
            <ColorField value={v || undefined} onChange={onChange} allowClear onClear={() => onChange(null)} />
          </Field>
        );
      }
      const long = LONG_TEXT.test(name) || v.length > 48;
      return (
        <Field label={label} hint={hint}>
          {long ? <TextArea value={v} onChange={onChange} rows={Math.min(6, Math.max(2, Math.ceil(v.length / 34)))} /> : <TextInput value={v} onChange={onChange} />}
        </Field>
      );
    }
  }
};

export const SchemaForm: React.FC<{ schema: { properties?: Record<string, JsonSchemaProp>; required?: string[] }; value: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void }> = ({ schema, value, onChange }) => {
  const entries = Object.entries(schema.properties ?? {});
  // required + text fields first, styling enums after
  const order = (k: string, p: JsonSchemaProp) => (schema.required?.includes(k) ? 0 : baseType(resolve(p)) === 'string' && !p.enum ? 1 : 2);
  return (
    <div className="flex flex-col gap-3">
      {entries
        .sort((a, b) => order(a[0], a[1]) - order(b[0], b[1]))
        .map(([k, p]) => (
          <PropField key={k} name={k} prop={p} value={value[k]} onChange={(v) => onChange({ [k]: v })} />
        ))}
    </div>
  );
};
