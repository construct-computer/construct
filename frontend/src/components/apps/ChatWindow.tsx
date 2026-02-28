import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Loader2, Globe, Terminal, FileText, Monitor, Wrench } from 'lucide-react';
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
    case 'terminal': return <Terminal className={cls} />;
    case 'file': return <FileText className={cls} />;
    case 'desktop': return <Monitor className={cls} />;
    default: return <Wrench className={cls} />;
  }
}

interface ChatWindowProps {
  config: WindowConfig;
}

export function ChatWindow({ config: _config }: ChatWindowProps) {
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { play } = useSound();
  
  // Get computer and chat state
  const computer = useComputerStore((s) => s.computer);
  const instanceId = useComputerStore((s) => s.instanceId);
  const hasApiKey = useComputerStore((s) => s.hasApiKey);
  const chatMessages = useComputerStore((s) => s.chatMessages);
  const agentThinking = useComputerStore((s) => s.agentThinking);
  const agentConnected = useComputerStore((s) => s.agentConnected);
  const sendChatMessage = useComputerStore((s) => s.sendChatMessage);
  
  // Check if the user's computer is running (only one computer per user)
  const isConnected = computer && computer.status === 'running';

  // Connect to agent WebSocket when computer is available
  useEffect(() => {
    if (isConnected && instanceId) {
      console.log('[Chat] Connecting to agent', instanceId);
      agentWS.connect(instanceId);
    }
  }, [isConnected, instanceId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, agentThinking]);

  const handleSend = () => {
    if (!message.trim() || !isConnected) return;
    
    play('click');
    sendChatMessage(message);
    setMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Show message if API key not configured
  const needsSetup = !hasApiKey;

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      {/* Chat header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <Bot className="w-4 h-4 text-[var(--color-accent)]" />
        <span className="text-sm font-medium">
          {isConnected ? `Construct Agent` : 'Construct Agent'}
        </span>
        {isConnected && (
          <span className="text-xs text-[var(--color-text-muted)]">
            ({agentConnected ? 'connected' : 'connecting...'})
          </span>
        )}
      </div>
      
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
          // Activity messages: compact inline log entries
          if (msg.role === 'activity') {
            return (
              <div key={index} className="flex items-center gap-2 px-2 py-1">
                <div className="w-5 h-5 shrink-0 rounded-full bg-[var(--color-border)] flex items-center justify-center text-[var(--color-text-muted)]">
                  <ActivityIcon type={msg.activityType} />
                </div>
                <span className="text-xs text-[var(--color-text-muted)] truncate">
                  {msg.content}
                </span>
                <span className="text-xs text-[var(--color-text-subtle)] ml-auto shrink-0">
                  {msg.timestamp.toLocaleTimeString()}
                </span>
              </div>
            );
          }

          // User and agent messages
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
        
        {/* Thinking / working indicator */}
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
            placeholder={isConnected ? 'Type a message...' : 'Start your computer first'}
            disabled={!isConnected}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            size="icon"
            disabled={!isConnected || !message.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
