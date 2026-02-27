import { create } from 'zustand';
import * as api from '@/services/api';
import type { User } from '@/types';
import { STORAGE_KEYS } from '@/lib/constants';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  
  // Actions
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true, // Start as loading to check existing session
  isAuthenticated: false,
  error: null,
  
  login: async (username, password) => {
    set({ isLoading: true, error: null });
    
    const result = await api.login(username, password);
    
    if (result.success) {
      set({
        user: result.data.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return true;
    } else {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: result.error,
      });
      return false;
    }
  },
  
  register: async (username, password) => {
    set({ isLoading: true, error: null });
    
    const result = await api.register(username, password);
    
    if (result.success) {
      set({
        user: result.data.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return true;
    } else {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: result.error,
      });
      return false;
    }
  },
  
  logout: () => {
    api.logout();
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  },
  
  checkAuth: async () => {
    // Check if we have a token
    const token = localStorage.getItem(STORAGE_KEYS.token);
    if (!token) {
      set({ isLoading: false, isAuthenticated: false });
      return false;
    }
    
    set({ isLoading: true });
    
    const result = await api.getMe();
    
    if (result.success) {
      set({
        user: result.data.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return true;
    } else {
      // Token invalid, clear it
      api.clearToken();
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
      return false;
    }
  },
  
  clearError: () => set({ error: null }),
}));
