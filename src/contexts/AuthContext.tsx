import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiGet } from '../lib/api.ts';
import {
  ensureUserProfileAndProviders,
  subscribeUserProfile,
  updateUserProfile,
  wipeAllUserData,
} from '../lib/db.ts';
import type { UserProfile } from '../shared/providers.ts';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  authReady: boolean;
  serverAvailability: Record<string, boolean>;
  theme: 'light' | 'dark';
  toggleTheme: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string, mode: 'login' | 'signup') => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [serverAvailability, setServerAvailability] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // Sync theme class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setUser(firebaseUser);
      if (!firebaseUser) {
        setProfile(null);
        setServerAvailability({});
        setAuthReady(true);
        return;
      }

      try {
        const availabilityRes = await apiGet<{ availability: Record<string, boolean> }>(
          '/api/providers/server-availability'
        ).catch(() => ({ availability: {} }));
        setServerAvailability(availabilityRes.availability || {});

        await ensureUserProfileAndProviders(
          firebaseUser.uid,
          firebaseUser.email || '',
          firebaseUser.displayName || '',
          availabilityRes.availability || {}
        );

        unsubProfile = subscribeUserProfile(firebaseUser.uid, (loaded) => {
          setProfile(loaded);
          if (loaded?.theme === 'light' || loaded?.theme === 'dark') {
            setTheme(loaded.theme);
          }
        });
      } catch (err) {
        console.error('Failed to initialize user workspace:', err);
      } finally {
        setAuthReady(true);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleAuthProvider);
  };

  const signInWithEmail = async (
    email: string,
    password: string,
    mode: 'login' | 'signup'
  ) => {
    if (mode === 'signup') {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const toggleTheme = async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (user) {
      await updateUserProfile(user.uid, { theme: next });
    }
  };

  const deleteAccount = async () => {
    if (!user) return;
    await wipeAllUserData(user.uid);
    await deleteUser(user);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        serverAvailability,
        theme,
        toggleTheme,
        signInWithGoogle,
        signInWithEmail,
        logout,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
