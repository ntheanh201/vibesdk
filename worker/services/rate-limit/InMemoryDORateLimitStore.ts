import { createObjectLogger } from '../../logger';
import { DORateLimitConfig } from './config';

export interface RateLimitBucket {
    count: number;
    timestamp: number;
}

export interface RateLimitState {
    buckets: Map<string, RateLimitBucket>;
    lastCleanup: number;
}

export interface RateLimitResult {
    success: boolean;
    remainingLimit?: number;
}

export class InMemoryDORateLimitStore {
    private static stores = new Map<string, RateLimitState>();
    private static logger = createObjectLogger(this, 'InMemoryDORateLimitStore');

    private static getState(key: string): RateLimitState {
        if (!this.stores.has(key)) {
            this.stores.set(key, {
                buckets: new Map(),
                lastCleanup: Date.now()
            });
        }
        return this.stores.get(key)!;
    }

    private static cleanup(state: RateLimitState, now: number, maxWindow: number): void {
        const cutoff = now - maxWindow;
        for (const [bucketKey, bucket] of state.buckets) {
            if (bucket.timestamp < cutoff) {
                state.buckets.delete(bucketKey);
            }
        }
        state.lastCleanup = now;
    }

    static async increment(key: string, config: DORateLimitConfig): Promise<RateLimitResult> {
        const state = this.getState(key);

        const now = Date.now();
        const bucketSize = (config.bucketSize || 10) * 1000;
        const burstWindow = (config.burstWindow || 60) * 1000;
        const mainWindow = config.period * 1000;

        const currentBucketTimestamp = Math.floor(now / bucketSize) * bucketSize;
        const bucketKey = `${key}:${currentBucketTimestamp}`;

        if (now - state.lastCleanup > 5 * 60 * 1000) {
            this.cleanup(state, now, Math.max(mainWindow, burstWindow));
        }

        const mainBuckets = this.getBucketsInWindow(state, key, now, mainWindow, bucketSize);
        const burstBuckets = config.burst ? this.getBucketsInWindow(state, key, now, burstWindow, bucketSize) : [];

        const mainCount = mainBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
        const burstCount = burstBuckets.reduce((sum, bucket) => sum + bucket.count, 0);

        if (mainCount >= config.limit) {
            return { success: false, remainingLimit: 0 };
        }

        if (config.burst && burstCount >= config.burst) {
            return { success: false, remainingLimit: 0 };
        }

        const existing = state.buckets.get(bucketKey);
        const newCount = (existing?.count || 0) + 1;

        state.buckets.set(bucketKey, {
            count: newCount,
            timestamp: now
        });

        return {
            success: true,
            remainingLimit: config.limit - mainCount - 1
        };
    }

    private static getBucketsInWindow(state: RateLimitState, key: string, now: number, windowMs: number, bucketSizeMs: number): RateLimitBucket[] {
        const buckets: RateLimitBucket[] = [];
        const windowStart = now - windowMs;

        for (let time = Math.floor(windowStart / bucketSizeMs) * bucketSizeMs; time <= now; time += bucketSizeMs) {
            const bucketKey = `${key}:${time}`;
            const bucket = state.buckets.get(bucketKey);
            if (bucket) {
                buckets.push(bucket);
            }
        }

        return buckets;
    }
}