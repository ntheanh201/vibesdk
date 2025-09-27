import { SmartCodeGeneratorAgent } from './core/smartGeneratorAgent';
import { CodeGenState } from './core/state';
import { generateId } from '../utils/idGenerator';
import { StructuredLogger } from '../logger';
import { InferenceContext } from './inferutils/config.types';
import { SandboxSdkClient } from '../services/sandbox/sandboxSdkClient';
import { selectTemplate } from './planning/templateSelector';
import { getSandboxService } from '../services/sandbox/factory';
import { TemplateDetails } from '../services/sandbox/sandboxTypes';
import { TemplateSelection } from './schemas';
import { agentManager } from './AgentManager';
import { AgentInitArgs } from './core/types';

export async function getAgent(agentId: string): Promise<SmartCodeGeneratorAgent | undefined> {
    return agentManager.getAgent(agentId);
}

export async function createAgent(
    env: Env, // Still need env for now for things like selectTemplate
    inferenceContext: InferenceContext,
    query: string,
    logger: StructuredLogger,
): Promise<SmartCodeGeneratorAgent> {
    const { sandboxSessionId, templateDetails, selection } = await getTemplateForQuery(env, inferenceContext, query, logger);

    const initArgs: AgentInitArgs = {
        query,
        hostname: 'localhost', // This needs to be configured
        inferenceContext,
        templateInfo: {
            templateDetails,
            selection,
        },
        sandboxSessionId,
        onBlueprintChunk: () => {}, // Placeholder for streaming
    };

    return agentManager.createAgent(initArgs);
}

export async function getAgentState(agentId: string): Promise<CodeGenState | undefined> {
    const agentInstance = await getAgent(agentId);
    if (agentInstance) {
        return agentInstance.getFullState();
    }
    return undefined;
}

// Cloning is complex and will be addressed later.
// export async function cloneAgent(agentId: string, logger: StructuredLogger) : Promise<{newAgentId: string, newAgent: SmartCodeGeneratorAgent}> {
//     // ... implementation ...
// }

export async function getTemplateForQuery(
    env: Env,
    inferenceContext: InferenceContext,
    query: string,
    logger: StructuredLogger,
) : Promise<{sandboxSessionId: string, templateDetails: TemplateDetails, selection: TemplateSelection}> {
    // Fetch available templates
    const templatesResponse = await SandboxSdkClient.listTemplates();
    if (!templatesResponse || !templatesResponse.success) {
        throw new Error('Failed to fetch templates from sandbox service');
    }

    const sandboxSessionId = generateId();
        
    const [analyzeQueryResponse, sandboxClient] = await Promise.all([
            selectTemplate({
                env: env,
                inferenceContext,
                query,
                availableTemplates: templatesResponse.templates,
            }), 
            getSandboxService(sandboxSessionId)
        ]);
        
        logger.info('Selected template', { selectedTemplate: analyzeQueryResponse });
            
        // Find the selected template by name in the available templates
        if (!analyzeQueryResponse.selectedTemplateName) {
            logger.error('No suitable template found for code generation');
            throw new Error('No suitable template found for code generation');
        }
            
        const selectedTemplate = templatesResponse.templates.find(template => template.name === analyzeQueryResponse.selectedTemplateName);
        if (!selectedTemplate) {
            logger.error('Selected template not found');
            throw new Error('Selected template not found');
        }
        // Now fetch all the files from the instance
        const templateDetailsResponse = await sandboxClient.getTemplateDetails(selectedTemplate.name);
        if (!templateDetailsResponse.success || !templateDetailsResponse.templateDetails) {
            logger.error('Failed to fetch files', { templateDetailsResponse });
            throw new Error('Failed to fetch files');
        }
            
        const templateDetails = templateDetailsResponse.templateDetails;
        return { sandboxSessionId, templateDetails, selection: analyzeQueryResponse };
}