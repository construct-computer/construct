import { useState, useEffect, useCallback } from 'react';
import { Key, ExternalLink, Loader2, Check, Sparkles, AlertCircle, ChevronRight } from 'lucide-react';
import { Button, Input, Label } from '@/components/ui';
import { useComputerStore } from '@/stores/agentStore';
import { useWindowStore } from '@/stores/windowStore';
import { validateOpenRouterKey, fetchModelInfo, formatModelPrice, type OpenRouterModelInfo } from '@/services/api';
import type { WindowConfig } from '@/types';

// OpenRouter models — 4 curated options
const MODELS = [
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'Nemotron Nano', description: 'Great for testing, no cost' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', description: 'Excellent reasoning and coding' },
  { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5', description: 'Strong multilingual model' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', description: 'Open source powerhouse' },
];

const CUSTOM_MODEL_EXAMPLES = [
  'google/gemini-2.0-flash-001',
  'openai/gpt-4o',
  'deepseek/deepseek-r1',
];

interface SetupWizardProps {
  config: WindowConfig;
  onComplete?: () => void;
}

export function SetupWizard({ config, onComplete }: SetupWizardProps) {
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const [step, setStep] = useState<'intro' | 'apikey' | 'model' | 'saving'>('intro');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('nvidia/nemotron-3-nano-30b-a3b:free');
  const [customModelId, setCustomModelId] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  
  // Pricing state — maps model ID to info (or null if not found)
  const [pricingMap, setPricingMap] = useState<Map<string, OpenRouterModelInfo | null>>(new Map());
  const [_pricingLoading, setPricingLoading] = useState(false);

  const updateComputer = useComputerStore((s) => s.updateComputer);

  // Fetch pricing for all curated models on mount
  useEffect(() => {
    let cancelled = false;
    setPricingLoading(true);
    // Fetching any one triggers caching of all models
    fetchModelInfo(MODELS[0].id).then(() => {
      if (cancelled) return;
      const map = new Map<string, OpenRouterModelInfo | null>();
      for (const m of MODELS) {
        fetchModelInfo(m.id).then((info) => {
          if (cancelled) return;
          map.set(m.id, info);
          setPricingMap(new Map(map));
        });
      }
      setPricingLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Fetch pricing for custom model after debounce
  const [customPricing, setCustomPricing] = useState<OpenRouterModelInfo | null>(null);
  const [customPricingLoading, setCustomPricingLoading] = useState(false);

  useEffect(() => {
    if (!customModelId.trim() || !showCustom) {
      setCustomPricing(null);
      return;
    }
    const timer = setTimeout(async () => {
      setCustomPricingLoading(true);
      const info = await fetchModelInfo(customModelId.trim());
      setCustomPricing(info);
      setCustomPricingLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [customModelId, showCustom]);

  const selectModel = useCallback((id: string) => {
    setModel(id);
    setShowCustom(false);
    setCustomModelId('');
  }, []);

  const selectCustom = useCallback(() => {
    setShowCustom(true);
    setModel('');
  }, []);

  // The effective model ID to save
  const effectiveModel = showCustom ? customModelId.trim() : model;

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('Please enter your OpenRouter API key');
      return;
    }
    if (!effectiveModel) {
      setError('Please select or enter a model');
      return;
    }
    
    setIsSaving(true);
    setError(null);
    setStep('saving');
    
    try {
      const success = await updateComputer({
        openrouterApiKey: apiKey.trim(),
        model: effectiveModel,
      });
      
      if (success) {
        // updateComputer already calls checkConfigStatus + fetchComputer
        closeWindow(config.id);
        onComplete?.();
      } else {
        setError('Failed to save configuration. Please try again.');
        setStep('apikey');
      }
    } catch {
      setError('An error occurred. Please try again.');
      setStep('apikey');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col items-center p-5 pb-0">
          <div className="max-w-md w-full space-y-4">
          {/* Header — compact on non-intro steps */}
          {step === 'intro' || step === 'saving' ? (
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto bg-[var(--color-accent)]/10 rounded-full flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-[var(--color-accent)]" />
              </div>
              <h2 className="text-xl font-semibold">Welcome to Your Computer</h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                Let's set up your AI assistant
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-[var(--color-accent)]/10 rounded-full flex items-center justify-center shrink-0">
                <Sparkles className="w-4.5 h-4.5 text-[var(--color-accent)]" />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight">Welcome to Your Computer</h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {step === 'apikey' ? 'Step 1 of 2' : 'Step 2 of 2'}
                </p>
              </div>
            </div>
          )}

          {/* Steps — content only (buttons are in the sticky footer) */}
          {step === 'intro' && (
            <div className="space-y-4">
              <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
                <p className="text-sm">
                  Your AI computer uses <strong>OpenRouter</strong> to access various AI models.
                  You'll need an API key to get started.
                </p>
                <ul className="text-sm text-[var(--color-text-muted)] space-y-1">
                  <li>• Free tier available with limited models</li>
                  <li>• Pay-as-you-go for premium models</li>
                  <li>• Your key is stored securely in your container</li>
                </ul>
              </div>
            </div>
          )}

          {step === 'apikey' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">OpenRouter API Key</Label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                  <Input
                    type="text"
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="pl-10"
                  />
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Don't have a key?{' '}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-accent)] hover:underline inline-flex items-center gap-1"
                  >
                    Get one free at OpenRouter
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}

          {step === 'model' && (
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">Choose a Model</Label>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  You can change this anytime in Settings
                </p>
              </div>

            {/* 2x2 grid of curated models */}
            <div className="grid grid-cols-2 gap-2">
              {MODELS.map((m) => {
                const info = pricingMap.get(m.id);
                const promptPrice = info?.pricing ? formatModelPrice(info.pricing.prompt) : null;
                const isSelected = model === m.id && !showCustom;
                return (
                  <button
                    key={m.id}
                    onClick={() => selectModel(m.id)}
                    className={`relative text-left px-2.5 py-2 rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]'
                        : 'bg-[var(--color-surface-raised)] border-[var(--color-border)] hover:border-[var(--color-accent)]/50'
                    }`}
                  >
                    {isSelected && (
                      <Check className="absolute top-2 right-2 w-3.5 h-3.5 text-[var(--color-accent)]" />
                    )}
                    <span className="font-medium text-[13px] block pr-4">{m.name}</span>
                    <span className="text-[11px] text-[var(--color-text-muted)] block mt-0.5 leading-snug">
                      {m.description}
                    </span>
                    {promptPrice && (
                      <span className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-px rounded-full ${
                        promptPrice === 'Free'
                          ? 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
                          : 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'
                      }`}>
                        {promptPrice === 'Free' ? 'Free' : `Input: ${promptPrice}`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Custom model option */}
            {!showCustom ? (
              <button
                onClick={selectCustom}
                className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] hover:border-[var(--color-accent)]/50 transition-colors"
              >
                <span className="text-[var(--color-text-muted)]">Use a different model...</span>
                <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              </button>
            ) : (
              <div className="border border-[var(--color-accent)] rounded-lg p-3 bg-[var(--color-accent)]/5 space-y-2">
                <Label className="text-xs font-medium">Custom Model ID</Label>
                <Input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                  placeholder="provider/model-name"
                  autoFocus
                />
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  e.g. {CUSTOM_MODEL_EXAMPLES.join(', ')}
                </p>
                {/* Custom model pricing */}
                {customModelId.trim() && (
                  <div className="text-xs">
                    {customPricingLoading ? (
                      <span className="text-[var(--color-text-muted)] flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Looking up model...
                      </span>
                    ) : customPricing ? (
                      <div className="flex items-center gap-2 text-[var(--color-success)]">
                        <Check className="w-3 h-3" />
                        <span>{customPricing.name}</span>
                        {customPricing.pricing && (
                          <span className="text-[var(--color-text-muted)]">
                            &middot; Input: {formatModelPrice(customPricing.pricing.prompt)}, Output: {formatModelPrice(customPricing.pricing.completion)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[var(--color-warning)]">
                        Model not found on OpenRouter
                      </span>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { setShowCustom(false); setCustomModelId(''); setModel(MODELS[0].id); }}
                  className="text-[11px] text-[var(--color-accent)] hover:underline"
                >
                  Back to curated models
                </button>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}

        {step === 'saving' && (
          <div className="text-center space-y-4">
            <Loader2 className="w-12 h-12 mx-auto text-[var(--color-accent)] animate-spin" />
            <p className="text-sm text-[var(--color-text-muted)]">
              Setting up your AI assistant...
            </p>
          </div>
        )}
          </div>
        </div>
      </div>

      {/* Sticky footer — buttons pinned to bottom */}
      {step !== 'saving' && (
        <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
          <div className="max-w-md w-full mx-auto">
            {step === 'intro' && (
              <Button
                variant="primary"
                className="w-full"
                onClick={() => setStep('apikey')}
              >
                Get Started
              </Button>
            )}

            {step === 'apikey' && (
              <div className="flex gap-2">
                <Button
                  variant="default"
                  className="flex-1"
                  onClick={() => setStep('intro')}
                  disabled={isValidating}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={isValidating}
                  onClick={async () => {
                    if (!apiKey.trim()) {
                      setError('Please enter your API key');
                      return;
                    }
                    
                    setError(null);
                    setIsValidating(true);
                    
                    const result = await validateOpenRouterKey(apiKey.trim());
                    
                    setIsValidating(false);
                    
                    if (result.valid) {
                      setStep('model');
                    } else {
                      setError(result.error || 'Invalid API key');
                    }
                  }}
                >
                  {isValidating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    'Continue'
                  )}
                </Button>
              </div>
            )}

            {step === 'model' && (
              <div className="flex gap-2">
                <Button
                  variant="default"
                  className="flex-1"
                  onClick={() => setStep('apikey')}
                >
                  Back
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleSave}
                  disabled={isSaving || !effectiveModel}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Complete Setup'
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
