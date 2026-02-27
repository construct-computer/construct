export interface User {
  id: string;
  username: string;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface ApiError {
  error: string;
}

export type ApiResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string };
