interface CacheEntry<T> {
    value: T;
    expiresAt: number | null;
}

export class InMemoryCache {
    private store = new Map<string, CacheEntry<any>>();

    private generateKey(prefix: string, key: string): string {
        return `cache-${prefix}:${key}`;
    }

    async get<T>(prefix: string, key: string): Promise<T | null> {
        const fullKey = this.generateKey(prefix, key);
        const entry = this.store.get(fullKey);

        if (!entry) {
            return null;
        }

        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.store.delete(fullKey);
            return null;
        }

        return entry.value as T | null;
    }

    async set<T>(prefix: string, key: string, value: T, ttl?: number): Promise<void> {
        const fullKey = this.generateKey(prefix, key);
        const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
        this.store.set(fullKey, { value, expiresAt });
    }

    async delete(prefix: string, key: string): Promise<void> {
        const fullKey = this.generateKey(prefix, key);
        this.store.delete(fullKey);
    }

    async deleteByPrefix(prefix: string): Promise<void> {
        const searchPrefix = `cache-${prefix}:`;
        for (const key of this.store.keys()) {
            if (key.startsWith(searchPrefix)) {
                this.store.delete(key);
            }
        }
    }

    async invalidate(patterns: string[]): Promise<void> {
        await Promise.all(patterns.map(pattern => this.deleteByPrefix(pattern)));
    }
}

export function createInMemoryCache(): InMemoryCache {
    return new InMemoryCache();
}