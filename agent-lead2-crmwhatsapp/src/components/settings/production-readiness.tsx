'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useLanguage } from '@/hooks/use-language';
import { SettingsPanelHead } from './settings-panel-head';

interface PreflightCheck {
  id: string;
  label: string;
  status: 'pass' | 'blocked';
  missing: string[];
  message: string;
}

interface PreflightResponse {
  ready: boolean;
  checks: PreflightCheck[];
  blockers: string[];
}

export function ProductionReadiness() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<PreflightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/readiness/preflight', {
        method: 'GET',
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => null)) as PreflightResponse | null;
      if (!data || !Array.isArray(data.checks)) {
        setError(
          res.ok
            ? t('settings.readiness.invalidResponse')
            : t('settings.readiness.checkFailed'),
        );
        return;
      }
      setResult(data);
    } catch {
      setError(t('settings.readiness.endpointUnreachable'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title={t('settings.readiness.title')}
          description={t('settings.readiness.loadingDescription')}
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('settings.readiness.title')}
        description={t('settings.readiness.description')}
        action={
          <Button variant="outline" onClick={refresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('settings.readiness.refresh')}
          </Button>
        }
      />

      {error ? (
        <Alert className="border-red-900 bg-red-950/20">
          <AlertTriangle className="size-4 text-red-400" />
          <AlertTitle>{t('settings.readiness.unavailable')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : result ? (
        <>
          <Alert className={result.ready ? 'bg-card' : 'border-amber-900 bg-amber-950/20'}>
            {result.ready ? (
              <CheckCircle2 className="size-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="size-4 text-amber-400" />
            )}
            <AlertTitle>
              {t(
                result.ready
                  ? 'settings.readiness.ready'
                  : 'settings.readiness.blocked',
              )}
            </AlertTitle>
            <AlertDescription>
              {result.ready
                ? t('settings.readiness.readyDescription')
                : t('settings.readiness.missing', {
                    items: result.blockers.join(', '),
                  })}
            </AlertDescription>
          </Alert>

          <div className="grid gap-3 lg:grid-cols-2">
            {result.checks.map((check) => {
              const passed = check.status === 'pass';
              return (
                <Card key={check.id}>
                  <CardContent className="flex items-start gap-3 p-4">
                    <span
                      className={
                        passed
                          ? 'mt-0.5 text-emerald-500'
                          : 'mt-0.5 text-amber-400'
                      }
                    >
                      {passed ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <AlertTriangle className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">
                        {check.label}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {check.message}
                      </span>
                      {check.missing.length > 0 ? (
                        <span className="mt-2 flex flex-wrap gap-1">
                          {check.missing.map((name) => (
                            <code
                              key={name}
                              className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground"
                            >
                              {name}
                            </code>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex items-start gap-3 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 text-primary" />
            <p>
              {t('settings.readiness.proofNote')}
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
