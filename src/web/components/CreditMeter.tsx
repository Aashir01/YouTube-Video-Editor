import React from 'react';
import { Sparkles, Zap } from 'lucide-react';
import { useStudio } from '../lib/store';
import { cn } from '../lib/utils';
import { Tip } from './ui';

/** Cutroom AI credits in the top bar (or a way to get some when no AI is set up). */
export const CreditMeter: React.FC = () => {
  const cloud = useStudio((s) => s.cloud);
  const system = useStudio((s) => s.system);
  const openSettings = useStudio((s) => s.openSettings);
  if (!cloud?.signedIn) {
    if (!system || system.llm) return null;
    return (
      <button className="btn btn-sm mr-1 border-accent/40 text-accent-ink" onClick={() => openSettings('cloud')}>
        <Sparkles className="size-3.5" /> Free AI credits
      </button>
    );
  }
  const a = cloud.account;
  const total = a?.credits.total ?? 0;
  const low = a ? total < Math.max(30, a.monthlyAllowance * 0.15) : false;
  const label = a
    ? `Cutroom AI · ${a.planName} plan · ${total.toLocaleString('en-US')} credits left${a.plan === 'free' ? '' : ` · renews ${new Date(a.renewsAt).toLocaleDateString()}`}`
    : (cloud.error ?? 'Cutroom AI is offline');
  return (
    <Tip label={label}>
      <button
        data-testid="credit-meter"
        data-credits={a ? total : ''}
        onClick={() => openSettings('cloud')}
        className={cn(
          'mr-1 flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold tabular-nums transition-colors',
          !a ? 'border-line text-dim' : total <= 0 ? 'border-danger/50 bg-danger/10 text-danger' : low ? 'border-warn/50 bg-warn/10 text-warn' : 'border-line bg-black/25 text-text hover:border-line-2',
        )}
      >
        <Zap className={cn('size-3.5', a && total > 0 && !low && 'text-accent')} />
        {!a ? 'Offline' : total <= 0 ? 'Out of credits' : total.toLocaleString('en-US')}
      </button>
    </Tip>
  );
};
