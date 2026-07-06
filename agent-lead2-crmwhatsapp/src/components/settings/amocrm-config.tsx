'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from './settings-panel-head';

const MASKED_SECRET = '****************';

interface AmoConfigResponse {
  configured: boolean;
  reason?: string;
  message?: string;
  public_config?: {
    baseUrl?: string;
    pipelineId?: string | number | null;
    statusId?: string | number | null;
    responsibleUserId?: string | number | null;
  };
  has_secrets?: {
    access_token?: boolean;
    refresh_token?: boolean;
    client_id?: boolean;
    client_secret?: boolean;
  };
}

export function AmoCrmConfig() {
  const {
    user,
    accountId,
    loading: authLoading,
    profileLoading,
    canEditSettings,
  } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [status, setStatus] = useState<AmoConfigResponse | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [accessEdited, setAccessEdited] = useState(false);
  const [refreshEdited, setRefreshEdited] = useState(false);
  const [clientIdEdited, setClientIdEdited] = useState(false);
  const [clientSecretEdited, setClientSecretEdited] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/amocrm/config', {
        method: 'GET',
        cache: 'no-store',
      });
      const data = (await res.json()) as AmoConfigResponse;
      setStatus(data);
      setBaseUrl(data.public_config?.baseUrl ?? '');
      setPipelineId(String(data.public_config?.pipelineId ?? ''));
      setStatusId(String(data.public_config?.statusId ?? ''));
      setResponsibleUserId(String(data.public_config?.responsibleUserId ?? ''));
      setAccessToken(data.has_secrets?.access_token ? MASKED_SECRET : '');
      setRefreshToken(data.has_secrets?.refresh_token ? MASKED_SECRET : '');
      setClientId(data.has_secrets?.client_id ? MASKED_SECRET : '');
      setClientSecret(data.has_secrets?.client_secret ? MASKED_SECRET : '');
      setAccessEdited(false);
      setRefreshEdited(false);
      setClientIdEdited(false);
      setClientSecretEdited(false);
    } catch (err) {
      console.error('[amocrm-config] load failed:', err);
      toast.error('Failed to load amoCRM configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      setLoading(false);
      return;
    }
    void loadConfig();
  }, [accountId, authLoading, loadConfig, profileLoading, user]);

  async function saveConfig() {
    if (!baseUrl.trim()) {
      toast.error('amoCRM account URL is required');
      return;
    }
    if (!accessToken.trim() && !status?.has_secrets?.access_token) {
      toast.error('amoCRM access token is required');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        base_url: baseUrl.trim(),
        pipeline_id: pipelineId.trim() || null,
        status_id: statusId.trim() || null,
        responsible_user_id: responsibleUserId.trim() || null,
      };
      if (accessEdited && accessToken !== MASKED_SECRET) {
        payload.access_token = accessToken.trim();
      }
      if (refreshEdited && refreshToken !== MASKED_SECRET) {
        payload.refresh_token = refreshToken.trim();
      }
      if (clientIdEdited && clientId !== MASKED_SECRET) {
        payload.client_id = clientId.trim();
      }
      if (clientSecretEdited && clientSecret !== MASKED_SECRET) {
        payload.client_secret = clientSecret.trim();
      }

      const res = await fetch('/api/integrations/amocrm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save amoCRM configuration');
        return;
      }
      toast.success('amoCRM configuration saved');
      await loadConfig();
    } catch (err) {
      console.error('[amocrm-config] save failed:', err);
      toast.error('Failed to save amoCRM configuration');
    } finally {
      setSaving(false);
    }
  }

  async function resetConfig() {
    if (!confirm('Delete the amoCRM configuration for this account?')) return;
    setResetting(true);
    try {
      const res = await fetch('/api/integrations/amocrm/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to reset amoCRM configuration');
        return;
      }
      toast.success('amoCRM configuration cleared');
      setStatus(null);
      setBaseUrl('');
      setPipelineId('');
      setStatusId('');
      setResponsibleUserId('');
      setAccessToken('');
      setRefreshToken('');
      setClientId('');
      setClientSecret('');
    } finally {
      setResetting(false);
    }
  }

  function secretFocus(setter: (value: string) => void, markEdited: () => void) {
    return (value: string) => {
      if (value === MASKED_SECRET) {
        setter('');
        markEdited();
      }
    };
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="amoCRM identity"
          description="Configure the identity source of truth for EVO Inbox leads."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const configured = Boolean(status?.configured);
  const blocked = Boolean(status?.reason && status.reason !== 'no_config');

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="amoCRM identity"
        description="Resolve or create the canonical amoCRM contact and lead before EVO Inbox presents a WhatsApp sender as a real lead."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Alert className="bg-card">
            <div className="flex items-center gap-2">
              {configured ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <AlertTriangle
                  className={blocked ? 'size-4 text-amber-500' : 'size-4 text-red-500'}
                />
              )}
              <AlertTitle className="mb-0">
                {configured
                  ? 'amoCRM identity configured'
                  : blocked
                    ? 'amoCRM identity blocked'
                    : 'amoCRM identity not configured'}
              </AlertTitle>
            </div>
            <AlertDescription>
              {configured
                ? 'Inbound WhatsApp senders can be tied to amoCRM shadow identifiers in EVO Inbox.'
                : status?.message ||
                  'Save the amoCRM account URL and access token before inbound conversations can be presented as real leads.'}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Account connection</CardTitle>
              <CardDescription>
                Secrets are encrypted with ENCRYPTION_KEY and never returned after saving.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>amoCRM account URL</Label>
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://example.amocrm.ru"
                  disabled={!canEditSettings || saving}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Pipeline ID</Label>
                  <Input
                    value={pipelineId}
                    onChange={(event) => setPipelineId(event.target.value)}
                    placeholder="optional"
                    disabled={!canEditSettings || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status ID</Label>
                  <Input
                    value={statusId}
                    onChange={(event) => setStatusId(event.target.value)}
                    placeholder="optional"
                    disabled={!canEditSettings || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Responsible user ID</Label>
                  <Input
                    value={responsibleUserId}
                    onChange={(event) => setResponsibleUserId(event.target.value)}
                    placeholder="optional"
                    disabled={!canEditSettings || saving}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Access token</Label>
                <Input
                  type={showSecrets ? 'text' : 'password'}
                  value={accessToken}
                  onChange={(event) => {
                    setAccessToken(event.target.value);
                    setAccessEdited(true);
                  }}
                  onFocus={() =>
                    secretFocus(setAccessToken, () => setAccessEdited(true))(accessToken)
                  }
                  placeholder="Long-lived amoCRM token"
                  disabled={!canEditSettings || saving}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Refresh token</Label>
                  <Input
                    type={showSecrets ? 'text' : 'password'}
                    value={refreshToken}
                    onChange={(event) => {
                      setRefreshToken(event.target.value);
                      setRefreshEdited(true);
                    }}
                    onFocus={() =>
                      secretFocus(setRefreshToken, () => setRefreshEdited(true))(
                        refreshToken,
                      )
                    }
                    placeholder="optional"
                    disabled={!canEditSettings || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input
                    type={showSecrets ? 'text' : 'password'}
                    value={clientId}
                    onChange={(event) => {
                      setClientId(event.target.value);
                      setClientIdEdited(true);
                    }}
                    onFocus={() =>
                      secretFocus(setClientId, () => setClientIdEdited(true))(clientId)
                    }
                    placeholder="optional"
                    disabled={!canEditSettings || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client secret</Label>
                  <Input
                    type={showSecrets ? 'text' : 'password'}
                    value={clientSecret}
                    onChange={(event) => {
                      setClientSecret(event.target.value);
                      setClientSecretEdited(true);
                    }}
                    onFocus={() =>
                      secretFocus(setClientSecret, () =>
                        setClientSecretEdited(true),
                      )(clientSecret)
                    }
                    placeholder="optional"
                    disabled={!canEditSettings || saving}
                  />
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => setShowSecrets((value) => !value)}
                className="w-full sm:w-auto"
              >
                {showSecrets ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {showSecrets ? 'Hide secrets' : 'Show secrets'}
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button onClick={saveConfig} disabled={!canEditSettings || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save configuration
            </Button>
            {configured ? (
              <Button
                variant="outline"
                onClick={resetConfig}
                disabled={!canEditSettings || resetting}
                className="border-red-900 text-red-400 hover:bg-red-950/40 hover:text-red-300"
              >
                {resetting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                Reset
              </Button>
            ) : null}
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              Identity boundary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>amoCRM remains canonical for contact identity, lead identity, and sales status.</p>
            <p>EVO Inbox stores only shadow fields such as amo_contact_id and amo_lead_id for operator speed.</p>
            <p>When amoCRM is missing or rejects a request, inbound lead presentation is blocked instead of creating a local-only real lead.</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
