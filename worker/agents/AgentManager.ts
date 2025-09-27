import { SmartCodeGeneratorAgent } from './core/smartGeneratorAgent';
import { AgentInitArgs } from './core/types';

class AgentManager {
    private agents = new Map<string, SmartCodeGeneratorAgent>();

    private static instance: AgentManager;

    private constructor() {}

    public static getInstance(): AgentManager {
        if (!AgentManager.instance) {
            AgentManager.instance = new AgentManager();
        }
        return AgentManager.instance;
    }

    public async getAgent(agentId: string): Promise<SmartCodeGeneratorAgent | undefined> {
        return this.agents.get(agentId);
    }

    public async createAgent(initArgs: AgentInitArgs): Promise<SmartCodeGeneratorAgent> {
        const agentId = initArgs.inferenceContext.agentId;
        if (this.agents.has(agentId)) {
            throw new Error(`Agent with ID ${agentId} already exists.`);
        }

        // We need to adapt the agent's constructor and initialization
        const agent = new SmartCodeGeneratorAgent({} as any, {} as any);
        await agent.initialize(initArgs, 'deterministic');

        this.agents.set(agentId, agent);
        return agent;
    }
}

export const agentManager = AgentManager.getInstance();