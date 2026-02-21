// @ts-nocheck — Supabase Edge Functions run on Deno; type-check with Deno or supabase functions serve
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

/**
 * Custom error for authentication failures
 * Contains status code and body for error response
 */
export class AuthError extends Error {
  status: number;
  body: any;

  constructor(status: number, body: any) {
    super(body.error);
    this.status = status;
    this.body = body;
    this.name = 'AuthError';
  }
}

/**
 * Helper to throw authentication errors
 */
export function authError(status: number, body: any): never {
  throw new AuthError(status, body);
}

/**
 * Require and validate user authentication from request
 * 
 * @param req - The incoming request
 * @returns Object containing userId and user-scoped Supabase client
 * @throws AuthError if authentication fails
 */
export async function requireUserClient(req: Request): Promise<{
  userId: string;
  supabaseUser: any;
}> {
  // a) Read x-user-jwt from headers
  const userJwt = req.headers.get('x-user-jwt');
  if (!userJwt) {
    authError(401, { error: 'missing_user_jwt' });
  }

  // Get environment variables
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  
  if (!supabaseUrl || !supabaseAnonKey) {
    authError(500, { error: 'Missing Supabase configuration' });
  }

  // b) Create supabase client (anon)
  const supabaseAnon = createClient(supabaseUrl!, supabaseAnonKey!);

  // c) Validate JWT correctly by passing it explicitly
  const { data, error } = await supabaseAnon.auth.getUser(userJwt);

  if (error || !data?.user) {
    authError(401, {
      error: 'invalid_user_jwt',
      detail: error?.message ?? 'no_user',
    });
  }

  // d) Extract userId
  const userId = data.user.id;

  // e) Create user-scoped client for RLS queries
  const supabaseUser = createClient(supabaseUrl!, supabaseAnonKey!, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });

  // f) Return userId and user-scoped client
  return { userId, supabaseUser };
}
