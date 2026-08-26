import { IndexedDbRepository } from './repository.js';
import { createAdvocateService } from './domain.js';
import { registerAdvocateTools, createToolDefinitions } from './webmcp.js';
import { createUI } from './ui.js';

const repository = new IndexedDbRepository();
await repository.ensureSeeded();

const ui = createUI(repository);
const service = createAdvocateService(repository, { onEvent: (event) => ui.onEvent(event) });

ui.bindNavigation();
await ui.render();

try {
  const status = await registerAdvocateTools(service);
  ui.setWebMcpStatus(status);
} catch (error) {
  console.error('WebMCP registration failed', error);
  ui.setWebMcpStatus({ supported: false, error: error instanceof Error ? error.message : String(error) });
}

document.querySelector('#approveBillOnly').addEventListener('click', async () => {
  await service.approveResolution({ includePlan: false });
});

document.querySelector('#approveBillAndPlan').addEventListener('click', async () => {
  await service.approveResolution({ includePlan: true, planId: 'fiber-500-flex' });
});

document.querySelector('#resetDemo').addEventListener('click', async () => {
  await repository.reset();
  location.hash = '#account';
  location.reload();
});

// Small, read-only test surface for browser automation. It uses the same service and tool definitions as WebMCP.
Object.defineProperty(window, '__ADVOCATE_TEST__', {
  value: {
    names: createToolDefinitions(service).map((tool) => tool.name),
    invoke: async (name, input = {}) => {
      const tool = createToolDefinitions(service).find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool.execute(input);
    },
    approve: async (includePlan = false) => service.approveResolution({ includePlan, planId: 'fiber-500-flex' }),
    state: () => service.getState()
  },
  writable: false,
  configurable: false
});
