import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Send, Square, Bot, User, Loader2, Globe, Terminal, FileText, Monitor, Wrench, SquarePen, ChevronDown, Trash2, MessageSquare, Zap } from 'lucide-react';
import { Button, Input, MarkdownRenderer } from '@/components/ui';
import { useComputerStore, type ChatMessage } from '@/stores/agentStore';
import { agentWS } from '@/services/websocket';
import { useSound } from '@/hooks/useSound';
import type { WindowConfig } from '@/types';

/** Return an icon component for activity messages based on type */
function ActivityIcon({ type }: { type?: ChatMessage['activityType'] }) {
  const cls = "w-3 h-3";
  switch (type) {
    case 'browser': return <Globe className={cls} />;
    case 'tinyfish': return <Zap className={cls} />;
    case 'terminal': return <Terminal className={cls} />;
    case 'file': return <FileText className={cls} />;
    case 'desktop': return <Monitor className={cls} />;
    default: return <Wrench className={cls} />;
  }
}

// ── Session Picker Dropdown (portaled for backdrop-blur) ─────────

interface SessionDropdownProps {
  anchorRect: DOMRect;
  onClose: () => void;
}

function SessionDropdown({ anchorRect, onClose }: SessionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { play } = useSound();

  const chatSessions = useComputerStore((s) => s.chatSessions);
  const activeSessionKey = useComputerStore((s) => s.activeSessionKey);
  const createSession = useComputerStore((s) => s.createSession);
  const switchSession = useComputerStore((s) => s.switchSession);
  const deleteSession = useComputerStore((s) => s.deleteSession);
  const renameSession = useComputerStore((s) => s.renameSession);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  // Focus the input when editing starts
  useEffect(() => {
    if (editingKey) editRef.current?.focus();
  }, [editingKey]);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const id = setTimeout(() => document.addEventListener('mousedown', handle), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handle);
    };
  }, [onClose]);

  // Close on Escape (cancel editing first if active)
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingKey) { setEditingKey(null); }
        else { onClose(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose, editingKey]);

  const handleNew = () => {
    play('click');
    createSession();
    onClose();
  };

  const handleSwitch = (key: string) => {
    if (editingKey) return; // don't switch while editing
    if (key === activeSessionKey) { onClose(); return; }
    play('click');
    switchSession(key);
    onClose();
  };

  const handleDelete = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    play('click');
    deleteSession(key);
    if (editingKey === key) setEditingKey(null);
  };

  const startRename = (e: React.MouseEvent, key: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingKey(key);
    setEditValue(currentTitle);
  };

  const commitRename = (key: string) => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed.length <= 64) {
      renameSession(key, trimmed);
    }
    setEditingKey(null);
  };

  // Position below the anchor trigger
  const top = anchorRect.bottom + 4;
  const left = anchorRect.left;

  return createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[9999] w-56 rounded-lg border border-white/20 dark:border-white/10 bg-white/60 dark:bg-neutral-900/50 backdrop-blur-2xl shadow-2xl overflow-hidden"
      style={{ top, left }}
    >
      {/* New chat */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--color-accent)] hover:bg-white/40 dark:hover:bg-white/10 transition-colors border-b border-black/5 dark:border-white/10"
        onClick={handleNew}
      >
        <SquarePen className="w-3.5 h-3.5" />
        New Chat
      </button>

      {/* Session list */}
      <div className="max-h-52 overflow-y-auto py-1">
        {chatSessions.map((session) => (
          <button
            key={session.key}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors group ${
              session.key === activeSessionKey
                ? 'bg-white/40 dark:bg-white/10 font-medium'
                : 'hover:bg-white/30 dark:hover:bg-white/5'
            }`}
            onClick={() => handleSwitch(session.key)}
          >
            <MessageSquare className="w-3 h-3 shrink-0 opacity-40" />

            {editingKey === session.key ? (
              <input
                ref={editRef}
                className="flex-1 min-w-0 bg-white/60 dark:bg-white/10 rounded px-1 py-0.5 text-xs outline-none border border-[var(--color-accent)]/50 focus:border-[var(--color-accent)]"
                value={editValue}
                maxLength={64}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitRename(session.key);
                  if (e.key === 'Escape') setEditingKey(null);
                }}
                onBlur={() => commitRename(session.key)}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="truncate flex-1 text-left"
                onDoubleClick={(e) => startRename(e, session.key, session.title)}
                title="Double-click to rename"
              >
                {session.title}
              </span>
            )}

            <span
              role="button"
              className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-70 hover:!opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity"
              onClick={(e) => handleDelete(e, session.key)}
              title="Delete chat"
            >
              <Trash2 className="w-3 h-3" />
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ── Main ChatWindow ──────────────────────────────────────────────

interface ChatWindowProps {
  config: WindowConfig;
}

export function ChatWindow({ config: _config }: ChatWindowProps) {
  const [message, setMessage] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { play } = useSound();

  const computer = useComputerStore((s) => s.computer);
  const instanceId = useComputerStore((s) => s.instanceId);
  const hasApiKey = useComputerStore((s) => s.hasApiKey);
  const chatMessages = useComputerStore((s) => s.chatMessages);
  const agentThinking = useComputerStore((s) => s.agentThinking);
  const agentConnected = useComputerStore((s) => s.agentConnected);
  const sendChatMessage = useComputerStore((s) => s.sendChatMessage);
  const chatSessions = useComputerStore((s) => s.chatSessions);
  const activeSessionKey = useComputerStore((s) => s.activeSessionKey);
  const createSession = useComputerStore((s) => s.createSession);

  const isConnected = computer && computer.status === 'running';
  const activeSession = chatSessions.find(s => s.key === activeSessionKey);
  const needsSetup = !hasApiKey;

  // Connect to agent WS
  useEffect(() => {
    if (isConnected && instanceId) {
      agentWS.connect(instanceId);
    }
  }, [isConnected, instanceId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, agentThinking]);

  const toggleDropdown = useCallback(() => {
    if (dropdownOpen) {
      setDropdownOpen(false);
    } else {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        setAnchorRect(rect);
        setDropdownOpen(true);
      }
    }
  }, [dropdownOpen]);

  const isBusy = !!agentThinking;

  const handleSend = () => {
    if (!message.trim() || !isConnected) return;
    play('click');
    sendChatMessage(message);
    setMessage('');
  };

  const handleStop = () => {
    play('click');
    agentWS.sendAbort();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    play('click');
    createSession();
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        {/* Status dot */}
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            agentConnected
              ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]'
              : isConnected
              ? 'bg-amber-400 animate-pulse'
              : 'bg-neutral-400'
          }`}
          title={agentConnected ? 'Online' : isConnected ? 'Connecting' : 'Offline'}
        />

        {/* Session title — opens dropdown */}
        <button
          ref={triggerRef}
          className="flex items-center gap-0.5 text-xs font-medium hover:text-[var(--color-accent)] transition-colors min-w-0"
          onClick={toggleDropdown}
        >
          <span className="truncate">{activeSession?.title || 'Chat'}</span>
          <ChevronDown className={`w-3 h-3 shrink-0 opacity-40 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        <div className="flex-1" />

        {/* New chat */}
        <button
          className="p-1 rounded-md hover:bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
          onClick={handleNewChat}
          title="New Chat"
        >
          <SquarePen className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Portal dropdown */}
      {dropdownOpen && anchorRect && (
        <SessionDropdown
          anchorRect={anchorRect}
          onClose={() => setDropdownOpen(false)}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {chatMessages.length === 0 && !agentThinking && (
          <div className="text-center text-[var(--color-text-muted)] py-8">
            <Bot className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1 opacity-50">
              {needsSetup
                ? 'Complete the setup wizard to start chatting'
                : isConnected
                ? 'Send a message to start a conversation'
                : 'Start your computer to begin chatting'}
            </p>
          </div>
        )}

        {chatMessages.map((msg, index) => {
          if (msg.role === 'activity') {
            const isTinyfish = msg.activityType === 'tinyfish';
            return (
              <div key={index} className="flex items-center gap-2 px-2 py-1">
                <div className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center ${
                  isTinyfish
                    ? 'bg-amber-500/20 text-amber-500'
                    : 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
                }`}>
                  <ActivityIcon type={msg.activityType} />
                </div>
                <span className={`text-xs truncate ${
                  isTinyfish ? 'text-amber-400/80' : 'text-[var(--color-text-muted)]'
                }`}>
                  {msg.content}
                </span>
                <span className="text-xs text-[var(--color-text-subtle)] ml-auto shrink-0">
                  {msg.timestamp.toLocaleTimeString()}
                </span>
              </div>
            );
          }

          return (
            <div
              key={index}
              className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'agent' && (
                <div className="w-6 h-6 shrink-0 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}

              <div
                className={`max-w-[80%] px-3 py-2 text-sm rounded-xl ${
                  msg.role === 'user'
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface-raised)] border border-[var(--color-border)]'
                }`}
              >
                <MarkdownRenderer content={msg.content} plain={msg.role === 'user'} />
                <p className={`text-xs mt-1 ${msg.role === 'user' ? 'opacity-70' : 'text-[var(--color-text-muted)]'}`}>
                  {msg.timestamp.toLocaleTimeString()}
                </p>
              </div>

              {msg.role === 'user' && (
                <div className="w-6 h-6 shrink-0 rounded-full bg-[var(--color-text-muted)] flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          );
        })}

        {agentThinking && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 shrink-0 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-xl px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{agentThinking}</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--color-border)] p-2">
        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? (isBusy ? 'Agent is working...' : 'Type a message...') : 'Start your computer first'}
            disabled={!isConnected}
            className="flex-1"
          />
          {isBusy ? (
            <Button
              onClick={handleStop}
              size="icon"
              className="!bg-red-500/80 hover:!bg-red-500 text-white"
              title="Stop agent"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              size="icon"
              disabled={!isConnected || !message.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
