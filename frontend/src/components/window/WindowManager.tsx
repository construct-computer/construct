import { useWindowStore } from '@/stores/windowStore';
import { Window } from './Window';
import { BrowserWindow } from '@/components/apps/BrowserWindow';
import { TerminalWindow } from '@/components/apps/TerminalWindow';
import { FilesWindow } from '@/components/apps/FilesWindow';
import { EditorWindow } from '@/components/apps/EditorWindow';
import { ChatWindow } from '@/components/apps/ChatWindow';
import { SettingsWindow } from '@/components/apps/SettingsWindow';
import { ComputerWindow } from '@/components/apps/ComputerWindow';
import { AboutWindow } from '@/components/apps/AboutWindow';
import { SetupWizard } from '@/components/apps/SetupWizard';
import type { WindowConfig, WindowType } from '@/types';

// Map window types to their content components
const windowComponents: Record<WindowType, React.ComponentType<{ config: WindowConfig }>> = {
  browser: BrowserWindow,
  terminal: TerminalWindow,
  files: FilesWindow,
  editor: EditorWindow,
  chat: ChatWindow,
  settings: SettingsWindow,
  computer: ComputerWindow,
  about: AboutWindow,
  setup: SetupWizard,
};

export function WindowManager() {
  const windows = useWindowStore((s) => s.windows);
  
  return (
    <>
      {windows.map((config) => {
        const ContentComponent = windowComponents[config.type];
        
        if (!ContentComponent) {
          console.warn(`Unknown window type: ${config.type}`);
          return null;
        }
        
        return (
          <Window key={config.id} config={config}>
            <ContentComponent config={config} />
          </Window>
        );
      })}
    </>
  );
}
