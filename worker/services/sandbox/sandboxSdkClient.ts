import { LocalSandbox } from './LocalSandbox';
import { ExecuteResponse } from './sandboxTypes';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
    TemplateDetailsResponse,
    BootstrapResponse,
    GetInstanceResponse,
    BootstrapStatusResponse,
    ShutdownResponse,
    WriteFilesRequest,
    WriteFilesResponse,
    GetFilesResponse,
    ExecuteCommandsResponse,
    RuntimeErrorResponse,
    ClearErrorsResponse,
    StaticAnalysisResponse,
    DeploymentResult,
    FileTreeNode,
    RuntimeError,
    CommandExecutionResult,
    CodeIssue,
    InstanceDetails,
    LintSeverity,
    TemplateInfo,
    TemplateDetails,
    GitHubPushRequest, GitHubPushResponse, GitHubExportRequest, GitHubExportResponse,
    GetLogsResponse,
    ListInstancesResponse,
} from './sandboxTypes';

import { createObjectLogger } from '../../logger';
import { BaseSandboxService } from './BaseSandboxService';

import { 
    buildDeploymentConfig, 
    parseWranglerConfig, 
    deployToDispatch, 
} from '../deployer/deploy';
import { 
    createAssetManifest 
} from '../deployer/utils/index';
import { CodeFixResult, FileFetcher, fixProjectIssues } from '../code-fixer';
import { FileObject } from '../code-fixer/types';
import { generateId } from '../../utils/idGenerator';
import { ResourceProvisioner } from './resourceProvisioner';
import { TemplateParser } from './templateParser';
import { ResourceProvisioningResult } from './types';
import { GitHubService } from '../github/GitHubService';
import { getPreviewDomain } from 'worker/utils/urls';

interface InstanceMetadata {
    templateName: string;
    projectName: string;
    startTime: string;
    webhookUrl?: string;
    previewURL?: string;
    tunnelURL?: string;
    processId?: string;
    allocatedPort?: number;
    donttouch_files: string[];
    redacted_files: string[];
}

type SandboxType = LocalSandbox;

export class SandboxSdkClient extends BaseSandboxService {
    private sandbox: SandboxType;
    private metadataCache = new Map<string, InstanceMetadata>();
    
    private envVars?: Record<string, string>;

    constructor(sandboxId: string, envVars?: Record<string, string>) {
        super(sandboxId);
        this.sandbox = this.getSandbox();
        this.envVars = envVars;
        
        this.logger = createObjectLogger(this, 'SandboxSdkClient');
        this.logger.setFields({
            sandboxId: this.sandboxId
        });
        this.logger.info('SandboxSdkClient initialized', { sandboxId: this.sandboxId });
    }

    async initialize(): Promise<void> {
        const echoResult = await this.sandbox.exec('echo "Hello World"');
        if (echoResult.exitCode !== 0) {
            throw new Error(`Failed to run echo command: ${echoResult.stderr}`);
        }
        this.logger.info('Sandbox initialization complete')
    }

    private getWranglerKVKey(instanceId: string): string {
        return `wrangler-${instanceId}`;
    }

    private getSandbox(): SandboxType {
        if (!this.sandbox) {
            this.sandbox = new LocalSandbox();
        }
        return this.sandbox;
    }

    private getInstanceMetadataFile(instanceId: string): string {
        return path.join('data', 'instances', instanceId, 'metadata.json');
    }

    private async executeCommand(instanceId: string, command: string, timeout?: number): Promise<ExecuteResponse> {
        const instancePath = path.join(process.cwd(), 'data', 'instances', instanceId);
        return await this.getSandbox().exec(command, { cwd: instancePath, timeout });
    }

    private async getInstanceMetadata(instanceId: string): Promise<InstanceMetadata> {
        if (this.metadataCache.has(instanceId)) {
            return this.metadataCache.get(instanceId)!;
        }
        
        try {
            const metadataFile = await this.getSandbox().readFile(this.getInstanceMetadataFile(instanceId));
            const metadata = JSON.parse(metadataFile.content) as InstanceMetadata;
            this.metadataCache.set(instanceId, metadata);
            return metadata;
        } catch {
            throw new Error('Failed to read instance metadata');
        }
    }

    private async storeInstanceMetadata(instanceId: string, metadata: InstanceMetadata): Promise<void> {
        await this.getSandbox().writeFile(this.getInstanceMetadataFile(instanceId), JSON.stringify(metadata, null, 2));
        this.metadataCache.set(instanceId, metadata);
    }

    private invalidateMetadataCache(instanceId: string): void {
        this.metadataCache.delete(instanceId);
    }

    private async allocateAvailablePort(excludedPorts: number[] = [3000]): Promise<number> {
        return 8001 + Math.floor(Math.random() * 998);
    }

    private async checkTemplateExists(templateName: string): Promise<boolean> {
        const templatesPath = path.join(process.cwd(), 'templates', templateName, 'package.json');
        try {
            await fs.access(templatesPath);
            return true;
        } catch {
            return false;
        }
    }

    static async listTemplates(): Promise<{ success: boolean, templates: TemplateInfo[] }> {
        // This should be adapted to read from a local catalog file.
        return { success: true, templates: [] };
    }
    
    async getTemplateDetails(templateName: string): Promise<TemplateDetailsResponse> {
        // This method needs significant refactoring for local environment.
        // For now, returning a dummy response.
        this.logger.warn('getTemplateDetails is not fully implemented for local environment.');
        return { success: false, error: 'Not implemented' };
    }

    private async buildFileTree(instancePath: string): Promise<FileTreeNode | undefined> {
        // Implement local file tree building
        return undefined;
    }

    async listAllInstances(): Promise<ListInstancesResponse> {
        this.logger.warn('listAllInstances is not implemented for local environment.');
        return { success: true, instances: [], count: 0 };
    }

    async createInstance(templateName: string, projectName: string, webhookUrl?: string, localEnvVars?: Record<string, string>): Promise<BootstrapResponse> {
        this.logger.warn('createInstance is not fully implemented for local environment.');
        return { success: false, error: 'Not implemented' };
    }

    async getInstanceDetails(instanceId: string): Promise<GetInstanceResponse> {
        this.logger.warn('getInstanceDetails is not implemented for local environment.');
        return { success: false, error: 'Not implemented' };
    }

    async getInstanceStatus(instanceId: string): Promise<BootstrapStatusResponse> {
        this.logger.warn('getInstanceStatus is not implemented for local environment.');
        return { success: false, pending: false, isHealthy: false, error: 'Not implemented' };
    }

    async shutdownInstance(instanceId: string): Promise<ShutdownResponse> {
        this.logger.warn('shutdownInstance is not implemented for local environment.');
        return { success: true, message: 'Shutdown not needed for local environment.' };
    }

    async writeFiles(instanceId: string, files: WriteFilesRequest['files'], commitMessage?: string): Promise<WriteFilesResponse> {
        const results = [];
        const instancePath = path.join('data', 'instances', instanceId);
        for (const file of files) {
            const result = await this.sandbox.writeFile(path.join(instancePath, file.filePath), file.fileContents);
            results.push({ file: file.filePath, success: result.success, error: result.error });
        }
        return { success: true, results, message: `Wrote ${files.length} files.` };
    }

    async getFiles(instancePath: string, filePaths?: string[], applyFilter: boolean = true, redactedFiles?: string[]): Promise<GetFilesResponse> {
        const files = [];
        const errors = [];
        const allFilePaths = filePaths || [];
        
        for (const filePath of allFilePaths) {
            try {
                const result = await this.sandbox.readFile(path.join(instancePath, filePath));
                if (result.success) {
                    files.push({ filePath, fileContents: result.content });
                } else {
                    errors.push({ file: filePath, error: result.error || 'Read failed' });
                }
            } catch (error: any) {
                errors.push({ file: filePath, error: error.message });
            }
        }
        return { success: true, files, errors };
    }

    async getLogs(instanceId: string, onlyRecent?: boolean): Promise<GetLogsResponse> {
        this.logger.warn('getLogs is not implemented for local environment.');
        return { success: true, logs: { stdout: '', stderr: '' } };
    }

    async executeCommands(instanceId: string, commands: string[], timeout?: number): Promise<ExecuteCommandsResponse> {
        const results: CommandExecutionResult[] = [];
        for (const command of commands) {
            const result = await this.executeCommand(instanceId, command, timeout);
            results.push({
                command,
                success: result.exitCode === 0,
                output: result.stdout,
                error: result.stderr || undefined,
                exitCode: result.exitCode
            });
        }
        return { success: true, results, message: `Executed ${commands.length} commands.` };
    }

    async getInstanceErrors(instanceId: string, clear?: boolean): Promise<RuntimeErrorResponse> {
        this.logger.warn('getInstanceErrors is not implemented for local environment.');
        return { success: true, errors: [], hasErrors: false };
    }

    async clearInstanceErrors(instanceId: string): Promise<ClearErrorsResponse> {
        this.logger.warn('clearInstanceErrors is not implemented for local environment.');
        return { success: true, message: 'Errors cleared.' };
    }

    async runStaticAnalysisCode(instanceId: string): Promise<StaticAnalysisResponse> {
        this.logger.warn('runStaticAnalysisCode is not fully implemented for local environment.');
        return { success: false, lint: { issues: [] }, typecheck: { issues: [] }, error: 'Not implemented' };
    }

    async fixCodeIssues(instanceId: string, allFiles?: FileObject[]): Promise<CodeFixResult> {
        this.logger.warn('fixCodeIssues is not implemented for local environment.');
        return { fixedIssues: [], unfixableIssues: [], modifiedFiles: [] };
    }

    async deployToCloudflareWorkers(instanceId: string): Promise<DeploymentResult> {
        this.logger.warn('deployToCloudflareWorkers is not implemented in this environment.');
        return {
            success: false,
            message: 'Deployment to Cloudflare Workers is not supported.',
            error: 'Not implemented'
        };
    }

    private getProtocolForHost(): string {
        return 'http';
    }

    async exportToGitHub(instanceId: string, request: GitHubExportRequest): Promise<GitHubExportResponse> {
        this.logger.warn('exportToGitHub is not implemented for local environment.');
        return { success: false, error: 'Not implemented' };
    }

    async pushToGitHub(instanceId: string, request: GitHubPushRequest): Promise<GitHubPushResponse> {
        this.logger.warn('pushToGitHub is not implemented for local environment.');
        return { success: false, error: 'Not implemented' };
    }

    private mapSeverityToLegacy(severity: string): 'warning' | 'error' | 'fatal' {
        return 'warning';
    }
}