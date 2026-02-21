import { supabase } from './supabase';

/**
 * Ensures that a valid session exists before calling Edge Functions.
 * If no session exists, creates an anonymous session.
 * Validates token by checking getUser() to avoid 401 Invalid JWT errors.
 */
export async function ensureSession(): Promise<void> {
  // 1. Check if we already have a session
  const { data: sessionData1 } = await supabase.auth.getSession();
  const token = sessionData1.session?.access_token;
  
  console.log('[ensureSession] step 1: token exists:', !!token, token ? `(${token.substring(0, 10)}...)` : '');
  
  // 2. If we have a token, validate it via getUser()
  if (token) {
    const { data: userData1, error: userError1 } = await supabase.auth.getUser();
    
    if (userError1) {
      console.log('[ensureSession] step 2: getUser() error:', userError1.message);
      console.log('[ensureSession] step 3: signing out locally (invalid token)');
      
      // Token is invalid - sign out locally (clear AsyncStorage)
      await supabase.auth.signOut();
    } else {
      console.log('[ensureSession] step 2: getUser() ok, user id:', userData1.user?.id);
      return; // Valid session, we're done
    }
  }
  
  // 3. No session or invalid token - create anonymous session
  console.log('[ensureSession] step 4: creating anonymous session');
  await supabase.auth.signInAnonymously();
  
  // 4. Verify the new session was created
  const { data: sessionData2 } = await supabase.auth.getSession();
  const newToken = sessionData2.session?.access_token;
  
  if (!newToken) {
    throw new Error('Failed to create session');
  }
  
  console.log('[ensureSession] step 5: new token created:', `${newToken.substring(0, 10)}...`);
  
  // 5. Validate the new token
  const { data: userData2, error: userError2 } = await supabase.auth.getUser();
  
  if (userError2) {
    console.error('[ensureSession] step 6: getUser() error after re-auth:', userError2.message);
    throw new Error('Invalid session after re-auth');
  }
  
  console.log('[ensureSession] step 6: getUser() ok after re-auth, user id:', userData2.user?.id);
}
