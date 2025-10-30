/**
 * GitHub service for repository creation and export
 */

import { Octokit } from '@octokit/rest';
import { createLogger } from '../../logger';
import {
    GitHubRepository,
    CreateRepositoryOptions,
    CreateRepositoryResult,
    GitHubServiceError,
} from './types';
import { GitHubPushResponse, TemplateDetails } from '../sandbox/sandboxTypes';
import { GitCloneService } from '../../agents/git/git-clone-service';
import git from '@ashishkumar472/cf-git';
import { prepareCloudflareButton } from '../../utils/deployToCf';
import type { MemFS } from '../../agents/git/memfs';


export class GitHubService {
    private static readonly logger = createLogger('GitHubService');

    static createOctokit(token: string): Octokit {
        if (!token?.trim()) {
            throw new GitHubServiceError('No GitHub token provided', 'NO_TOKEN');
        }
        return new Octokit({ auth: token });
    }
    
    /**
     * Create a new GitHub repository
     */
    static async createUserRepository(
        options: CreateRepositoryOptions
    ): Promise<CreateRepositoryResult> {
        const autoInit = options.auto_init ?? true;
        
        GitHubService.logger.info('Creating GitHub repository', {
            name: options.name,
            private: options.private,
            auto_init: autoInit,
            description: options.description ? 'provided' : 'none'
        });
        
        try {
            const octokit = GitHubService.createOctokit(options.token);
            
            const { data: repository } = await octokit.repos.createForAuthenticatedUser({
                name: options.name,
                description: options.description,
                private: options.private,
                auto_init: autoInit,
            });

            GitHubService.logger.info('Successfully created repository', {
                html_url: repository.html_url
            });

            return {
                success: true,
                repository: repository as GitHubRepository
            };
        } catch (error: unknown) {
            const octokitError = error as { status?: number; message?: string; response?: { data?: { errors?: Array<{ field?: string; message?: string }> } } };
            
            GitHubService.logger.error('Repository creation failed', {
                status: octokitError?.status,
                message: octokitError?.message,
                name: options.name
            });
            
            if (octokitError?.status === 403) {
                return {
                    success: false,
                    error: 'GitHub App lacks required permissions. Please ensure the app has Contents: Write and Metadata: Read permissions, then re-install it.'
                };
            }
            
            // Check if repository already exists (422 Unprocessable Entity)
            if (octokitError?.status === 422) {
                const hasNameExistsError = octokitError?.response?.data?.errors?.some((e) => 
                    e.field === 'name' && e.message?.includes('already exists')
                );
                
                if (hasNameExistsError) {
                    return {
                        success: false,
                        error: `Repository '${options.name}' already exists on this account`,
                        alreadyExists: true,
                        repositoryName: options.name
                    };
                }
            }
            
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create repository'
            };
        }
    }


    /**
     * Get repository information from GitHub
     */
    static async getRepository(options: {
        owner: string;
        repo: string;
        token: string;
    }): Promise<{ success: boolean; repository?: GitHubRepository; error?: string }> {
        try {
            const octokit = GitHubService.createOctokit(options.token);
            
            const { data: repository } = await octokit.repos.get({
                owner: options.owner,
                repo: options.repo
            });

            GitHubService.logger.info('Successfully fetched repository', {
                html_url: repository.html_url
            });
            
            return { 
                success: true, 
                repository: repository as GitHubRepository 
            };
        } catch (error: unknown) {
            const octokitError = error as { status?: number; message?: string };
            
            GitHubService.logger.error('Failed to fetch repository', {
                owner: options.owner,
                repo: options.repo,
                status: octokitError?.status,
                message: octokitError?.message
            });
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Failed to fetch repository' 
            };
        }
    }

    /**
     * Parse owner and repo name from GitHub URL
     */
    static extractRepoInfo(url: string): { owner: string; repo: string } | null {
        try {
            // Convert SSH URLs to HTTPS
            let cleanUrl = url;
            
            if (url.startsWith('git@github.com:')) {
                cleanUrl = url.replace('git@github.com:', 'https://github.com/');
            }
            
            const urlObj = new URL(cleanUrl);
            const pathParts = urlObj.pathname.split('/').filter(part => part);
            
            if (pathParts.length >= 2) {
                const owner = pathParts[0];
                const repo = pathParts[1].replace('.git', '');
                return { owner, repo };
            }
            
            return null;
        } catch (error) {
            GitHubService.logger.error('Failed to parse repository URL', { url, error });
            return null;
        }
    }

    /**
     * Export git repository to GitHub
     */
    static async exportToGitHub(options: {
        gitObjects: Array<{ path: string; data: Uint8Array }>;
        templateDetails: TemplateDetails | null;
        appQuery: string;
        appCreatedAt?: Date;
        token: string;
        repositoryUrl: string;
        username: string;
        email: string;
    }): Promise<GitHubPushResponse> {
        try {
            GitHubService.logger.info('Starting GitHub export from DO git', {
                gitObjectCount: options.gitObjects.length,
                repositoryUrl: options.repositoryUrl
            });

            // Build in-memory repo from DO git objects
            const fs = await GitCloneService.buildRepository({
                gitObjects: options.gitObjects,
                templateDetails: options.templateDetails,
                appQuery: options.appQuery,
                appCreatedAt: options.appCreatedAt
            });

            // Modify README to add GitHub deploy button
            await GitHubService.modifyReadmeForGitHub(fs, options.repositoryUrl);

            // Get all commits from built repo
            const commits = await git.log({ fs, dir: '/', depth: 1000 });

            GitHubService.logger.info('Repository built', {
                commitCount: commits.length
            });

            // Push to GitHub with proper per-commit trees
            const result = await GitHubService.forcePushToGitHub(
                fs,
                options.token,
                options.repositoryUrl,
                commits,
                { name: options.username, email: options.email }
            );

            return result;
        } catch (error) {
            GitHubService.logger.error('GitHub export failed', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: `GitHub export failed: ${errorMessage}`
            };
        }
    }

    /**
     * Replace [cloudflarebutton] placeholder with deploy button
     */
    private static async modifyReadmeForGitHub(fs: MemFS, githubRepoUrl: string): Promise<void> {
        try {
            // Check if README exists
            try {
                await fs.stat('/README.md');
            } catch {
                GitHubService.logger.info('No README.md found, skipping modification');
                return;
            }

            const contentRaw = await fs.readFile('/README.md', { encoding: 'utf8' });
            const content = typeof contentRaw === 'string' ? contentRaw : new TextDecoder().decode(contentRaw);
            
            if (!content.includes('[cloudflarebutton]')) {
                GitHubService.logger.info('README.md has no [cloudflarebutton] placeholder');
                return;
            }

            const modified = content.replaceAll(
                '[cloudflarebutton]',
                prepareCloudflareButton(githubRepoUrl, 'markdown')
            );

            await fs.writeFile('/README.md', modified);
            await git.add({ fs, dir: '/', filepath: 'README.md' });
            await git.commit({
                fs,
                dir: '/',
                message: 'docs: Add Cloudflare deploy button to README',
                author: { 
                    name: 'vibesdk-bot', 
                    email: 'bot@vibesdk.com',
                    timestamp: Math.floor(Date.now() / 1000)
                }
            });

            GitHubService.logger.info('README.md modified and committed');
        } catch (error) {
            GitHubService.logger.warn('Failed to modify README, continuing without', error);
        }
    }

    /**
     * Walk a git tree and extract all files
     */
    private static async walkGitTree(
        fs: MemFS,
        treeOid: string,
        basePath: string = ''
    ): Promise<Array<{ path: string; oid: string; content: string }>> {
        const files: Array<{ path: string; oid: string; content: string }> = [];
        
        const { tree } = await git.readTree({ fs, dir: '/', oid: treeOid });
        
        for (const entry of tree) {
            const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path;
            
            if (entry.type === 'blob') {
                const { blob } = await git.readBlob({ fs, dir: '/', oid: entry.oid });
                const content = new TextDecoder().decode(blob);
                files.push({ path: fullPath, oid: entry.oid, content });
            } else if (entry.type === 'tree') {
                const subFiles = await GitHubService.walkGitTree(fs, entry.oid, fullPath);
                files.push(...subFiles);
            }
        }
        
        return files;
    }

    /**
     * Create a SHA-256 hash of content for blob deduplication
     */
    private static async hashContent(content: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Force push to GitHub while preserving commit history
     * Creates proper trees for each commit to preserve diffs
     */
    private static async forcePushToGitHub(
        fs: MemFS,
        token: string,
        repoUrl: string,
        commits: Awaited<ReturnType<typeof git.log>>,
        author: { name: string; email: string }
    ): Promise<GitHubPushResponse> {
        try {
            const repoInfo = GitHubService.extractRepoInfo(repoUrl);
            if (!repoInfo) {
                throw new GitHubServiceError('Invalid repository URL format', 'INVALID_REPO_URL');
            }

            const { owner, repo } = repoInfo;
            const octokit = GitHubService.createOctokit(token);

            // Get repository and default branch
            const { data: repository } = await octokit.rest.repos.get({ owner, repo });
            const branch = repository.default_branch || 'main';

            GitHubService.logger.info('Pushing to GitHub with per-commit trees', {
                owner,
                repo,
                branch,
                commitCount: commits.length
            });

            // Blob cache: content hash -> GitHub blob SHA
            const blobCache = new Map<string, string>();
            let totalBlobsCreated = 0;
            let totalBlobsReused = 0;

            // Process commits from oldest to newest
            let parentSha: string | undefined;
            const reversedCommits = [...commits].reverse();
            
            for (let i = 0; i < reversedCommits.length; i++) {
                const commit = reversedCommits[i];
                
                GitHubService.logger.info(`Processing commit ${i + 1}/${reversedCommits.length}`, {
                    message: commit.commit.message.split('\n')[0],
                    oid: commit.oid
                });
                
                // Walk this commit's tree to get its files
                const files = await GitHubService.walkGitTree(fs, commit.commit.tree);
                
                if (files.length === 0) {
                    GitHubService.logger.info('Skipping commit with no files', { oid: commit.oid });
                    continue;
                }
                
                // Create blobs for new/changed files (parallel, with deduplication)
                const blobCreationPromises: Promise<void>[] = [];
                const fileToGitHubBlob = new Map<string, string>();
                
                for (const file of files) {
                    const contentHash = await GitHubService.hashContent(file.content);
                    
                    if (blobCache.has(contentHash)) {
                        // Reuse existing blob
                        fileToGitHubBlob.set(file.path, blobCache.get(contentHash)!);
                        totalBlobsReused++;
                    } else {
                        // Create new blob (add to parallel batch)
                        blobCreationPromises.push(
                            (async () => {
                                const { data: blob } = await octokit.git.createBlob({
                                    owner,
                                    repo,
                                    content: Buffer.from(file.content, 'utf8').toString('base64'),
                                    encoding: 'base64'
                                });
                                blobCache.set(contentHash, blob.sha);
                                fileToGitHubBlob.set(file.path, blob.sha);
                                totalBlobsCreated++;
                            })()
                        );
                    }
                }
                
                // Wait for all blobs in this batch
                await Promise.all(blobCreationPromises);
                
                // Create tree for this commit
                const { data: tree } = await octokit.git.createTree({
                    owner,
                    repo,
                    tree: files.map(file => ({
                        path: file.path,
                        mode: '100644' as '100644',
                        type: 'blob' as 'blob',
                        sha: fileToGitHubBlob.get(file.path)!
                    }))
                });
                
                // Create GitHub commit with this tree
                const { data: newCommit } = await octokit.git.createCommit({
                    owner,
                    repo,
                    message: commit.commit.message,
                    tree: tree.sha,
                    parents: parentSha ? [parentSha] : [],
                    author: {
                        name: commit.commit.author.name,
                        email: commit.commit.author.email,
                        date: new Date(commit.commit.author.timestamp * 1000).toISOString()
                    },
                    committer: {
                        name: commit.commit.committer?.name || author.name,
                        email: commit.commit.committer?.email || author.email,
                        date: new Date((commit.commit.committer?.timestamp || commit.commit.author.timestamp) * 1000).toISOString()
                    }
                });
                
                parentSha = newCommit.sha;
            }

            if (!parentSha) {
                throw new Error('No commits were created');
            }

            GitHubService.logger.info('Blob statistics', {
                totalCreated: totalBlobsCreated,
                totalReused: totalBlobsReused,
                cacheSize: blobCache.size
            });

            // Update branch
            await octokit.git.updateRef({
                owner,
                repo,
                ref: `heads/${branch}`,
                sha: parentSha,
                force: true
            });

            GitHubService.logger.info('Force push completed', {
                finalCommitSha: parentSha,
                branch
            });

            return {
                success: true,
                commitSha: parentSha
            };
        } catch (error) {
            GitHubService.logger.error('Force push failed', error);
            throw error;
        }
    }

    /**
     * Check remote repository status vs local commits
     * Builds local repo with template to match export structure
     */
    static async checkRemoteStatus(options: {
        gitObjects: Array<{ path: string; data: Uint8Array }>;
        templateDetails: TemplateDetails | null;
        appQuery: string;
        appCreatedAt?: Date;
        repositoryUrl: string;
        token: string;
    }): Promise<{
        compatible: boolean;
        behindBy: number;
        aheadBy: number;
        divergedCommits: Array<{
            sha: string;
            message: string;
            author: string;
            date: string;
        }>;
    }> {
        try {
            const repoInfo = GitHubService.extractRepoInfo(options.repositoryUrl);
            if (!repoInfo) {
                throw new GitHubServiceError('Invalid repository URL', 'INVALID_REPO_URL');
            }

            const { owner, repo } = repoInfo;
            const octokit = GitHubService.createOctokit(options.token);

            // Get remote commits
            const { data: remoteCommits } = await octokit.repos.listCommits({
                owner,
                repo,
                per_page: 100
            });

            // Build local repo with same template as export
            const fs = await GitCloneService.buildRepository({
                gitObjects: options.gitObjects,
                templateDetails: options.templateDetails,
                appQuery: options.appQuery,
                appCreatedAt: options.appCreatedAt
            });

            const localCommits = await git.log({ fs, dir: '/', depth: 100 });

            // Find divergence
            // Normalize commit messages by trimming whitespace (git.log adds trailing \n, GitHub API doesn't)
            const normalizeMessage = (msg: string) => msg.trim();
            
            // Ignore system-generated commits that we add to GitHub but don't track locally
            const isSystemGeneratedCommit = (message: string) => {
                return normalizeMessage(message).startsWith('docs: Add Cloudflare deploy button');
            };
            
            const localMessages = new Set(localCommits.map(c => normalizeMessage(c.commit.message)));
            const remoteMessages = new Set(remoteCommits.map(c => normalizeMessage(c.commit.message)));

            const hasCommonCommit = localCommits.some(local =>
                remoteCommits.some(remote => 
                    normalizeMessage(remote.commit.message) === normalizeMessage(local.commit.message)
                )
            );

            const localOnly = localCommits.filter(c => !remoteMessages.has(normalizeMessage(c.commit.message)));
            const remoteOnly = remoteCommits.filter(c => 
                !localMessages.has(normalizeMessage(c.commit.message)) && !isSystemGeneratedCommit(c.commit.message)
            );

            return {
                compatible: hasCommonCommit || remoteCommits.length === 0,
                behindBy: localOnly.length,
                aheadBy: remoteOnly.length,
                divergedCommits: remoteOnly.map(c => ({
                    sha: c.sha,
                    message: c.commit.message,
                    author: c.commit.author?.name || 'Unknown',
                    date: c.commit.author?.date || new Date().toISOString()
                }))
            };
        } catch (error) {
            GitHubService.logger.error('Failed to check remote status', error);
            throw error;
        }
    }

}