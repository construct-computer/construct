import { useState, useEffect } from 'react';
import { Moon, Sun, Volume2, VolumeX, Key, Cpu, Loader2, Check, Image } from 'lucide-react';
import { Button, Label, Checkbox, Separator, Input } from '@/components/ui';
import { useSettingsStore, WALLPAPERS, getWallpaperSrc } from '@/stores/settingsStore';
import { useComputerStore } from '@/stores/agentStore';
import type { WindowConfig } from '@/types';

// Popular OpenRouter models
const MODELS = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
  { id: 'nvidia/nemotron-nano-9b-v2:free', name: 'Nemotron Nano (Free)' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
];

interface SettingsWindowProps {
  config: WindowConfig;
}

export function SettingsWindow({ config: _config }: SettingsWindowProps) {
  const { theme, soundEnabled, wallpaperId, toggleTheme, toggleSound, setWallpaper } =
    useSettingsStore();
  
  const { computer, updateComputer, fetchComputer } = useComputerStore();
  
  // AI configuration state
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Load current config
  useEffect(() => {
    if (computer?.config) {
      setModel(computer.config.model || 'nvidia/nemotron-nano-9b-v2:free');
      // Don't load the actual API key for security - just show placeholder
    }
  }, [computer?.config]);
  
  const handleSaveAI = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    
    const updates: { openrouterApiKey?: string; model?: string } = { model };
    if (apiKey.trim()) {
      updates.openrouterApiKey = apiKey.trim();
    }
    
    const success = await updateComputer(updates);
    
    if (success) {
      setSaveSuccess(true);
      setApiKey(''); // Clear the input after saving
      await fetchComputer(); // Refresh to get updated config
      setTimeout(() => setSaveSuccess(false), 2000);
    }
    
    setIsSaving(false);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] overflow-auto">
      <div className="p-4 space-y-4">
        <h2 className="text-lg font-medium">Settings</h2>
        
        {/* AI Configuration */}
        <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface-raised)]">
          <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            AI Configuration
          </h3>
          <div className="space-y-3">
            {/* OpenRouter API Key */}
            <div>
              <Label className="text-xs mb-1 block">OpenRouter API Key</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Key className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={computer?.config?.model ? '••••••••••••••••' : 'sk-or-...'}
                    className="pl-8 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Get your API key from{' '}
                <a 
                  href="https://openrouter.ai/keys" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-[var(--color-accent)] hover:underline"
                >
                  openrouter.ai/keys
                </a>
              </p>
            </div>
            
            {/* Model Selection */}
            <div>
              <Label className="text-xs mb-1 block">Model</Label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full h-8 px-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-input)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Save Button */}
            <Button
              size="sm"
              variant="primary"
              onClick={handleSaveAI}
              disabled={isSaving}
              className="w-full"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Saving...
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="w-4 h-4 mr-1" />
                  Saved!
                </>
              ) : (
                'Save AI Settings'
              )}
            </Button>
          </div>
        </div>
        
        <Separator />
      
          {/* Appearance */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-2">
            Appearance
          </h3>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {theme === 'dark' ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
              <Label>Theme</Label>
            </div>
            <Button variant="default" size="sm" onClick={toggleTheme}>
              {theme === 'dark' ? 'Dark' : 'Light'}
            </Button>
          </div>

          {/* Wallpaper picker */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Image className="w-4 h-4" />
              <Label>Wallpaper</Label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {WALLPAPERS.map((wp) => (
                <button
                  key={wp.id}
                  onClick={() => setWallpaper(wp.id)}
                  className="relative rounded-lg overflow-hidden border-2 transition-all duration-150 focus:outline-none"
                  style={{
                    borderColor: wallpaperId === wp.id ? 'var(--color-accent)' : 'var(--color-border)',
                    boxShadow: wallpaperId === wp.id ? '0 0 0 1px var(--color-accent)' : 'none',
                  }}
                >
                  <div
                    className="w-full aspect-video"
                    style={{
                      backgroundImage: `url(${getWallpaperSrc(wp.id)})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 px-2 py-1 text-[10px] font-medium truncate"
                    style={{
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                      color: 'rgba(255,255,255,0.85)',
                    }}
                  >
                    {wp.name}
                  </div>
                  {wallpaperId === wp.id && (
                    <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <Separator />
        
        {/* Sound & Window Management */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {soundEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4" />
              )}
              <Label>UI Sounds</Label>
            </div>
            <Checkbox
              checked={soundEnabled}
              onCheckedChange={toggleSound}
            />
          </div>
          
        </div>
        
        <Separator />
        
        {/* Keyboard Shortcuts */}
        <div>
          <h3 className="text-sm font-medium text-[var(--color-text-muted)] mb-2">
            Keyboard Shortcuts
          </h3>
          <div className="text-xs space-y-1 text-[var(--color-text-muted)]">
            <div className="flex justify-between">
              <span>Close window</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded">
                Alt+F4
              </kbd>
            </div>
            <div className="flex justify-between">
              <span>Minimize</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded">
                Alt+M
              </kbd>
            </div>
            <div className="flex justify-between">
              <span>Maximize</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded">
                Alt+Enter
              </kbd>
            </div>
            <div className="flex justify-between">
              <span>Cycle windows</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded">
                Alt+Tab
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
