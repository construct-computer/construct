import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useComputerStore } from '@/stores/agentStore';

/**
 * Hook to manage WebSocket connection lifecycle
 * With the new architecture, WebSocket connections are managed per-service
 * (browser, terminal, agent) rather than a single connection.
 */
export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const instanceId = useComputerStore((s) => s.instanceId);
  const browserConnected = useComputerStore((s) => s.browserState.connected);
  const terminalConnected = useComputerStore((s) => s.terminalState.connected);
  const agentConnected = useComputerStore((s) => s.agentConnected);

  // Update connected state based on any service being connected
  useEffect(() => {
    const connected = browserConnected || terminalConnected || agentConnected;
    setIsConnected(connected);
  }, [browserConnected, terminalConnected, agentConnected]);

  // Fetch computer (which auto-connects WebSockets) when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      useComputerStore.getState().fetchComputer();
    }
  }, [isAuthenticated]);

  const reconnect = useCallback(() => {
    if (instanceId) {
      useComputerStore.getState().subscribeToComputer();
    }
  }, [instanceId]);

  return { isConnected, reconnect };
}

/**
 * Hook to subscribe to a specific agent's events
 * With the new architecture, this is handled by the store
 */
export function useAgentSubscription(agentId: string | undefined) {
  const subscribeToComputer = useComputerStore((s) => s.subscribeToComputer);
  const instanceId = useComputerStore((s) => s.instanceId);

  useEffect(() => {
    // Only subscribe if the agentId matches our instance
    if (agentId && agentId === instanceId) {
      subscribeToComputer();
    }
  }, [agentId, instanceId, subscribeToComputer]);
}
