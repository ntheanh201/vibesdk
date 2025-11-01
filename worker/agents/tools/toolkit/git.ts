import { ToolDefinition } from '../types';
import { StructuredLogger } from '../../../logger';
import { CodingAgentInterface } from 'worker/agents/services/implementations/CodingAgent';

type GitCommand = 'commit' | 'log' | 'show' | 'revert' | 'checkout';

interface GitToolArgs {
	command: GitCommand;
	message?: string;
	limit?: number;
	oid?: string;
}

export function createGitTool(
	agent: CodingAgentInterface,
	logger: StructuredLogger,
): ToolDefinition<GitToolArgs, { success: boolean; data?: any; message?: string }> {
	return {
		type: 'function',
		function: {
			name: 'git',
			description:
				'Execute git commands. Commands: commit (save staged changes), log (view history), show (view commit details), revert (undo commit), checkout (restore files from commit).',
			parameters: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						enum: ['commit', 'log', 'show', 'revert', 'checkout'],
						description: 'Git command to execute'
					},
					message: {
						type: 'string',
						description: 'Commit message (required for commit command, e.g., "fix: resolve authentication bug")'
					},
					limit: {
						type: 'number',
						description: 'Number of commits to show (for log command, default: 10)'
					},
					oid: {
						type: 'string',
						description: 'Commit hash/OID (required for show, revert, checkout commands)'
					}
				},
				required: ['command'],
			},
		},
		implementation: async ({ command, message, limit, oid }: GitToolArgs) => {
			try {
				const gitInstance = agent.getGit();
				
				switch (command) {
					case 'commit': {
						if (!message) {
							return {
								success: false,
								message: 'Commit message is required for commit command'
							};
						}
						
						logger.info('Git commit', { message });
						const commitOid = await gitInstance.commit([], message);
						
						return {
							success: true,
							data: { oid: commitOid },
							message: commitOid ? `Committed: ${message}` : 'No changes to commit'
						};
					}
					
					case 'log': {
						logger.info('Git log', { limit: limit || 10 });
						const commits = await gitInstance.log(limit || 10);
						
						return {
							success: true,
							data: { commits },
							message: `Retrieved ${commits.length} commits`
						};
					}
					
					case 'show': {
						if (!oid) {
							return {
								success: false,
								message: 'Commit OID is required for show command'
							};
						}
						
						logger.info('Git show', { oid });
						const result = await gitInstance.show(oid);
						
						return {
							success: true,
							data: result,
							message: `Commit ${result.oid.substring(0, 7)}: ${result.message} (${result.files} files)`
						};
					}
					
					case 'checkout': {
						if (!oid) {
							return {
								success: false,
								message: 'Commit OID is required for checkout command'
							};
						}
						
						logger.info('Git checkout', { oid });
						const result = await gitInstance.restoreCommit(oid);
						
						return {
							success: true,
							data: result,
							message: `Restored ${result.filesRestored} files from commit ${result.oid.substring(0, 7)}. Files are staged.`
						};
					}
					
					case 'revert': {
						if (!oid) {
							return {
								success: false,
								message: 'Commit OID is required for revert command'
							};
						}
						
						logger.info('Git revert', { oid });
						const result = await gitInstance.revert(oid);
						
						return {
							success: true,
							data: result,
							message: `Reverted commit ${result.revertedCommit.substring(0, 7)}. New commit: ${result.revertCommit?.substring(0, 7)}`
						};
					}
					
					default:
						return {
							success: false,
							message: `Unknown git command: ${command}`
						};
				}
			} catch (error) {
				logger.error('Git command failed', { command, error });
				return {
					success: false,
					message: `Git ${command} failed: ${error instanceof Error ? error.message : String(error)}`
				};
			}
		},
	};
}
