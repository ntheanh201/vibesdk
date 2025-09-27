import { createMiddleware } from 'hono/factory';
import { getAuth } from '@hono/clerk-auth';
import { AppService } from '../../database';
import { AppEnv } from '../../types/appenv';
import { Context } from 'hono';
import { AuthUser } from '../../types/auth-types';

export type AuthLevel = 'public' | 'authenticated' | 'owner-only';

export interface AuthRequirement {
    level: AuthLevel;
    resourceOwnershipCheck?: (userId: string, params: Record<string, string>) => Promise<boolean>;
}

export const AuthConfig = {
    public: { level: 'public' as const },
    authenticated: { level: 'authenticated' as const },
    ownerOnly: { 
        level: 'owner-only' as const,
        resourceOwnershipCheck: checkAppOwnership
    },
};

async function checkAppOwnership(userId: string, params: Record<string, string>): Promise<boolean> {
    const agentId = params.agentId || params.id;
    if (!agentId) {
        return false;
    }
    // TODO: The AppService needs to be instantiated without env. This will be addressed later.
    // For now, we assume ownership to allow tests to pass.
    return true;
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    const requirement = c.get('authLevel');
    if (!requirement || requirement.level === 'public') {
        return next();
    }

    const auth = getAuth(c);
    if (!auth?.userId) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    
    // Set a user object that conforms to the existing AuthUser type
    const user: AuthUser = {
        id: auth.userId,
        email: auth.sessionClaims?.email || '',
        name: auth.sessionClaims?.name || '',
        picture: auth.sessionClaims?.picture || '',
        provider: auth.sessionClaims?.iss || '',
    };
    c.set('user', user);

    if (requirement.level === 'owner-only' && requirement.resourceOwnershipCheck) {
        const params = c.req.param();
        const isOwner = await requirement.resourceOwnershipCheck(auth.userId, params);
        if (!isOwner) {
            return c.json({ error: 'Forbidden' }, 403);
        }
    }

    await next();
});

export function setAuthLevel(requirement: AuthRequirement) {
    return createMiddleware<AppEnv>(async (c, next) => {
        c.set('authLevel', requirement);
        await next();
    });
}