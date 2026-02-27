import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import * as api from '@/services/api';
import { browserWS, terminalWS, agentWS, type AgentEvent } from '@/services/websocket';
import type { AgentWithConfig, WindowType } from '@/types';
import { useWindowStore } from './windowStore';

// Map tool names to the window type they correspond to
function toolToWindowType(tool: string): WindowType | null {
  if (tool.startsWith('browser_')) return 'browser';
  if (tool === 'exec') return 'terminal';
  if (tool === 'file_read' || tool === 'file_write' || tool === 'file_edit') return 'editor';
  return null;
}

// Map desktop actions to window types
function desktopActionToWindowType(action: string): WindowType | null {
  switch (action) {
    case 'open_browser': return 'browser';
    case 'open_terminal': return 'terminal';
    case 'open_file':
    case 'open_editor': return 'editor';
    case 'open_settings': return 'settings';
    default: return null;
  }
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

interface BrowserState {
  url: string;
  title: string;
  screenshot: string | null;
  isLoading: boolean;
  connected: boolean;
  tabs: BrowserTab[];
  activeTabId: string | null;
}

interface TerminalState {
  output: string[];
  cwd: string;
  connected: boolean;
}

interface ComputerStore {
  // The user's single computer (instance + container)
  computer: AgentWithConfig | null;
  instanceId: string | null;
  isLoading: boolean;
  error: string | null;
  
  // API key configuration status
  hasApiKey: boolean;
  configChecked: boolean;
  
  // Real-time state for the computer
  browserState: BrowserState;
  terminalState: TerminalState;
  chatMessages: Array<{ role: 'user' | 'agent'; content: string; timestamp: Date }>;
  agentThinking: string | null;
  agentConnected: boolean;
  agentActivity: Set<WindowType>; // which apps the agent is actively using
  
  // Actions
  fetchComputer: () => Promise<void>;
  checkConfigStatus: () => Promise<void>;
  updateComputer: (data: { openrouterApiKey?: string; model?: string }) => Promise<boolean>;
  startComputer: () => Promise<boolean>;
  stopComputer: () => Promise<boolean>;
  
  // Subscriptions
  subscribeToComputer: () => void;
  unsubscribeFromComputer: () => void;
  
  // Chat
  sendChatMessage: (content: string) => void;
  
  // Terminal
  sendTerminalInput: (data: string) => void;
  
  // Browser
  setBrowserFrame: (frameBase64: string) => void;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  navigateTo: (url: string) => void;
  
  // Event handlers
  handleAgentEvent: (event: AgentEvent) => void;
}

export const useComputerStore = create<ComputerStore>()(
  subscribeWithSelector((set, get) => ({
    computer: null,
    instanceId: null,
    isLoading: false,
    error: null,
    hasApiKey: false,
    configChecked: false,
    browserState: {
      url: '',
      title: '',
      screenshot: null,
      isLoading: false,
      connected: false,
      tabs: [],
      activeTabId: null,
    },
    terminalState: {
      output: [],
      cwd: '~',
      connected: false,
    },
    chatMessages: [],
    agentThinking: null,
    agentConnected: false,
    agentActivity: new Set<WindowType>(),
    
    fetchComputer: async () => {
      const { computer: existing } = get();
      // Only show full loading state on initial fetch; subsequent calls refresh silently
      if (!existing) {
        set({ isLoading: true, error: null });
      } else {
        set({ error: null });
      }
      
      // Use the new getInstance() which creates container if needed
      const result = await api.getInstance();
      
      if (result.success) {
        const { instance, container } = result.data;
        
        // Map to legacy computer format for UI compatibility
        const computer: AgentWithConfig = {
          id: instance.id,
          userId: instance.userId,
          name: 'My Computer',
          description: 'Your personal AI computer',
          status: instance.status as AgentWithConfig['status'],
          containerId: container?.id,
          createdAt: instance.createdAt,
          updatedAt: instance.createdAt,
          config: {
            model: 'nvidia/nemotron-nano-9b-v2:free',
            goals: [],
            schedules: [],
            identityName: 'BoneClaw Agent',
            identityDescription: 'Your AI assistant',
          },
        };
        
        set({ 
          computer, 
          instanceId: instance.id,
          isLoading: false 
        });
        
        // Auto-connect WebSockets if computer is running
        if (instance.status === 'running') {
          get().subscribeToComputer();
        }
        
        // Check API key configuration status
        await get().checkConfigStatus();
      } else {
        set({ error: result.error, isLoading: false });
      }
    },
    
    checkConfigStatus: async () => {
      const { instanceId } = get();
      if (!instanceId) {
        set({ configChecked: true, hasApiKey: false });
        return;
      }
      
      const result = await api.getAgentConfigStatus(instanceId);
      if (result.success) {
        set({ 
          hasApiKey: result.data.hasApiKey,
          configChecked: true,
        });
      } else {
        // If we can't check, assume not configured
        set({ configChecked: true, hasApiKey: false });
      }
    },
    
    updateComputer: async (data) => {
      const { instanceId } = get();
      if (!instanceId) return false;
      
      const result = await api.updateAgentConfig(instanceId, {
        openrouter_api_key: data.openrouterApiKey,
        model: data.model,
      });
      
      if (result.success) {
        // Refresh config status
        await get().checkConfigStatus();
        // Refetch to get updated state
        await get().fetchComputer();
        return true;
      }
      
      return false;
    },
    
    startComputer: async () => {
      const { instanceId } = get();
      if (!instanceId) return false;
      
      // The getInstance endpoint already creates the container
      // Just refetch to ensure we have the latest state
      await get().fetchComputer();
      return true;
    },
    
    stopComputer: async () => {
      const { computer, instanceId } = get();
      if (!computer || !instanceId) return false;
      
      // Disconnect WebSockets
      get().unsubscribeFromComputer();
      
      // For now, just mark as stopped in UI
      // TODO: Add a proper stop endpoint if needed
      set({ computer: { ...computer, status: 'stopped' } });
      return true;
    },
    
    subscribeToComputer: () => {
      const { instanceId } = get();
      if (!instanceId) return;
      
      console.log('[Store] Subscribing to computer', instanceId);
      
      // Connect all WebSocket services
      browserWS.connect(instanceId);
      terminalWS.connect(instanceId);
      agentWS.connect(instanceId);
      
      // Fetch desktop state via REST as a fallback sync.
      // The agent WS also sends desktop_state on connect, but the REST call
      // covers the case where the agent WS isn't connected to the container yet.
      api.getDesktopState(instanceId).then((result) => {
        if (result.success) {
          const { windows, browser } = result.data;
          console.log('[Store] REST desktop sync:', windows);
          
          // Open windows the agent has previously opened
          for (const winType of windows) {
            useWindowStore.getState().ensureWindowOpen(winType as WindowType);
          }
          
          // Restore cached browser state
          if (browser) {
            const { browserState } = get();
            const tabs = Array.isArray(browser.tabs) ? browser.tabs.map((t: any, i: number) => ({
              id: t.id || String(i),
              url: t.url || '',
              title: t.title || 'New Tab',
              active: t.active || false,
            })) : browserState.tabs;
            const active = tabs.find((t: any) => t.active) || tabs[0];
            set({
              browserState: {
                ...browserState,
                tabs,
                activeTabId: active?.id || browserState.activeTabId,
                url: browser.url || active?.url || browserState.url,
                title: browser.title || active?.title || browserState.title,
              },
            });
          }
        }
      });
      
      // Set up event handlers
      browserWS.onFrame((frame) => {
        get().setBrowserFrame(frame);
      });
      
      browserWS.onMessage((msg) => {
        const { browserState } = get();
        if (msg.type === 'status') {
          set({
            browserState: {
              ...browserState,
              url: (msg.url as string) || browserState.url,
              title: (msg.title as string) || browserState.title,
            },
          });
        } else if (msg.type === 'tabs') {
          // Store full tabs array and extract active tab info
          const rawTabs = msg.tabs as Array<{ id?: string; url?: string; title?: string; active?: boolean }> | undefined;
          if (Array.isArray(rawTabs)) {
            const tabs: BrowserTab[] = rawTabs.map((t, i) => ({
              id: t.id || String(i),
              url: t.url || '',
              title: t.title || 'New Tab',
              active: t.active || false,
            }));
            const active = tabs.find((t) => t.active) || tabs[0];
            set({
              browserState: {
                ...browserState,
                tabs,
                activeTabId: active?.id || null,
                url: active?.url || browserState.url,
                title: active?.title || browserState.title,
                isLoading: false,
              },
            });
          }
        }
      });
      
      browserWS.onConnection((connected) => {
        set({ browserState: { ...get().browserState, connected } });
      });
      
      terminalWS.onOutput((data) => {
        const { terminalState } = get();
        set({
          terminalState: {
            ...terminalState,
            output: [...terminalState.output, data],
          },
        });
      });
      
      terminalWS.onConnection((connected) => {
        set({ terminalState: { ...get().terminalState, connected } });
      });
      
      agentWS.onEvent((event) => {
        get().handleAgentEvent(event);
      });
      
      agentWS.onConnection((connected) => {
        set({ agentConnected: connected });
      });
    },
    
    unsubscribeFromComputer: () => {
      console.log('[Store] Unsubscribing from computer');
      browserWS.disconnect();
      terminalWS.disconnect();
      agentWS.disconnect();
      
      set({
        browserState: { url: '', title: '', screenshot: null, isLoading: false, connected: false, tabs: [], activeTabId: null },
        terminalState: { output: [], cwd: '~', connected: false },
        agentConnected: false,
        agentActivity: new Set<WindowType>(),
      });
    },
    
    sendChatMessage: (content) => {
      const { instanceId, chatMessages } = get();
      if (!instanceId) return;
      
      // Add user message to chat immediately
      set({
        chatMessages: [
          ...chatMessages,
          { role: 'user', content, timestamp: new Date() },
        ],
        agentThinking: 'Processing...',
      });
      
      // Send via WebSocket
      agentWS.sendChat(content);
    },
    
    sendTerminalInput: (data) => {
      terminalWS.sendInput(data);
    },
    
    setBrowserFrame: (frameBase64) => {
      // Frame arrives as base64 string directly from the WS pipeline
      set({
        browserState: {
          ...get().browserState,
          screenshot: frameBase64,
          isLoading: false,
        },
      });
    },
    
    switchTab: (tabId) => {
      browserWS.sendAction({ type: 'switchTab', tabId });
      // Optimistically update active tab
      const { browserState } = get();
      const tabs = browserState.tabs.map((t) => ({
        ...t,
        active: t.id === tabId,
      }));
      const active = tabs.find((t) => t.active);
      set({
        browserState: {
          ...browserState,
          tabs,
          activeTabId: tabId,
          url: active?.url || browserState.url,
          title: active?.title || browserState.title,
        },
      });
    },
    
    closeTab: (tabId) => {
      browserWS.sendAction({ type: 'closeTab', tabId });
      // Optimistically remove tab
      const { browserState } = get();
      const tabs = browserState.tabs.filter((t) => t.id !== tabId);
      // If we closed the active tab, switch to the first remaining tab
      let activeTabId = browserState.activeTabId;
      if (activeTabId === tabId && tabs.length > 0) {
        activeTabId = tabs[0].id;
        tabs[0] = { ...tabs[0], active: true };
      }
      const active = tabs.find((t) => t.active) || tabs[0];
      set({
        browserState: {
          ...browserState,
          tabs,
          activeTabId: tabs.length > 0 ? activeTabId : null,
          url: active?.url || '',
          title: active?.title || '',
        },
      });
    },
    
    navigateTo: (url) => {
      browserWS.sendAction({ type: 'navigate', url });
      set({
        browserState: {
          ...get().browserState,
          isLoading: true,
        },
      });
    },
    
    handleAgentEvent: (event) => {
      const { chatMessages } = get();
      
      console.log('[Store] Agent event:', event.type, event.data);
      
      switch (event.type) {
        case 'text_delta': {
          // Streaming text from agent
          const text = event.data?.delta as string || '';
          const lastMsg = chatMessages[chatMessages.length - 1];
          
          if (lastMsg && lastMsg.role === 'agent') {
            // Append to existing agent message
            const updatedMessages = [...chatMessages];
            updatedMessages[updatedMessages.length - 1] = {
              ...lastMsg,
              content: lastMsg.content + text,
            };
            set({ chatMessages: updatedMessages, agentThinking: null });
          } else {
            // Start new agent message
            set({
              chatMessages: [
                ...chatMessages,
                { role: 'agent', content: text, timestamp: new Date() },
              ],
              agentThinking: null,
            });
          }
          break;
        }
        
        case 'thinking': {
          const thought = event.data?.content as string || 'Thinking...';
          set({ agentThinking: thought });
          break;
        }
        
        case 'tool_call': {
          const tool = event.data?.tool as string || event.data?.name as string || 'tool';
          set({ agentThinking: `Using ${tool}...` });
          
          // Auto-open/focus the relevant window
          const windowType = toolToWindowType(tool);
          if (windowType) {
            useWindowStore.getState().ensureWindowOpen(windowType);
            const activity = new Set(get().agentActivity);
            activity.add(windowType);
            set({ agentActivity: activity });
          }
          
          // Special case: desktop tool with action param
          if (tool === 'desktop') {
            const params = (event.data?.params ?? event.data?.args) as Record<string, unknown> | undefined;
            const action = params?.action as string | undefined;
            if (action) {
              const actionType = desktopActionToWindowType(action);
              if (actionType) {
                useWindowStore.getState().ensureWindowOpen(actionType);
                const activity = new Set(get().agentActivity);
                activity.add(actionType);
                set({ agentActivity: activity });
              }
              // Update browser URL if opening browser with URL
              if (action === 'open_browser') {
                const url = params?.url as string | undefined;
                if (url) {
                  set({ browserState: { ...get().browserState, url, isLoading: true } });
                }
              }
            }
          }
          break;
        }
        
        case 'tool_result': {
          const tool = event.data?.tool as string || event.data?.name as string || '';
          const windowType = toolToWindowType(tool);
          if (windowType) {
            const activity = new Set(get().agentActivity);
            activity.delete(windowType);
            set({ agentActivity: activity, agentThinking: null });
          } else {
            set({ agentThinking: null });
          }
          break;
        }
        
        case 'status_change': {
          const status = event.data?.status as string;
          if (status === 'idle') {
            set({ agentThinking: null, agentActivity: new Set<WindowType>() });
          }
          break;
        }
        
        case 'desktop_state': {
          // Initial sync: backend sends the full list of windows that should be open.
          // This fires when the agent WS connects (page load / reconnect).
          const windows = event.data?.windows as string[] | undefined;
          if (Array.isArray(windows)) {
            console.log('[Store] Syncing desktop state:', windows);
            for (const winType of windows) {
              useWindowStore.getState().ensureWindowOpen(winType as WindowType);
            }
          }
          break;
        }
        
        case 'desktop_action': {
          const action = event.data?.action as string;
          const params = event.data?.params as Record<string, unknown> | undefined;
          const windowType = desktopActionToWindowType(action);
          
          if (windowType) {
            useWindowStore.getState().ensureWindowOpen(windowType);
          }
          
          // Update browser state if opening browser with URL
          if (action === 'open_browser') {
            const url = params?.url as string | undefined;
            if (url) {
              set({ browserState: { ...get().browserState, url, isLoading: true } });
            }
          }
          break;
        }
        
        case 'error': {
          const message = event.data?.message as string || 'Unknown error';
          set({
            chatMessages: [
              ...chatMessages,
              { role: 'agent', content: `Error: ${message}`, timestamp: new Date() },
            ],
            agentThinking: null,
          });
          break;
        }
        
        default:
          break;
      }
    },
  }))
);

// Legacy alias for backward compatibility
export const useAgentStore = useComputerStore;
