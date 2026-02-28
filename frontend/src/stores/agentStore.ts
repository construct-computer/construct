import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import * as api from '@/services/api';
import { browserWS, terminalWS, agentWS, type AgentEvent } from '@/services/websocket';
import type { AgentWithConfig, WindowType } from '@/types';
import { useWindowStore } from './windowStore';

export type ChatMessageRole = 'user' | 'agent' | 'activity';

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
  timestamp: Date;
  /** For activity messages: which tool triggered it */
  tool?: string;
  /** For activity messages: icon hint for rendering */
  activityType?: 'browser' | 'terminal' | 'file' | 'desktop' | 'tool';
}

/** Build a human-readable activity description from a tool_call event */
function describeToolCall(tool: string, params?: Record<string, unknown>): { text: string; activityType: ChatMessage['activityType'] } {
  const p = params || {};

  // Browser tools
  if (tool === 'browser' || tool.startsWith('browser_')) {
    const action = (p.action as string) || tool.replace('browser_', '');
    const url = p.url as string | undefined;
    const text = p.text as string | undefined;
    const selector = p.selector as string | undefined;
    const ref = p.ref as string | undefined;

    switch (action) {
      case 'navigate':
      case 'browser_navigate':
        return { text: `Navigating to ${url || 'page'}`, activityType: 'browser' };
      case 'click':
      case 'browser_click':
        return { text: `Clicking ${text ? `"${text}"` : selector || ref || 'element'}`, activityType: 'browser' };
      case 'type':
      case 'browser_type':
        return { text: `Typing "${(p.text as string || '').slice(0, 50)}${(p.text as string || '').length > 50 ? '...' : ''}"`, activityType: 'browser' };
      case 'scroll':
      case 'browser_scroll':
        return { text: `Scrolling ${(p.direction as string) || 'page'}`, activityType: 'browser' };
      case 'snapshot':
      case 'browser_snapshot':
        return { text: 'Reading page content', activityType: 'browser' };
      case 'screenshot':
      case 'browser_screenshot':
        return { text: 'Taking screenshot', activityType: 'browser' };
      case 'tab_new':
      case 'browser_tab_new':
        return { text: `Opening new tab${url ? `: ${url}` : ''}`, activityType: 'browser' };
      case 'tab_close':
      case 'browser_tab_close':
        return { text: 'Closing tab', activityType: 'browser' };
      case 'tab_switch':
      case 'browser_tab_switch':
        return { text: `Switching to tab ${p.tabId || ''}`, activityType: 'browser' };
      default:
        return { text: `Browser: ${action}`, activityType: 'browser' };
    }
  }

  // Terminal / exec
  if (tool === 'exec') {
    const cmd = (p.command as string) || '';
    const display = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
    return { text: `Running \`${display}\``, activityType: 'terminal' };
  }

  // File tools
  if (tool === 'read' || tool === 'file_read') {
    return { text: `Reading ${p.path || p.file || 'file'}`, activityType: 'file' };
  }
  if (tool === 'write' || tool === 'file_write') {
    return { text: `Writing ${p.path || p.file || 'file'}`, activityType: 'file' };
  }
  if (tool === 'edit' || tool === 'file_edit') {
    return { text: `Editing ${p.path || p.file || 'file'}`, activityType: 'file' };
  }
  if (tool === 'list') {
    return { text: `Listing ${p.path || p.directory || '.'}`, activityType: 'file' };
  }

  // Desktop tool
  if (tool === 'desktop') {
    const action = p.action as string | undefined;
    return { text: `Desktop: ${action || 'action'}`, activityType: 'desktop' };
  }

  // Generic fallback
  return { text: `Using ${tool}`, activityType: 'tool' };
}

// Map tool names to the window type they correspond to
function toolToWindowType(tool: string): WindowType | null {
  // Handle both MCP-style (browser_*) and boneclaw-style (browser) tool names
  if (tool === 'browser' || tool.startsWith('browser_')) return 'browser';
  if (tool === 'exec') return 'terminal';
  if (tool === 'read' || tool === 'write' || tool === 'edit' || tool === 'list') return 'editor';
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

export interface SystemStats {
  cpuPercent: number;
  cpuCount: number;
  memUsedBytes: number;
  memTotalBytes: number;
  pids: number;
  netInSpeed: number;   // bytes/sec (download)
  netOutSpeed: number;  // bytes/sec (upload)
  netInBytes: number;   // cumulative (for delta tracking)
  netOutBytes: number;  // cumulative (for delta tracking)
  uptime: number;       // seconds
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
  chatMessages: ChatMessage[];
  agentThinking: string | null;
  agentConnected: boolean;
  agentActivity: Set<WindowType>; // which apps the agent is actively using
  systemStats: SystemStats | null;
  
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
    systemStats: null,
    
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
            model: 'nvidia/nemotron-3-nano-30b-a3b:free',
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
      
      // Connect browser + agent WebSockets.
      // Terminal WS is NOT connected here — TerminalWindow owns its lifecycle
      // to ensure xterm receives the initial bash prompt.
      browserWS.connect(instanceId);
      agentWS.connect(instanceId);
      
      // Fetch desktop state via REST as a fallback sync.
      // The agent WS also sends desktop_state on connect, but the REST call
      // covers the case where the agent WS isn't connected to the container yet.
      api.getDesktopState(instanceId).then((result) => {
        if (result.success) {
          const { windows, browser } = result.data;
          console.log('[Store] REST desktop sync:', windows);
          
          // Open restored windows in a tidy grid layout
          if (windows.length > 0) {
            useWindowStore.getState().openWindowsGrid(windows as WindowType[]);
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
        if (msg.type === 'stats') {
          const netInBytes = (msg.netInBytes as number) || 0;
          const netOutBytes = (msg.netOutBytes as number) || 0;
          const prev = get().systemStats;
          // Compute speed from delta between polls (5s interval)
          const dt = 5;
          let netInSpeed = 0;
          let netOutSpeed = 0;
          if (prev && prev.netInBytes > 0) {
            netInSpeed = Math.max(0, (netInBytes - prev.netInBytes) / dt);
            netOutSpeed = Math.max(0, (netOutBytes - prev.netOutBytes) / dt);
          }
          set({
            systemStats: {
              cpuPercent: (msg.cpuPercent as number) || 0,
              cpuCount: (msg.cpuCount as number) || 1,
              memUsedBytes: (msg.memUsedBytes as number) || 0,
              memTotalBytes: (msg.memTotalBytes as number) || 0,
              pids: (msg.pids as number) || 0,
              netInSpeed,
              netOutSpeed,
              netInBytes,
              netOutBytes,
              uptime: (msg.uptime as number) || 0,
            },
          });
        } else if (msg.type === 'status') {
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
        systemStats: null,
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
          const params = (event.data?.params ?? event.data?.args ?? event.data?.input) as Record<string, unknown> | undefined;
          
          // Build descriptive activity message
          const { text: activityText, activityType } = describeToolCall(tool, params);
          set({ agentThinking: activityText + '...' });
          
          // Add activity log to chat
          const { chatMessages: msgs } = get();
          set({
            chatMessages: [
              ...msgs,
              {
                role: 'activity' as const,
                content: activityText,
                timestamp: new Date(),
                tool,
                activityType,
              },
            ],
          });
          
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
          
          // Extract screenshot from browser tool results as fallback frame
          if (tool.startsWith('browser_')) {
            const result = event.data?.result as Record<string, unknown> | undefined;
            const screenshot = (result?.screenshot ?? event.data?.screenshot) as string | undefined;
            if (screenshot) {
              get().setBrowserFrame(screenshot);
            }
            // Update URL/title from navigation results
            const url = (result?.url ?? event.data?.url) as string | undefined;
            const title = (result?.title ?? event.data?.title) as string | undefined;
            if (url || title) {
              const { browserState } = get();
              set({
                browserState: {
                  ...browserState,
                  url: url || browserState.url,
                  title: title || browserState.title,
                  isLoading: false,
                },
              });
            }
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
          if (Array.isArray(windows) && windows.length > 0) {
            console.log('[Store] Syncing desktop state:', windows);
            useWindowStore.getState().openWindowsGrid(windows as WindowType[]);
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
        
        case 'browser:screenshot': {
          // Fallback frame source — agent took a screenshot via browser tool.
          // Use it to update the browser view if the streaming pipeline isn't delivering frames.
          const base64 = event.data?.data as string || event.data?.screenshot as string;
          if (base64) {
            get().setBrowserFrame(base64);
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
