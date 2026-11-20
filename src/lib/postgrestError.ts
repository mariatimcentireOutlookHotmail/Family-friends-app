/** The shape of an error returned by Supabase database calls (PostgREST). */
export type PostgrestErrorLike = { message: string; code: string; details?: string | null; hint?: string | null };

export function isPostgrestError(error: unknown): error is PostgrestErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}
