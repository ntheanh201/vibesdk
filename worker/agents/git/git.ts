/**
 * Git version control for Durable Objects using isomorphic-git
 */

import git from '@ashishkumar472/cf-git';
import { SqliteFS, type SqlExecutor } from './fs-adapter';
import { FileOutputType } from '../schemas';

export interface CommitInfo {
    oid: string;
    message: string;
    author: string;
    timestamp: number;
}

type FileSnapshot = Omit<FileOutputType, 'filePurpose'>;

export class GitVersionControl {
    private onFilesChangedCallback?: () => void;
    public fs: SqliteFS;
    private author: { name: string; email: string };

    constructor(sql: SqlExecutor, author?: { name: string; email: string }) {
        this.fs = new SqliteFS(sql);
        this.author = author || { name: 'Vibesdk', email: 'vibesdk-bot@cloudflare.com' };
        
        // Initialize SQLite table synchronously
        this.fs.init();
    }

    setOnFilesChangedCallback(callback: () => void): void {
        this.onFilesChangedCallback = callback;
    }

    async getAllFilesFromHead(): Promise<Array<{ filePath: string; fileContents: string }>> {
        try {
            const oid = await git.resolveRef({ fs: this.fs, dir: '/', ref: 'HEAD' });
            const files = await this.readFilesFromCommit(oid);
            return files;
        } catch (error) {
            return [];
        }
    }

    async init(): Promise<void> {
        // Initialize git repository (isomorphic-git init is idempotent - safe to call multiple times)
        try {
            const startTime = Date.now();
            console.log('[Git] Initializing repository...');
            await git.init({ fs: this.fs, dir: '/', defaultBranch: 'main' });
            const duration = Date.now() - startTime;
            console.log(`[Git] Repository initialized in ${duration}ms`);
        } catch (error) {
            // Init might fail if already initialized, which is fine
            console.log('[Git] Repository already initialized or init skipped:', error);
        }
    }

    /**
     * Stage files without committing them
     * Useful for batching multiple operations before a single commit
     */
    async stage(files: FileSnapshot[]): Promise<void> {
        if (!files.length) {
            console.log('[Git] No files to stage');
            return;
        }

        console.log(`[Git] Staging ${files.length} files`);

        // Normalize paths (remove leading slashes for git)
        const normalizedFiles = files.map(f => ({
            path: f.filePath.startsWith('/') ? f.filePath.slice(1) : f.filePath,
            content: f.fileContents
        }));

        // Write and stage files
        for (let i = 0; i < normalizedFiles.length; i++) {
            const file = normalizedFiles[i];
            try {
                console.log(`[Git] Staging file ${i + 1}/${normalizedFiles.length}: ${file.path}`);
                
                // Write file to filesystem
                await this.fs.writeFile(file.path, file.content);
                
                // Stage file using git.add
                await git.add({ 
                    fs: this.fs, 
                    dir: '/', 
                    filepath: file.path,
                    cache: {}
                });
                
                console.log(`[Git] Staged ${i + 1}/${normalizedFiles.length}: ${file.path}`);
            } catch (error) {
                console.error(`[Git] Failed to stage file ${file.path}:`, error);
                throw new Error(`Failed to stage file ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        console.log(`[Git] Successfully staged ${files.length} files`);
    }

    async commit(files: FileSnapshot[], message?: string): Promise<string | null> {
        console.log(`[Git] Starting commit with ${files.length} files`);
        if (files.length) {
            // Stage all files first
            await this.stage(files);
        }

        console.log('[Git] All files written and staged, checking for changes...');

        // Check if there are actual changes (compare staged vs HEAD)
        let hasChanges = false;
        try {
            const status = await git.statusMatrix({ fs: this.fs, dir: '/' });
            // row[1] = HEAD index, row[2] = STAGE index
            // If they differ, we have changes to commit
            hasChanges = status.some(row => row[1] !== row[2]);
            console.log(`[Git] Status check: ${hasChanges ? 'has changes' : 'no changes'}`);
        } catch (e) {
            // First commit or error, assume changes
            console.log('[Git] Status check failed (likely first commit), assuming changes');
            hasChanges = true;
        }

        if (!hasChanges) {
            console.log('[Git] No actual changes to commit');
            return null; // No actual changes to commit
        }

        console.log('[Git] Creating commit...');
        const oid = await git.commit({
            fs: this.fs,
            dir: '/',
            message: message || `Auto-checkpoint (${new Date().toISOString()})`,
            author: {
                name: this.author.name,
                email: this.author.email,
                timestamp: Math.floor(Date.now() / 1000)
            }
        });
        console.log(`[Git] Commit created: ${oid}`);
        return oid;
    }

    async log(limit = 50): Promise<CommitInfo[]> {
        try {
            const commits = await git.log({ fs: this.fs, dir: '/', depth: limit, ref: 'main' });
            return commits.map(c => ({
                oid: c.oid,
                message: c.commit.message,
                author: `${c.commit.author.name} <${c.commit.author.email}>`,
                timestamp: c.commit.author.timestamp * 1000
            }));
        } catch {
            return [];
        }
    }

    private async readFilesFromCommit(oid: string): Promise<FileSnapshot[]> {
        const { commit } = await git.readCommit({ fs: this.fs, dir: '/', oid });
        const files: FileSnapshot[] = [];
        await this.walkTree(commit.tree, '', files);
        return files;
    }

    async show(oid: string): Promise<{ oid: string; message: string; author: string; timestamp: string; files: number; fileList: string[] }> {
        const { commit } = await git.readCommit({ fs: this.fs, dir: '/', oid });
        const files = await git.listFiles({ fs: this.fs, dir: '/', ref: oid });
        
        return {
            oid,
            message: commit.message,
            author: `${commit.author.name} <${commit.author.email}>`,
            timestamp: new Date(commit.author.timestamp * 1000).toISOString(),
            files: files.length,
            fileList: files
        };
    }

    async reset(ref: string, options?: { hard?: boolean }): Promise<{ ref: string; filesReset: number }> {
        // Update HEAD to point to the specified ref
        const oid = await git.resolveRef({ fs: this.fs, dir: '/', ref });
        await git.writeRef({ fs: this.fs, dir: '/', ref: 'HEAD', value: oid, force: true });
        
        // If hard reset, also update working directory
        if (options?.hard !== false) {
            await git.checkout({ fs: this.fs, dir: '/', ref, force: true });
        }
        
        const files = await git.listFiles({ fs: this.fs, dir: '/', ref });
        
        this.onFilesChangedCallback?.();
        
        return { ref, filesReset: files.length };
    }

    private async walkTree(treeOid: string, prefix: string, files: FileSnapshot[]): Promise<void> {
        const { tree } = await git.readTree({ fs: this.fs, dir: '/', oid: treeOid });

        for (const entry of tree) {
            const path = prefix ? `${prefix}/${entry.path}` : entry.path;

            if (entry.type === 'blob') {
                const { blob } = await git.readBlob({ fs: this.fs, dir: '/', oid: entry.oid });
                // Git blobs are binary, decode with proper error handling
                try {
                    const content = new TextDecoder('utf-8').decode(blob);
                    // Check if it's valid text by looking for null bytes
                    if (!content.includes('\0')) {
                        files.push({ filePath: path, fileContents: content });
                    }
                    // Skip binary files (checkout is for reverting code files)
                } catch {
                    // Failed to decode, skip binary file
                }
            } else if (entry.type === 'tree') {
                await this.walkTree(entry.oid, path, files);
            }
        }
    }

    async getHead(): Promise<string | null> {
        try {
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error('git.resolveRef timed out after 5 seconds'));
                }, 5000);
            });
            
            const resolvePromise = git.resolveRef({ fs: this.fs, dir: '/', ref: 'HEAD' });
            
            try {
                const result = await Promise.race([resolvePromise, timeoutPromise]);
                return result;
            } finally {
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                }
            }
        } catch {
            return null;
        }
    }

    /**
     * Get storage statistics for monitoring and observability
     */
    getStorageStats(): { totalObjects: number; totalBytes: number; largestObject: { path: string; size: number } | null } {
        return this.fs.getStorageStats();
    }
}