import { createObjectLogger } from '../../logger';
import { KVRateLimitConfig } from './config';
import type { RateLimitResult } from './DORateLimitStore';

interface Bucket {
    count: number;
    expiresAt: number;
}

export class InMemoryRateLimitStore {
    private static store = new Map<string, Bucket>();
    static logger = createObjectLogger(this, 'InMemoryRateLimitStore');

    private static cleanup() {
        const now = Date.now();
        for (const [key, bucket] of this.store.entries()) {
            if (bucket.expiresAt < now) {
                this.store.delete(key);
            }
        }
    }

    static async increment(
        key: string,
        config: KVRateLimitConfig
    ): Promise<RateLimitResult> {
        if (Math.random() < 0.1) {
            this.cleanup();
        }

        const now = Date.now();
        const bucketSize = (config.bucketSize ?? 10) * 1000;
        const burstWindow = (config.burstWindow ?? 60) * 1000;
        const mainWindow = config.period * 1000;
        const currentBucketTimestamp = Math.floor(now / bucketSize) * bucketSize;

        try {
            const mainBuckets = this.generateBucketKeys(key, now, mainWindow, bucketSize);
            const burstBuckets = config.burst ? this.generateBucketKeys(key, now, burstWindow, bucketSize) : [];

            const mainCount = mainBuckets.reduce((sum, bucketKey) => {
                const bucket = this.store.get(bucketKey);
                return sum + (bucket && bucket.expiresAt > now ? bucket.count : 0);
            }, 0);

            const burstCount = burstBuckets.reduce((sum, bucketKey) => {
                const bucket = this.store.get(bucketKey);
                return sum + (bucket && bucket.expiresAt > now ? bucket.count : 0);
            }, 0);

            if (mainCount >= config.limit) {
                return { success: false, remainingLimit: 0 };
            }

            if (config.burst && burstCount >= config.burst) {
                return { success: false, remainingLimit: 0 };
            }

            const currentBucketKey = `ratelimit:${key}:${currentBucketTimestamp}`;
            const maxTtlSeconds = Math.max(config.period, config.burstWindow ?? 60) + (config.bucketSize ?? 10);
            const expiresAt = now + maxTtlSeconds * 1000;

            const currentBucket = this.store.get(currentBucketKey);
            if (currentBucket && currentBucket.expiresAt > now) {
                currentBucket.count++;
                currentBucket.expiresAt = expiresAt;
            } else {
                this.store.set(currentBucketKey, { count: 1, expiresAt });
            }

            return { success: true, remainingLimit: Math.max(0, config.limit - mainCount - 1) };
        } catch (error) {
            this.logger.error('Failed to enforce in-memory rate limit', {
                key,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            return { success: true };
        }
    }

    static async getRemainingLimit(
        key: string,
        config: KVRateLimitConfig
    ): Promise<number> {
        const now = Date.now();
        const bucketSize = (config.bucketSize ?? 10) * 1000;
        const mainWindow = config.period * 1000;

        const mainBuckets = this.generateBucketKeys(key, now, mainWindow, bucketSize);

        const mainCount = mainBuckets.reduce((sum, bucketKey) => {
            const bucket = this.store.get(bucketKey);
            return sum + (bucket && bucket.expiresAt > now ? bucket.count : 0);
        }, 0);

        return Math.max(0, config.limit - mainCount);
    }

    private static generateBucketKeys(key: string, now: number, windowMs: number, bucketSizeMs: number): string[] {
        const buckets: string[] = [];
        const windowStart = now - windowMs;

        for (let time = Math.floor(windowStart / bucketSizeMs) * bucketSizeMs; time <= now; time += bucketSizeMs) {
            buckets.push(`ratelimit:${key}:${time}`);
        }

        return buckets;
    }
}