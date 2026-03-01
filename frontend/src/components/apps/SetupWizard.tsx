import { useState, useEffect } from 'react';
import {
  Key,
  ExternalLink,
  Loader2,
  Check,
  Sparkles,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  Zap,
  Mail,
  Cloud,
  Hash,
  Unplug,
} from 'lucide-react';
import { Button, Input, Label } from '@/components/ui';
import { useComputerStore } from '@/stores/agentStore';
import { useWindowStore } from '@/stores/windowStore';
import {
  validateOpenRouterKey,
  fetchModelInfo,
  formatModelPrice,
  getDriveConfigured,
  getDriveAuthUrl,
  getSlackConfigured,
  getSlackInstallUrl,
  getSlackStatus,
  disconnectSlack,
  type OpenRouterModelInfo,
  type SlackStatus,
} from '@/services/api';
import type { WindowConfig } from '@/types';

// OpenRouter models — curated options
const MODELS = [
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'Nemotron Nano', tag: 'Free' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tag: null },
  { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5', tag: null },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', tag: null },
];

type Screen = 'grid' | 'openrouter' | 'tinyfish' | 'agentmail' | 'drive' | 'slack';

interface SetupWizardProps {
  config: WindowConfig;
  onComplete?: () => void;
}

export function SetupWizard({ config, onComplete }: SetupWizardProps) {
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const updateComputer = useComputerStore((s) => s.updateComputer);
  const hasApiKey = useComputerStore((s) => s.hasApiKey);
  const hasTinyfishKey = useComputerStore((s) => s.hasTinyfishKey);
  const hasAgentmailKey = useComputerStore((s) => s.hasAgentmailKey);

  const [screen, setScreen] = useState<Screen>('grid');

  // Drive state (checked once on mount)
  const [driveConfigured, setDriveConfigured] = useState(false);
  // Slack state
  const [slackConfigured, setSlackConfigured] = useState(false);
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackTeamName, setSlackTeamName] = useState('');

  useEffect(() => {
    getDriveConfigured().then((r) => {
      if (r.success) setDriveConfigured(r.data.configured);
    });
    getSlackConfigured().then((r) => {
      if (r.success && r.data.configured) {
        setSlackConfigured(true);
        // Also check connection status
        getSlackStatus().then((s) => {
          if (s.success && s.data.connected) {
            setSlackConnected(true);
            setSlackTeamName(s.data.teamName || '');
          }
        });
      }
    });
  }, []);

  const goBack = () => setScreen('grid');

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {screen === 'grid' ? (
        <GridScreen
          hasApiKey={hasApiKey}
          hasTinyfishKey={hasTinyfishKey}
          hasAgentmailKey={hasAgentmailKey}
          driveConfigured={driveConfigured}
          slackConfigured={slackConfigured}
          slackConnected={slackConnected}
          onSelect={setScreen}
          onDone={() => { closeWindow(config.id); onComplete?.(); }}
        />
      ) : screen === 'openrouter' ? (
        <OpenRouterScreen
          hasApiKey={hasApiKey}
          onBack={goBack}
          onSave={async (apiKey, model) => {
            const updates: { openrouterApiKey?: string; model?: string } = {};
            if (apiKey) updates.openrouterApiKey = apiKey;
            if (model) updates.model = model;
            return updateComputer(updates);
          }}
        />
      ) : screen === 'tinyfish' ? (
        <ApiKeyScreen
          title="TinyFish"
          icon={<Zap className="w-5 h-5 text-amber-500" />}
          placeholder={hasTinyfishKey ? 'Key already set' : 'sk-tinyfish-...'}
          linkUrl="https://agent.tinyfish.ai/api-keys"
          linkLabel="Get a key"
          alreadyConfigured={hasTinyfishKey}
          onBack={goBack}
          onSave={async (key) => updateComputer({ tinyfishApiKey: key })}
        />
      ) : screen === 'agentmail' ? (
        <AgentMailScreen
          hasAgentmailKey={hasAgentmailKey}
          onBack={goBack}
          onSave={async (apiKey, username) => {
            const updates: { agentmailApiKey?: string; agentmailInboxUsername?: string } = {};
            if (apiKey) updates.agentmailApiKey = apiKey;
            if (username) updates.agentmailInboxUsername = username;
            return updateComputer(updates);
          }}
        />
      ) : screen === 'drive' ? (
        <DriveScreen
          driveConfigured={driveConfigured}
          onBack={goBack}
          onConnected={() => setDriveConfigured(true)}
        />
      ) : screen === 'slack' ? (
        <SlackScreen
          slackConnected={slackConnected}
          slackTeamName={slackTeamName}
          onBack={goBack}
          onConnected={(teamName) => { setSlackConnected(true); setSlackTeamName(teamName); }}
          onDisconnected={() => { setSlackConnected(false); setSlackTeamName(''); }}
        />
      ) : null}
    </div>
  );
}

/* ─── Grid Screen ───────────────────────────────────────────── */

function GridScreen({
  hasApiKey,
  hasTinyfishKey,
  hasAgentmailKey,
  driveConfigured,
  slackConfigured,
  slackConnected,
  onSelect,
  onDone,
}: {
  hasApiKey: boolean;
  hasTinyfishKey: boolean;
  hasAgentmailKey: boolean;
  driveConfigured: boolean;
  slackConfigured: boolean;
  slackConnected: boolean;
  onSelect: (s: Screen) => void;
  onDone: () => void;
}) {
  const cards: { id: Screen; icon: React.ReactNode; name: string; desc: string; configured: boolean; required?: boolean; hidden?: boolean }[] = [
    {
      id: 'openrouter' as const,
      icon: <Key className="w-5 h-5 text-[var(--color-text-muted)]" />,
      name: 'OpenRouter',
      desc: 'AI models',
      configured: hasApiKey,
      required: true,
    },
    {
      id: 'tinyfish' as const,
      icon: <Zap className="w-5 h-5 text-amber-500" />,
      name: 'TinyFish',
      desc: 'Cloud browser',
      configured: hasTinyfishKey,
    },
    {
      id: 'drive' as const,
      icon: <Cloud className="w-5 h-5 text-green-500" />,
      name: 'Google Drive',
      desc: 'Cloud file sync',
      configured: driveConfigured,
    },
    {
      id: 'agentmail' as const,
      icon: <Mail className="w-5 h-5 text-blue-500" />,
      name: 'AgentMail',
      desc: 'Send & receive email',
      configured: hasAgentmailKey,
    },
    {
      id: 'slack' as const,
      icon: <Hash className="w-5 h-5 text-[#E01E5A]" />,
      name: 'Slack',
      desc: 'Chat with your agent',
      configured: slackConnected,
      hidden: !slackConfigured,
    },
  ].filter((c) => !c.hidden);

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="text-center space-y-1.5">
            <div className="w-12 h-12 mx-auto bg-[var(--color-accent)]/10 rounded-full flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-[var(--color-accent)]" />
            </div>
            <h2 className="text-lg font-semibold">Set Up Your Computer</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Configure the services you want to use
            </p>
          </div>

          {/* 2x2 grid */}
          <div className="grid grid-cols-2 gap-3">
            {cards.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-colors
                  ${c.configured
                    ? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/5 hover:bg-[var(--color-success)]/10'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-raised)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/5'
                  }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  c.configured ? 'bg-[var(--color-success)]/15' : 'bg-[var(--color-surface)]'
                }`}>
                  {c.configured ? <Check className="w-5 h-5 text-[var(--color-success)]" /> : c.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.required && !c.configured && (
                      <span className="text-[10px] font-medium px-1.5 py-px rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                        Required
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {c.configured ? 'Configured' : c.desc}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3">
        <Button variant="primary" className="w-full" onClick={onDone} disabled={!hasApiKey}>
          Done
        </Button>
      </div>
    </>
  );
}

/* ─── Detail Screen Shell ───────────────────────────────────── */

function DetailShell({
  title,
  icon,
  onBack,
  children,
  footer,
}: {
  title: string;
  icon: React.ReactNode;
  onBack: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <>
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)]">
        <button
          onClick={onBack}
          className="p-1 rounded-md hover:bg-[var(--color-surface-raised)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-5 space-y-4">
          {children}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 flex gap-2">
        {footer}
      </div>
    </>
  );
}

/* ─── Generic API Key Screen ────────────────────────────────── */

function ApiKeyScreen({
  title,
  icon,
  placeholder,
  linkUrl,
  linkLabel,
  alreadyConfigured,
  onBack,
  onSave,
}: {
  title: string;
  icon: React.ReactNode;
  placeholder: string;
  linkUrl: string;
  linkLabel: string;
  alreadyConfigured: boolean;
  onBack: () => void;
  onSave: (key: string) => Promise<boolean>;
}) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const ok = await onSave(key.trim());
      if (ok) onBack();
      else setError('Failed to save. Please try again.');
    } catch {
      setError('An error occurred.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailShell
      title={title}
      icon={icon}
      onBack={onBack}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onBack} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSave} disabled={saving || !key.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </>
      }
    >
      {alreadyConfigured && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 rounded-lg p-2.5">
          <Check className="w-3.5 h-3.5 shrink-0" />
          Already configured. Enter a new key to replace it.
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">API Key</Label>
        <Input
          type="text"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={placeholder}
          className="text-sm"
          autoFocus
        />
      </div>

      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-[var(--color-accent)] hover:underline inline-flex items-center gap-1"
      >
        {linkLabel} <ExternalLink className="w-3 h-3" />
      </a>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
    </DetailShell>
  );
}

/* ─── OpenRouter Screen (API key + model) ───────────────────── */

function OpenRouterScreen({
  hasApiKey,
  onBack,
  onSave,
}: {
  hasApiKey: boolean;
  onBack: () => void;
  onSave: (apiKey: string, model: string) => Promise<boolean>;
}) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('nvidia/nemotron-3-nano-30b-a3b:free');
  const [customModelId, setCustomModelId] = useState('');
  const [showCustomModel, setShowCustomModel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pricing
  const [pricingMap, setPricingMap] = useState<Map<string, OpenRouterModelInfo | null>>(new Map());
  const [customPricing, setCustomPricing] = useState<OpenRouterModelInfo | null>(null);
  const [customPricingLoading, setCustomPricingLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const map = new Map<string, OpenRouterModelInfo | null>();
    for (const m of MODELS) {
      fetchModelInfo(m.id).then((info) => {
        if (cancelled) return;
        map.set(m.id, info);
        setPricingMap(new Map(map));
      });
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!customModelId.trim() || !showCustomModel) { setCustomPricing(null); return; }
    const timer = setTimeout(async () => {
      setCustomPricingLoading(true);
      const info = await fetchModelInfo(customModelId.trim());
      setCustomPricing(info);
      setCustomPricingLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [customModelId, showCustomModel]);

  const effectiveModel = showCustomModel ? customModelId.trim() : model;

  const handleSave = async () => {
    setError(null);
    if (apiKey.trim()) {
      setSaving(true);
      const validation = await validateOpenRouterKey(apiKey.trim());
      if (!validation.valid) {
        setError(validation.error || 'Invalid OpenRouter API key');
        setSaving(false);
        return;
      }
    } else if (!hasApiKey) {
      setError('An OpenRouter API key is required');
      return;
    }

    setSaving(true);
    try {
      const ok = await onSave(apiKey.trim(), effectiveModel);
      if (ok) onBack();
      else setError('Failed to save. Please try again.');
    } catch {
      setError('An error occurred.');
    } finally {
      setSaving(false);
    }
  };

  const canSave = hasApiKey || apiKey.trim().length > 0;

  return (
    <DetailShell
      title="OpenRouter"
      icon={<Key className="w-5 h-5 text-[var(--color-text-muted)]" />}
      onBack={onBack}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onBack} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </>
      }
    >
      {hasApiKey && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 rounded-lg p-2.5">
          <Check className="w-3.5 h-3.5 shrink-0" />
          Already configured. Enter a new key to replace it.
        </div>
      )}

      {/* API Key */}
      <div className="space-y-1.5">
        <Label className="text-xs">API Key</Label>
        <Input
          type="text"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? 'Key already set' : 'sk-or-v1-...'}
          className="text-sm"
          autoFocus
        />
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--color-accent)] hover:underline inline-flex items-center gap-1"
        >
          Get a free key <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Model picker */}
      <div className="space-y-2">
        <Label className="text-xs">AI Model</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {MODELS.map((m) => {
            const info = pricingMap.get(m.id);
            const promptPrice = info?.pricing ? formatModelPrice(info.pricing.prompt) : m.tag;
            const isSelected = model === m.id && !showCustomModel;
            return (
              <button
                key={m.id}
                onClick={() => { setModel(m.id); setShowCustomModel(false); setCustomModelId(''); }}
                className={`relative text-left px-3 py-2 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]'
                    : 'bg-[var(--color-surface-raised)] border-[var(--color-border)] hover:border-[var(--color-accent)]/50'
                }`}
              >
                {isSelected && <Check className="absolute top-2 right-2 w-3 h-3 text-[var(--color-accent)]" />}
                <span className="font-medium text-xs block pr-4">{m.name}</span>
                {promptPrice && (
                  <span className={`text-[10px] ${promptPrice === 'Free' ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}`}>
                    {promptPrice}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {!showCustomModel ? (
          <button
            onClick={() => { setShowCustomModel(true); setModel(''); }}
            className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] hover:border-[var(--color-accent)]/50 transition-colors"
          >
            <span className="text-[var(--color-text-muted)]">Use a different model...</span>
            <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
          </button>
        ) : (
          <div className="space-y-1.5">
            <Input
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={customModelId}
              onChange={(e) => setCustomModelId(e.target.value)}
              placeholder="provider/model-name"
              className="text-sm"
            />
            {customModelId.trim() && (
              <div className="text-xs">
                {customPricingLoading ? (
                  <span className="text-[var(--color-text-muted)] flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Looking up...
                  </span>
                ) : customPricing ? (
                  <span className="text-[var(--color-success)] flex items-center gap-1">
                    <Check className="w-3 h-3" /> {customPricing.name}
                  </span>
                ) : (
                  <span className="text-[var(--color-warning)]">Model not found</span>
                )}
              </div>
            )}
            <button
              onClick={() => { setShowCustomModel(false); setCustomModelId(''); setModel(MODELS[0].id); }}
              className="text-xs text-[var(--color-accent)] hover:underline"
            >
              Back to curated models
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
    </DetailShell>
  );
}

/* ─── AgentMail Screen ──────────────────────────────────────── */

function AgentMailScreen({
  hasAgentmailKey,
  onBack,
  onSave,
}: {
  hasAgentmailKey: boolean;
  onBack: () => void;
  onSave: (apiKey: string, username: string) => Promise<boolean>;
}) {
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!apiKey.trim() && !hasAgentmailKey) return;
    setSaving(true);
    setError(null);
    try {
      const ok = await onSave(apiKey.trim(), username.trim());
      if (ok) onBack();
      else setError('Failed to save. Please try again.');
    } catch {
      setError('An error occurred.');
    } finally {
      setSaving(false);
    }
  };

  const canSave = hasAgentmailKey || apiKey.trim().length > 0;

  return (
    <DetailShell
      title="AgentMail"
      icon={<Mail className="w-5 h-5 text-blue-500" />}
      onBack={onBack}
      footer={
        <>
          <Button variant="ghost" className="flex-1" onClick={onBack} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </>
      }
    >
      {hasAgentmailKey && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 rounded-lg p-2.5">
          <Check className="w-3.5 h-3.5 shrink-0" />
          Already configured. Enter a new key to replace it.
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">API Key</Label>
        <Input
          type="text"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasAgentmailKey ? 'Key already set' : 'am_...'}
          className="text-sm"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Inbox Username <span className="text-[var(--color-text-muted)]">(optional)</span></Label>
        <Input
          type="text"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="my-inbox"
          className="text-sm"
        />
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Your agent's email will be <span className="font-medium">{username.trim() || 'auto'}@agentmail.to</span>
        </p>
      </div>

      <a
        href="https://agentmail.to"
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-[var(--color-accent)] hover:underline inline-flex items-center gap-1"
      >
        Get a key <ExternalLink className="w-3 h-3" />
      </a>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
    </DetailShell>
  );
}

/* ─── Google Drive Screen ───────────────────────────────────── */

function DriveScreen({
  driveConfigured,
  onBack,
  onConnected,
}: {
  driveConfigured: boolean;
  onBack: () => void;
  onConnected: () => void;
}) {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    const result = await getDriveAuthUrl();
    setConnecting(false);
    if (result.success && result.data.url) {
      window.open(result.data.url, '_blank');
      // Optimistically mark as connected — user will complete OAuth in browser
      onConnected();
    }
  };

  return (
    <DetailShell
      title="Google Drive"
      icon={<Cloud className="w-5 h-5 text-green-500" />}
      onBack={onBack}
      footer={
        <Button variant="ghost" className="w-full" onClick={onBack}>
          Back
        </Button>
      }
    >
      {driveConfigured ? (
        <div className="flex items-center gap-2 text-xs text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 rounded-lg p-2.5">
          <Check className="w-3.5 h-3.5 shrink-0" />
          Google Drive is connected.
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            Connect your Google Drive to let your agent upload and download files.
          </p>
          <Button variant="primary" className="w-full" onClick={handleConnect} disabled={connecting}>
            {connecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Cloud className="w-4 h-4 mr-2" />}
            Connect Google Drive
          </Button>
        </div>
      )}
    </DetailShell>
  );
}

/* --- Slack Screen --- */

function SlackScreen({
  slackConnected,
  slackTeamName,
  onBack,
  onConnected,
  onDisconnected,
}: {
  slackConnected: boolean;
  slackTeamName: string;
  onBack: () => void;
  onConnected: (teamName: string) => void;
  onDisconnected: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    const result = await getSlackInstallUrl();
    setConnecting(false);
    if (result.success && result.data.url) {
      window.open(result.data.url, '_blank');
      // Poll for connection status (user will complete OAuth in new tab)
      const poll = setInterval(async () => {
        const status = await getSlackStatus();
        if (status.success && status.data.connected) {
          clearInterval(poll);
          onConnected(status.data.teamName || '');
        }
      }, 3000);
      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
    } else {
      setError(result.success ? (result.data.error || 'Unknown error') : result.error);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    await disconnectSlack();
    setDisconnecting(false);
    onDisconnected();
  };

  return (
    <DetailShell
      title="Slack"
      icon={<Hash className="w-5 h-5 text-[#E01E5A]" />}
      onBack={onBack}
      footer={
        <Button variant="ghost" className="w-full" onClick={onBack}>
          Back
        </Button>
      }
    >
      {slackConnected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 rounded-lg p-2.5">
            <Check className="w-3.5 h-3.5 shrink-0" />
            Connected to <span className="font-medium">{slackTeamName || 'Slack workspace'}</span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            @mention the bot in any channel or DM it directly. Each thread creates a separate conversation with your agent.
          </p>
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Unplug className="w-4 h-4 mr-1" />}
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            Add your agent to a Slack workspace. Team members can @mention the bot to send messages to your agent and receive responses in threads.
          </p>
          <Button variant="primary" className="w-full" onClick={handleConnect} disabled={connecting}>
            {connecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Hash className="w-4 h-4 mr-2" />}
            Add to Slack
          </Button>
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
      )}
    </DetailShell>
  );
}
