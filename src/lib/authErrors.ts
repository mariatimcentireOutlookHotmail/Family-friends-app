import { isAuthError } from "@supabase/supabase-js";

/** Keys under "errors" in the auth translation files. */
export type AuthErrorKey =
  | "rateLimited"
  | "invalidEmail"
  | "notAuthorized"
  | "codeInvalid"
  | "network"
  | "generic";

/** Turn a Supabase Auth error into a message key people can understand. */
export function authErrorKey(error: unknown): AuthErrorKey {
  if (!isAuthError(error)) return "network";
  switch (error.code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "rateLimited";
    case "email_address_invalid":
    case "validation_failed":
      return "invalidEmail";
    case "email_address_not_authorized":
      return "notAuthorized";
    case "otp_expired":
      return "codeInvalid";
  }
  if (error.status === 429) return "rateLimited";
  // Retryable fetch errors have no HTTP status: the request never got through.
  if (!error.status) return "network";
  return "generic";
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
