import { useState } from 'react';
import { Key, ExternalLink, Loader2, Check, Sparkles, AlertCircle } from 'lucide-react';
import { Button, Input, Label } from '@/components/ui';
import { useComputerStore } from '@/stores/agentStore';
import { useWindowStore } from '@/stores/windowStore';
import type { WindowConfig } from '@/types';

/**
 * Validate an OpenRouter API key by calling their auth endpoint
 */
async function validateOpenRouterKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (response.ok) {
      return { valid: true };
    }
    
    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }
    
    return { valid: false, error: `Validation failed (${response.status})` };
  } catch (err) {
    return { valid: false, error: 'Could not validate key. Check your connection.' };
  }
}

// Popular OpenRouter models
const MODELS = [
  { id: 'nvidia/nemotron-nano-9b-v2:free', name: 'Nemotron Nano (Free)', description: 'Great for testing, no cost' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', description: 'Excellent reasoning and coding' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'Fast and capable' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', description: 'Quick responses' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', description: 'Open source powerhouse' },
];

interface SetupWizardProps {
  config: WindowConfig;
  onComplete?: () => void;
}

export function SetupWizard({ config, onComplete }: SetupWizardProps) {
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const [step, setStep] = useState<'intro' | 'apikey' | 'model' | 'saving'>('intro');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('nvidia/nemotron-nano-9b-v2:free');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  
  const updateComputer = useComputerStore((s) => s.updateComputer);
  const fetchComputer = useComputerStore((s) => s.fetchComputer);

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setError('Please enter your OpenRouter API key');
      return;
    }
    
    setIsSaving(true);
    setError(null);
    setStep('saving');
    
    try {
      const success = await updateComputer({
        openrouterApiKey: apiKey.trim(),
        model,
      });
      
      if (success) {
        await fetchComputer();
        // Close the setup window
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
    <div className="flex flex-col h-full bg-[var(--color-surface)] overflow-auto">
      <div className="flex-1 flex flex-col items-center justify-start p-6">
        <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 mx-auto bg-[var(--color-accent)]/10 rounded-full flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-[var(--color-accent)]" />
          </div>
          <h2 className="text-xl font-semibold">Welcome to Your Computer</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Let's set up your AI assistant
          </p>
        </div>

        {/* Steps */}
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
            
            <Button
              variant="primary"
              className="w-full"
              onClick={() => setStep('apikey')}
            >
              Get Started
            </Button>
          </div>
        )}

        {step === 'apikey' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">OpenRouter API Key</Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <Input
                  type="password"
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
          </div>
        )}

        {step === 'model' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Choose a Model</Label>
              <p className="text-xs text-[var(--color-text-muted)]">
                You can change this anytime in Settings
              </p>
            </div>

            <div className="space-y-2">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    model === m.id
                      ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]'
                      : 'bg-[var(--color-surface-raised)] border-[var(--color-border)] hover:border-[var(--color-accent)]/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{m.name}</span>
                    {model === m.id && (
                      <Check className="w-4 h-4 text-[var(--color-accent)]" />
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {m.description}
                  </p>
                </button>
              ))}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

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
                disabled={isSaving}
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
  );
}
