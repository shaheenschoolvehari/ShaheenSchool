'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export interface Permission {
    module_name: string;
    can_read: boolean;
    can_write: boolean;
    can_delete: boolean;
}

export interface AuthUser {
    id: number;
    username: string;
    full_name: string;
    email: string;
    role_id: number;
    role_name: string;
    role_level?: number;
    is_active: boolean;
    permissions: Permission[];
}

interface AuthContextType {
    user: AuthUser | null;
    isLoggedIn: boolean;
    isLoading: boolean;
    login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
    logout: () => void;
    hasPermission: (module: string, action?: 'read' | 'write' | 'delete') => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'sms_user_session';
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com";

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    // Restore session from sessionStorage on mount
    useEffect(() => {
        try {
            const stored = sessionStorage.getItem(SESSION_KEY);
            if (stored) {
                setUser(JSON.parse(stored));
            }
        } catch {
            sessionStorage.removeItem(SESSION_KEY);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const login = useCallback(async (username: string, password: string): Promise<{ success: boolean; message?: string }> => {
        try {
            const res = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                return { success: false, message: data.message || 'Login failed' };
            }

            setUser(data);
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
            return { success: true };
        } catch (err) {
            return { success: false, message: 'Cannot connect to server. Please try again.' };
        }
    }, []);

    const logout = useCallback(() => {
        setUser(null);
        sessionStorage.removeItem(SESSION_KEY);
        router.push('/login');
    }, [router]);

    // Returns true if Administrator/Supervisor can access, OR if role has explicit permission.
    // Supports both module-level ('attendance') and page-level ('attendance.daily') keys.
    // Hierarchy: Admin (>=90) > Supervisor (>=65) > Role permissions
    const hasPermission = useCallback((module: string, action: 'read' | 'write' | 'delete' = 'read'): boolean => {
        if (!user) return false;
        
        const roleLevel = user.role_level || 0;
        const moduleLower = module.toLowerCase();
        
        // 1. Admin (role_level >= 90): Full access to everything
        if (roleLevel >= 90) return true;

        // 2. Supervisor (role_level >= 65): Access to academic & operational modules
        const supervisorModules = ['attendance', 'exams', 'marks', 'result', 'exam_fees', 'academics', 'classes', 'sections', 'dashboard'];
        const isModuleAllowed = supervisorModules.some(m => 
            moduleLower === m || moduleLower.startsWith(m + '.')
        );
        
        if (roleLevel >= 65 && isModuleAllowed) {
            // Supervisors can read and write (not delete)
            if (action === 'delete') return false;
            return true;
        }

        const perms = user.permissions || [];

        // 3. Try exact match (e.g., 'students.admission')
        const exact = perms.find(p => p.module_name.toLowerCase() === moduleLower);
        if (exact) {
            if (action === 'read') return exact.can_read;
            if (action === 'write') return exact.can_write;
            if (action === 'delete') return exact.can_delete;
        }

        // 4. Fallback to parent module (e.g., 'students' for 'students.admission')
        const parentModule = module.includes('.') ? module.split('.')[0] : null;
        if (parentModule) {
            const parent = perms.find(p => p.module_name.toLowerCase() === parentModule.toLowerCase());
            if (parent) {
                if (action === 'read') return parent.can_read;
                if (action === 'write') return parent.can_write;
                if (action === 'delete') return parent.can_delete;
            }
        }

        // 5. Module-level check: if called with a bare module key (e.g. 'students') and no
        //    module-level row exists, check if ANY page-level row in that module grants access.
        //    This allows sidebar nav & layout guards to work when only page-level keys are stored.
        if (!module.includes('.')) {
            const prefix = moduleLower + '.';
            const anyPageAccess = perms.some(p => {
                if (!p.module_name.toLowerCase().startsWith(prefix)) return false;
                if (action === 'read') return p.can_read;
                if (action === 'write') return p.can_write;
                if (action === 'delete') return p.can_delete;
                return false;
            });
            if (anyPageAccess) return true;
        }

        return false;
    }, [user]);

    const ctxValue = useMemo(
        () => ({ user, isLoggedIn: !!user, isLoading, login, logout, hasPermission }),
        [user, isLoading, login, logout, hasPermission]
    );

    return (
        <AuthContext.Provider value={ctxValue}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextType {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
    return ctx;
}
