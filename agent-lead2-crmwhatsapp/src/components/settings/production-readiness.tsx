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
        setError(res.ok ? 'Readiness response was invalid.' : 'Readiness check failed.');
        return;
      }
      setResult(data);
    } catch {
      setError('Could not reach the readiness preflight endpoint.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
          title="Production readiness"
          description="Review blockers before deploying or proving EVO Inbox."
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
        title="Production readiness"
        description="Local preflight for inbox.evoadmissions.com. It does not deploy, send WhatsApp messages, or claim live provider success."
        action={
          <Button variant="outline" onClick={refresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
        }
      />

      {error ? (
        <Alert className="border-red-900 bg-red-950/20">
          <AlertTriangle className="size-4 text-red-400" />
          <AlertTitle>Readiness unavailable</AlertTitle>
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
              {result.ready ? 'Preflight ready' : 'Preflight blocked'}
            </AlertTitle>
            <AlertDescription>
              {result.ready
                ? 'All required local configuration inputs are present. Live proof still requires real provider exercise.'
                : `Missing or blocked: ${result.blockers.join(', ')}`}
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
              Issue #20 is not complete from this screen. The production proof
              still requires deployment, real inbound WhatsApp, amoCRM identity
              verification, Supabase record checks, AI draft generation from
              knowledge, one manual WAHA reply, and verified no auto-reply.
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
