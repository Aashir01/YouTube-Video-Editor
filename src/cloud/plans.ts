/**
 * Plans and what can be bought. Credits are what AI use costs: one credit is CREDIT_USD of upstream
 * cost (0.001 USD by default) times the markup, so 1,000 credits buy about $0.87 of model time.
 *
 * - Free: a one-time signup gift plus a small monthly top-up; standard models only.
 * - Creator: monthly credits that reset each month (unused ones do not roll over) and Pro models.
 * - Credit packs: never expire, stack on any plan, and unlock Pro models.
 */
import type { CloudConfig } from './config';

export type PlanId = 'free' | 'creator';

export interface Plan {
  id: PlanId;
  name: string;
  monthlyCredits: number;
  /** may use premium models */
  premium: boolean;
}

export const plansOf = (cfg: CloudConfig): Record<PlanId, Plan> => ({
  free: { id: 'free', name: 'Free', monthlyCredits: cfg.freeMonthlyCredits, premium: false },
  creator: { id: 'creator', name: 'Creator', monthlyCredits: cfg.creatorMonthlyCredits, premium: true },
});

export interface Product {
  id: string;
  name: string;
  /** shown price; the payment provider charges the real one (regional pricing lives there) */
  price: string;
  usd: number;
  kind: 'plan' | 'pack';
  /** plan products */
  months?: number;
  /** pack products */
  credits?: number;
  note: string;
}

export const PRODUCTS: Product[] = [
  { id: 'creator_month', name: 'Creator, 1 month', price: '$3', usd: 3, kind: 'plan', months: 1, note: 'Monthly credits for about 10 videos, 10 Shorts and 3 long videos, plus Pro models' },
  { id: 'creator_quarter', name: 'Creator, 3 months', price: '$9', usd: 9, kind: 'plan', months: 3, note: 'The same plan, paid once a quarter' },
  { id: 'creator_year', name: 'Creator, 12 months', price: '$29', usd: 29, kind: 'plan', months: 12, note: 'Two months free' },
  { id: 'pack_5', name: '4,000 credits', price: '$5', usd: 5, kind: 'pack', credits: 4000, note: 'Never expire; unlock Pro models' },
  { id: 'pack_10', name: '8,500 credits', price: '$10', usd: 10, kind: 'pack', credits: 8500, note: '6% bonus' },
  { id: 'pack_20', name: '18,000 credits', price: '$20', usd: 20, kind: 'pack', credits: 18000, note: '12% bonus' },
];

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id);
