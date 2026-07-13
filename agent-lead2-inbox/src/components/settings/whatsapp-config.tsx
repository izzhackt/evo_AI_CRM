'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RotateCcw,
  ServerCog,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
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
import { SettingsPanelHead } from './settings-panel-head';

const MASKED_SECRET = '****************';
const DEFAULT_SESSION = 'evo-inbox';

interface WahaConfigResponse {
  configured: boolean;
  connected: boolean;
  reason?: string;
  message?: string;
  public_config?: {
    baseUrl?: string;
    sessionName?: string;
  };
  has_secrets?: {
    api_key?: boolean;
    webhook_hmac_secret?: boolean;
  };
  session_status?: string;
}

export function WhatsAppConfig() {
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [status, setStatus] = useState<WahaConfigResponse | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [sessionName, setSessionName] = useState(DEFAULT_SESSION);
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [apiKeyEdited, setApiKeyEdited] = useState(false);
  const [webhookSecretEdited, setWebhookSecretEdited] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);

  const webhookUrl = useMemo(
    () =>
      typeof window === 'undefined'
        ? ''
        : `${window.location.origin}/api/waha/webhook`,
    [],
  );

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'GET',
        cache: 'no-store',
      });
      const data = (await res.json()) as WahaConfigResponse;
      setStatus(data);
      setBaseUrl(data.public_config?.baseUrl ?? '');
      setSessionName(data.public_config?.sessionName ?? DEFAULT_SESSION);
      setApiKey(data.has_secrets?.api_key ? MASKED_SECRET : '');
      setWebhookSecret(
        data.has_secrets?.webhook_hmac_secret ? MASKED_SECRET : '',
      );
      setApiKeyEdited(false);
      setWebhookSecretEdited(false);
    } catch (err) {
      console.error('[waha-config] load failed:', err);
      toast.error(t('settings.whatsapp.loadFailed'));
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
      toast.error(t('settings.whatsapp.baseUrlRequired'));
      return;
    }
    if (!sessionName.trim()) {
      toast.error(t('settings.whatsapp.sessionRequired'));
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        base_url: baseUrl.trim(),
        session_name: sessionName.trim() || DEFAULT_SESSION,
      };
      if (apiKeyEdited && apiKey !== MASKED_SECRET) {
        payload.api_key = apiKey.trim();
      }
      if (webhookSecretEdited && webhookSecret !== MASKED_SECRET) {
        payload.webhook_hmac_secret = webhookSecret.trim();
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('settings.whatsapp.saveFailed'));
        return;
      }
      toast.success(t('settings.whatsapp.saved'));
      await loadConfig();
    } catch (err) {
      console.error('[waha-config] save failed:', err);
      toast.error(t('settings.whatsapp.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      await loadConfig();
      if (status?.connected) {
        toast.success(t('settings.whatsapp.working'));
      }
    } finally {
      setTesting(false);
    }
  }

  async function resetConfig() {
    if (!confirm(t('settings.whatsapp.resetConfirm'))) return;
    setResetting(true);
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('settings.whatsapp.resetFailed'));
        return;
      }
      toast.success(t('settings.whatsapp.cleared'));
      setStatus(null);
      setBaseUrl('');
      setSessionName(DEFAULT_SESSION);
      setApiKey('');
      setWebhookSecret('');
      setApiKeyEdited(false);
      setWebhookSecretEdited(false);
    } finally {
      setResetting(false);
    }
  }

  function copyWebhookUrl() {
    void navigator.clipboard.writeText(webhookUrl);
    toast.success(t('settings.whatsapp.webhookCopied'));
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title={t('settings.whatsapp.title')}
          description={t('settings.whatsapp.loadingDescription')}
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const connected = Boolean(status?.connected);
  const configured = Boolean(status?.configured);

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('settings.whatsapp.title')}
        description={t('settings.whatsapp.description')}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Alert className="bg-card">
            <div className="flex items-center gap-2">
              {connected ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : configured ? (
                <AlertTriangle className="size-4 text-amber-500" />
              ) : (
                <AlertTriangle className="size-4 text-red-500" />
              )}
              <AlertTitle className="mb-0">
                {connected
                  ? t('settings.whatsapp.statusWorking')
                  : configured
                    ? t('settings.whatsapp.statusBlocked')
                    : t('settings.whatsapp.statusMissing')}
              </AlertTitle>
            </div>
            <AlertDescription>
              {connected
                ? `Session ${status?.session_status ?? DEFAULT_SESSION} is ready.`
                : status?.message ||
                  t('settings.whatsapp.statusMissingDescription')}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.whatsapp.sessionCard')}</CardTitle>
              <CardDescription>
                {t('settings.secretsEncrypted')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('settings.whatsapp.baseUrl')}</Label>
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="http://evo-inbox-waha:3000"
                />
              </div>

              <div className="space-y-2">
                <Label>{t('settings.whatsapp.sessionName')}</Label>
                <Input
                  value={sessionName}
                  onChange={(event) => setSessionName(event.target.value)}
                  placeholder={DEFAULT_SESSION}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('settings.whatsapp.apiKey')}</Label>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setApiKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (apiKey === MASKED_SECRET) {
                        setApiKey('');
                        setApiKeyEdited(true);
                      }
                    }}
                    placeholder="X-Api-Key value"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showApiKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('settings.whatsapp.webhookSecret')}</Label>
                <div className="relative">
                  <Input
                    type={showWebhookSecret ? 'text' : 'password'}
                    value={webhookSecret}
                    onChange={(event) => {
                      setWebhookSecret(event.target.value);
                      setWebhookSecretEdited(true);
                    }}
                    onFocus={() => {
                      if (webhookSecret === MASKED_SECRET) {
                        setWebhookSecret('');
                        setWebhookSecretEdited(true);
                      }
                    }}
                    placeholder="config.webhooks[].hmac.key"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowWebhookSecret((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showWebhookSecret ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.whatsapp.webhookUrl')}</CardTitle>
              <CardDescription>
                Configure WAHA session webhooks for message and session.status.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-sm" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyWebhookUrl}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button onClick={saveConfig} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('settings.whatsapp.saveConfiguration')}
            </Button>
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={testing || !configured}
            >
              {testing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Zap className="size-4" />
              )}
              {t('settings.whatsapp.testSession')}
            </Button>
            {configured ? (
              <Button
                variant="outline"
                onClick={resetConfig}
                disabled={resetting}
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

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ServerCog className="size-4" />
                {t('settings.whatsapp.sessionContract')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>{t('settings.whatsapp.defaultSession', { session: DEFAULT_SESSION })}</p>
              <p>{t('settings.whatsapp.sendApi')}</p>
              <p>{t('settings.whatsapp.chatIds')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4" />
                {t('settings.whatsapp.webhookAuth')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>{t('settings.whatsapp.hmacBodies')}</p>
              <p>{t('settings.whatsapp.rejectInvalid')}</p>
              <p>{t('settings.whatsapp.keepPrivate')}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
