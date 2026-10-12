import { Button } from '@heroui/react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LOGIN_MESSAGE } from './fetch';
import { hostedStore } from './store';

/**
 * The banner for a lost login (design.md section 7): a 401, a redirect, or an answer that is not JSON on any poll. The panels keep their last data and mark it with an error,
 * so nothing goes stale in silence. Only the hosted build loads this file (App.tsx).
 */
export function HostedBanner() {
  const [expired, setExpired] = useState(hostedStore.loginExpired());
  useEffect(() => hostedStore.subscribe(() => setExpired(hostedStore.loginExpired())), []);
  if (!expired) return null;
  return (
    <div role="alert" className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-cc-accent bg-cc-paper px-4 py-2 sm:px-6">
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-sm font-medium">{LOGIN_MESSAGE}</p>
      <Button size="sm" variant="tertiary" onPress={() => window.location.reload()}>
        <RefreshCw aria-hidden className="size-3.5" />
        Reload
      </Button>
    </div>
  );
}
