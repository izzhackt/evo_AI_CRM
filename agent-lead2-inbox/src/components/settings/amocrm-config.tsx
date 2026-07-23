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
import { useLanguage } from '@/hooks/use-language';
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
  const { t } = useLanguage();

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
      toast.error(t('settings.amocrm.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      toast.error(t('settings.amocrm.baseUrlRequired'));
      return;
    }
    if (!accessToken.trim() && !status?.has_secrets?.access_token) {
      toast.error(t('settings.amocrm.accessTokenRequired'));
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
        toast.error(data.error || t('settings.amocrm.saveFailed'));
        return;
      }
      toast.success(t('settings.amocrm.saved'));
      await loadConfig();
    } catch (err) {
      console.error('[amocrm-config] save failed:', err);
      toast.error(t('settings.amocrm.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function resetConfig() {
    if (!confirm(t('settings.amocrm.resetConfirm'))) return;
    setResetting(true);
    try {
      const res = await fetch('/api/integrations/amocrm/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('settings.amocrm.resetFailed'));
        return;
      }
      toast.success(t('settings.amocrm.cleared'));
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
          title={t('settings.amocrm.title')}
          description={t('settings.amocrm.loadingDescription')}
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
        title={t('settings.amocrm.title')}
        description={t('settings.amocrm.description')}
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
                  ? t('settings.amocrm.statusConfigured')
                  : blocked
                    ? t('settings.amocrm.statusBlocked')
                    : t('settings.amocrm.statusMissing')}
              </AlertTitle>
            </div>
            <AlertDescription>
              {configured
                ? t('settings.amocrm.statusConfiguredDescription')
                : status?.message ||
                  t('settings.amocrm.statusMissingDescription')}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.amocrm.connection')}</CardTitle>
              <CardDescription>
                {t('settings.secretsEncrypted')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('settings.amocrm.accountUrl')}</Label>
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://example.amocrm.ru"
                  disabled={!canEditSettings || saving}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>{t('settings.amocrm.pipelineId')}</Label>
                  <Input
                    value={pipelineId}
                    onChange={(event) => setPipelineId(event.target.value)}
                    placeholder={t('settings.amocrm.optional')}
                    disabled={!canEditSettings || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('settings.amocrm.statusId')}</Label>
                  <Input
                    value={statusId}
                    onChange={(event) => setStatusId(event.target.value)}
                    placeholder={t('settings.amocrm.optional')}
                    disabled={!canEditSettings || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('settings.amocrm.responsibleUserId')}</Label>
                  <Input
                    value={responsibleUserId}
                    onChange={(event) => setResponsibleUserId(event.target.value)}
                    placeholder={t('settings.amocrm.optional')}
                    disabled={!canEditSettings || saving}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('settings.amocrm.accessToken')}</Label>
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
                  placeholder={t('settings.amocrm.longLivedToken')}
                  disabled={!canEditSettings || saving}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>{t('settings.amocrm.refreshToken')}</Label>
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
                    placeholder={t('settings.amocrm.optional')}
                    disabled={!canEditSettings || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('settings.amocrm.clientId')}</Label>
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
                    placeholder={t('settings.amocrm.optional')}
                    disabled={!canEditSettings || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('settings.amocrm.clientSecret')}</Label>
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
                    placeholder={t('settings.amocrm.optional')}
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
                {t(showSecrets ? 'settings.amocrm.hideSecrets' : 'settings.amocrm.showSecrets')}
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button onClick={saveConfig} disabled={!canEditSettings || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('settings.amocrm.saveConfiguration')}
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
                {t('settings.whatsapp.reset')}
              </Button>
            ) : null}
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              {t('settings.amocrm.identityBoundary')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{t('settings.amocrm.boundaryCanonical')}</p>
            <p>{t('settings.amocrm.boundaryShadow')}</p>
            <p>{t('settings.amocrm.boundaryBlocked')}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
