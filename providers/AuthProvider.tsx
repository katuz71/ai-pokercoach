import { Session, User } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAnonymous: boolean;
  signInAnonymously: () => Promise<void>;
  linkAccount: (email: string, password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const signInAnonymously = async () => {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      setUser(data.user);
      setSession(data.session);
    } catch (error) {
      console.error('[AuthProvider] Anonymous sign-in failed:', error);
    }
  };

  const linkAccount = async (email: string, password: string) => {
    try {
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({ 
        email, 
        password 
      });
      
      if (updateError) throw updateError;

      // Force session refresh
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      
      if (refreshError) throw refreshError;

      // Explicitly update the React state to trigger a re-render
      if (refreshData.session?.user) {
        setUser(refreshData.session.user);
        setSession(refreshData.session);
      } else if (updateData.user) {
        setUser(updateData.user);
      }
    } catch (error) {
      console.error('[AuthProvider] Account linking failed:', error);
      throw error;
    }
  };

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      // If no session, sign in anonymously
      if (!session) {
        signInAnonymously().finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const isAnonymous = user?.is_anonymous ?? false;

  return (
    <AuthContext.Provider value={{ user, session, loading, isAnonymous, signInAnonymously, linkAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
