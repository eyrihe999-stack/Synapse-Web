import client from './client';
import type {
  BaseResponse,
  RegisterRequest,
  LoginRequest,
  RefreshRequest,
  AuthResponse,
  UserProfile,
  UpdateProfileRequest,
} from '@/types/api';

export const authApi = {
  register: (data: RegisterRequest) =>
    client.post<BaseResponse<AuthResponse>>('/v1/auth/register', data),

  login: (data: LoginRequest) =>
    client.post<BaseResponse<AuthResponse>>('/v1/auth/login', data),

  refresh: (data: RefreshRequest) =>
    client.post<BaseResponse<AuthResponse>>('/v1/auth/refresh', data),
};

export const userApi = {
  getMe: () =>
    client.get<BaseResponse<UserProfile>>('/v1/users/me'),

  updateMe: (data: UpdateProfileRequest) =>
    client.patch<BaseResponse<UserProfile>>('/v1/users/me', data),
};
