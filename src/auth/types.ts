export interface PublicUser {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string;
  businessType: string;
  hasBusiness: boolean;
  email: string;
  language: string;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface SignUpInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface LogInInput {
  email: string;
  password: string;
}

export interface ProfileInput {
  companyName: string;
  businessType: string;
}

export interface AccountNamesInput {
  firstName?: string;
  lastName?: string;
}

export interface ForgotPasswordInput {
  firstName: string;
  lastName: string;
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

export interface ForgotPasswordResult {
  message: string;
  resetToken?: string;
}