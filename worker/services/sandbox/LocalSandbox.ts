import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ExecuteResponse } from './sandboxTypes';

const execAsync = promisify(exec);

export class LocalSandbox {
    private processes = new Map<string, ChildProcess>();

    constructor() {}

    private getBasePath(): string {
        return path.join(process.cwd());
    }

    async exec(command: string, options?: { timeout?: number, cwd?: string }): Promise<ExecuteResponse> {
        const cwd = options?.cwd || this.getBasePath();
        try {
            if (cwd.includes('..')) {
                throw new Error('Directory traversal is not allowed.');
            }
            const { stdout, stderr } = await execAsync(command, { cwd, timeout: options?.timeout });
            return { stdout, stderr, exitCode: 0 };
        } catch (error: any) {
            return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code || 1 };
        }
    }

    async writeFile(filePath: string, content: string | Buffer) {
        try {
            const fullPath = path.join(this.getBasePath(), filePath);
            if (fullPath.includes('..')) {
                throw new Error('Directory traversal is not allowed.');
            }
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content);
            return { success: true, path: filePath };
        } catch (error: any) {
            return { success: false, path: filePath, error: error.message };
        }
    }

    async readFile(filePath: string) {
        try {
            const fullPath = path.join(this.getBasePath(), filePath);
            if (fullPath.includes('..')) {
                throw new Error('Directory traversal is not allowed.');
            }
            const content = await fs.readFile(fullPath, 'utf-8');
            return { success: true, content, exitCode: 0 };
        } catch (error: any) {
            return { success: false, content: '', error: error.message, exitCode: 1 };
        }
    }

    async startProcess(command: string, options?: { cwd?: string }) {
        const cwd = options?.cwd || this.getBasePath();
        if (cwd.includes('..')) {
            throw new Error('Directory traversal is not allowed.');
        }
        const [cmd, ...args] = command.split(' ');
        const process = spawn(cmd, args, { cwd, detached: true });
        const id = process.pid!.toString();
        this.processes.set(id, process);
        return { id };
    }

    async getProcess(id: string) {
        const process = this.processes.get(id);
        return { id, status: process && !process.killed ? 'running' : 'stopped' };
    }

    async killProcess(id: string) {
        const process = this.processes.get(id);
        if (process) {
            process.kill();
            this.processes.delete(id);
        }
    }

    async listProcesses() {
        return Array.from(this.processes.keys()).map(id => ({ id, command: '' }));
    }

    async exposePort(port: number, options?: any) {
        return { url: `http://localhost:${port}` };
    }

    async unexposePort(port: number) {}

    async setEnvVars(vars: any) {}

    async getExposedPorts(hostname: string) {
        return [];
    }
}