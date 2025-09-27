import { ConfigurableSecuritySettings, getConfigurableSecurityDefaults } from "./security";
import { createLogger } from "../logger";

const logger = createLogger('GlobalConfigurableSettings');

let cachedConfig: GlobalConfigurableSettings | null = null;
const invocationUserCache = new Map<string, GlobalConfigurableSettings>();

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;
type MergeableValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.prototype.toString.call(value) === '[object Object]'
    );
}

function deepMerge<T>(
    target: T,
    source: DeepPartial<T>
): T {
    if (source === null || source === undefined) {
        return target;
    }
    
    if (!isPlainObject(target) || !isPlainObject(source)) {
        return (source !== undefined ? source : target) as T;
    }
    
    const targetObj = target as Record<string, MergeableValue>;
    const sourceObj = source as Record<string, unknown>;
    const result = { ...targetObj } as Record<string, MergeableValue>;
    
    Object.entries(sourceObj).forEach(([key, sourceValue]) => {
        if (sourceValue === undefined) {
            return;
        }
        
        const targetValue = targetObj[key];
        
        if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
            result[key] = deepMerge(targetValue, sourceValue);
        } else {
            result[key] = sourceValue as MergeableValue;
        }
    });
    
    return result as T;
}
export interface GlobalConfigurableSettings {
    security: ConfigurableSecuritySettings;
}

type StoredConfig = DeepPartial<GlobalConfigurableSettings>;

export async function getGlobalConfigurableSettings(): Promise<GlobalConfigurableSettings> {
    if (cachedConfig) {
        return cachedConfig;
    }

    const defaultConfig: GlobalConfigurableSettings = {
        security: getConfigurableSecurityDefaults()
    };
    
    logger.info('Using default global configuration as KV store is removed.');
    cachedConfig = defaultConfig;
    return defaultConfig;
}

export async function getUserConfigurableSettings(userId: string, globalConfig: GlobalConfigurableSettings): Promise<GlobalConfigurableSettings> {
    if (!userId) {
        return globalConfig;
    }

    if (invocationUserCache.has(userId)) {
        return invocationUserCache.get(userId)!;
    }
    
    logger.info(`User-specific settings from KV are not available. Using global config for user ${userId}.`);

    invocationUserCache.set(userId, globalConfig);
    return globalConfig;
}