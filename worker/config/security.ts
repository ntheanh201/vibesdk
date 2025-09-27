import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitSettings } from "../services/rate-limit/config";
import { Context } from "hono";

// Type definitions for security configurations
export interface CORSConfig {
    origin: string | string[] | ((origin: string, c: Context) => string | undefined | null);
    allowMethods?: string[];
    allowHeaders?: string[];
    maxAge?: number;
    credentials?: boolean;
    exposeHeaders?: string[];
}

export interface CSRFConfig {
    origin: string | string[] | ((origin: string, c: Context) => boolean);
    tokenTTL: number; // Token Time-To-Live in milliseconds
    rotateOnAuth: boolean; // Rotate token on authentication state changes
    cookieName: string;
    headerName: string;
}

// These settings can be altered dynamically via e.g, admin panel
export interface ConfigurableSecuritySettings {
    rateLimit: RateLimitSettings;
}

export function getConfigurableSecurityDefaults(): ConfigurableSecuritySettings {
    
    return {
        rateLimit: DEFAULT_RATE_LIMIT_SETTINGS,
    };
}

/**
 * Get allowed origins based on environment
 */
function getAllowedOrigins(): string[] {
    const origins: string[] = [];
    
    if (process.env.CUSTOM_DOMAIN) {
        origins.push(`https://${process.env.CUSTOM_DOMAIN}`);
    }
    
    if (process.env.NODE_ENV === 'development') {
        origins.push('http://localhost:3000');
        origins.push('http://localhost:5173');
        origins.push('http://127.0.0.1:3000');
        origins.push('http://127.0.0.1:5173');
    }
    
    return origins;
}

/**
 * CORS Configuration
 * Strict origin validation with environment-aware settings
 */
export function getCORSConfig(): CORSConfig {
    return {
        origin: getAllowedOrigins(),
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowHeaders: [
            'Content-Type',
            'Authorization',
            'X-Request-ID',
            'X-Session-Token',
            'X-CSRF-Token'
        ],
        exposeHeaders: [
            'X-Request-ID',
            'X-RateLimit-Limit',
            'X-RateLimit-Remaining',
            'X-RateLimit-Reset'
        ],
        maxAge: 86400, // 24 hours
        credentials: true
    };
}

/**
 * CSRF Protection Configuration
 * Double-submit cookie pattern with origin validation
 */
export function getCSRFConfig(): CSRFConfig {
    const allowedOrigins = getAllowedOrigins();
    
    return {
        origin: (origin: string) => {
            if (!origin) return false;
            return allowedOrigins.includes(origin);
        },
        tokenTTL: 2 * 60 * 60 * 1000, // 2 hours
        rotateOnAuth: true,
        cookieName: 'csrf-token',
        headerName: 'X-CSRF-Token'
    };
}

// Type for CSP directives
interface ContentSecurityPolicyConfig {
    defaultSrc?: string[];
    scriptSrc?: string[];
    styleSrc?: string[];
    fontSrc?: string[];
    imgSrc?: string[];
    connectSrc?: string[];
    frameSrc?: string[];
    objectSrc?: string[];
    mediaSrc?: string[];
    workerSrc?: string[];
    formAction?: string[];
    frameAncestors?: string[];
    baseUri?: string[];
    manifestSrc?: string[];
    upgradeInsecureRequests?: string[];
}

// Type for secure headers configuration
interface SecureHeadersConfig {
    contentSecurityPolicy?: ContentSecurityPolicyConfig;
    strictTransportSecurity?: string;
    xFrameOptions?: string | false;
    xContentTypeOptions?: string;
    xXssProtection?: string | false;
    referrerPolicy?: string;
    crossOriginEmbedderPolicy?: string | false;
    crossOriginResourcePolicy?: string | false;
    crossOriginOpenerPolicy?: string | false;
    originAgentCluster?: string;
    xDnsPrefetchControl?: string;
    xDownloadOptions?: string;
    xPermittedCrossDomainPolicies?: string;
    permissionsPolicy?: Record<string, string[]>;
}

/**
 * Secure Headers Configuration
 * Comprehensive security headers with CSP
 */
export function getSecureHeadersConfig(): SecureHeadersConfig {
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    return {
        contentSecurityPolicy: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'strict-dynamic'",
                ...(isDevelopment ? ["'unsafe-eval'"] : [])
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com"
            ],
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com",
                "data:"
            ],
            imgSrc: [
                "'self'",
                "data:",
                "blob:",
                "https://avatars.githubusercontent.com",
                "https://lh3.googleusercontent.com",
                "https://*.cloudflare.com"
            ],
            connectSrc: [
                "'self'",
                "ws://localhost:*",
                "wss://localhost:*",
                `wss://${process.env.CUSTOM_DOMAIN || '*'}`,
                "https://api.github.com",
                "https://api.cloudflare.com"
            ],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            workerSrc: ["'self'", "blob:"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            manifestSrc: ["'self'"],
            upgradeInsecureRequests: !isDevelopment ? [] : undefined
        },
        
        strictTransportSecurity: isDevelopment 
            ? undefined
            : 'max-age=31536000; includeSubDomains; preload',
        
        xFrameOptions: 'DENY',
        xContentTypeOptions: 'nosniff',
        xXssProtection: '1; mode=block',
        referrerPolicy: 'strict-origin-when-cross-origin',
        crossOriginEmbedderPolicy: 'require-corp',
        crossOriginResourcePolicy: 'same-origin',
        crossOriginOpenerPolicy: 'same-origin',
        originAgentCluster: '?1',
        xDnsPrefetchControl: 'off',
        xDownloadOptions: 'noopen',
        xPermittedCrossDomainPolicies: 'none',
        permissionsPolicy: {
            camera: [],
            microphone: [],
            geolocation: [],
            usb: [],
            payment: [],
            magnetometer: [],
            gyroscope: [],
            accelerometer: [],
            autoplay: ['self'],
            fullscreen: ['self'],
            clipboard: ['self']
        }
    };
}