import { Command } from 'commander';
import inquirer from 'inquirer';
import { EncryptedStore } from './store/encrypted-store.js';
import { AuditLogger } from './audit/logger.js';
import { startDashboard } from './dashboard/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const store = new EncryptedStore();
const audit = new AuditLogger();

async function init() {
  await store.init();
  await audit.init();
}

export async function runCli() {
  const program = new Command();

  program
    .name('vault-mcp')
    .description('Credential isolation for LLM agents')
    .version('0.1.0');

  // --- add ---
  program
    .command('add')
    .description('Add a new credential')
    .option('-s, --site <siteId>', 'Site identifier')
    .option('-e, --email <email>', 'Email/username')
    .option('-u, --url <loginUrl>', 'Login page URL')
    .option('-t, --type <type>', 'Service type: web_login or api_key', 'web_login')
    .action(async (opts) => {
      await init();

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'siteId',
          message: 'Site identifier (e.g. "github"):',
          when: !opts.site,
          validate: (v: string) => v.trim().length > 0 || 'Required',
        },
        {
          type: 'list',
          name: 'serviceType',
          message: 'Service type:',
          choices: ['web_login', 'api_key'],
          when: !opts.type || opts.type === 'web_login',
          default: opts.type || 'web_login',
        },
        {
          type: 'input',
          name: 'email',
          message: 'Email/username:',
          when: !opts.email,
        },
        {
          type: 'password',
          name: 'password',
          message: (a: Record<string, string>) => (a.serviceType || opts.type) === 'api_key' ? 'API key:' : 'Password:',
          mask: '*',
          validate: (v: string) => v.trim().length > 0 || 'Required',
        },
        {
          type: 'input',
          name: 'loginUrl',
          message: 'Login page URL:',
          when: (a: Record<string, string>) => (a.serviceType || opts.type) === 'web_login' && !opts.url,
        },
        {
          type: 'input',
          name: 'emailSelector',
          message: 'CSS selector for email field:',
          default: 'input[type="email"], input[name="email"], #email',
          when: (a: Record<string, string>) => (a.serviceType || opts.type) === 'web_login',
        },
        {
          type: 'input',
          name: 'passwordSelector',
          message: 'CSS selector for password field:',
          default: 'input[type="password"]',
          when: (a: Record<string, string>) => (a.serviceType || opts.type) === 'web_login',
        },
        {
          type: 'input',
          name: 'submitSelector',
          message: 'CSS selector for submit button:',
          default: 'button[type="submit"]',
          when: (a: Record<string, string>) => (a.serviceType || opts.type) === 'web_login',
        },
        {
          type: 'input',
          name: 'headerName',
          message: 'Header name for API key:',
          default: 'Authorization',
          when: (a: Record<string, string>) => (a.serviceType || opts.type) === 'api_key',
        },
        {
          type: 'input',
          name: 'headerPrefix',
          message: 'Header value prefix (e.g. "Bearer "):',
          default: 'Bearer ',
          when: (a: Record<string, string>) => (a.serviceType || opts.type) === 'api_key',
        },
      ]);

      const siteId = opts.site || answers.siteId;
      const serviceType = answers.serviceType || opts.type || 'web_login';
      const email = opts.email || answers.email;
      const password = answers.password;

      if (serviceType === 'web_login') {
        const loginUrl = opts.url || answers.loginUrl;
        const selectors = {
          email: answers.emailSelector || 'input[type="email"]',
          password: answers.passwordSelector || 'input[type="password"]',
          submit: answers.submitSelector || 'button[type="submit"]',
        };
        await store.addCredential(siteId, 'web_login', { email, password }, loginUrl, selectors);
      } else {
        const headerName = answers.headerName || 'Authorization';
        const headerPrefix = answers.headerPrefix || 'Bearer ';
        await store.addCredential(siteId, 'api_key', {
          apiKey: password,
          headers: { [headerName]: headerPrefix + password },
        });
      }

      await audit.log('credential.created', siteId, 'success');
      console.log(`\nCredential added: ${siteId} (${serviceType})`);
    });

  // --- list ---
  program
    .command('list')
    .description('List all credentials (no secrets shown)')
    .action(async () => {
      await init();
      const creds = store.listCredentials();
      if (creds.length === 0) {
        console.log('No credentials stored.');
        return;
      }
      console.log('\n  Site ID         | Type       | Active | Created');
      console.log('  ' + '-'.repeat(60));
      for (const c of creds) {
        const date = c.createdAt.split('T')[0];
        console.log(`  ${c.siteId.padEnd(16)} | ${c.serviceType.padEnd(10)} | ${c.active ? 'yes' : 'no '}    | ${date}`);
      }
      console.log();
    });

  // --- remove ---
  program
    .command('remove <siteId>')
    .description('Remove a credential')
    .action(async (siteId: string) => {
      await init();
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Remove credential "${siteId}"?`,
          default: false,
        },
      ]);
      if (!confirm) {
        console.log('Cancelled.');
        return;
      }
      const removed = await store.removeCredential(siteId);
      if (removed) {
        await audit.log('credential.removed', siteId, 'success');
        console.log(`Removed: ${siteId}`);
      } else {
        console.log(`Credential not found: ${siteId}`);
      }
    });

  // --- audit ---
  program
    .command('audit [siteId]')
    .description('Show audit log')
    .action(async (siteId?: string) => {
      await init();
      const entries = await audit.getEntries(siteId);
      if (entries.length === 0) {
        console.log('No audit entries.');
        return;
      }
      console.log('\n  Event     | Timestamp            | Action              | Site             | Result');
      console.log('  ' + '-'.repeat(85));
      for (const e of entries) {
        const ts = e.timestamp.replace('T', ' ').slice(0, 19);
        console.log(
          `  ${e.eventId.padEnd(9)} | ${ts} | ${e.action.padEnd(19)} | ${e.credentialId.padEnd(16)} | ${e.result}`,
        );
      }
      console.log();

      const chain = await audit.verifyChain();
      console.log(`  Chain integrity: ${chain.valid ? 'VALID' : 'BROKEN at entry ' + chain.brokenAt} (${chain.totalEntries} entries)\n`);
    });

  // --- dashboard ---
  program
    .command('dashboard')
    .description('Start web dashboard on localhost:9900')
    .option('-p, --port <port>', 'Port number', '9900')
    .action(async (opts) => {
      await init();
      startDashboard(store, audit, parseInt(opts.port, 10));
    });

  // --- serve ---
  program
    .command('serve')
    .description('Start MCP server on stdio (for debugging)')
    .action(async () => {
      const server = createServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error('Vault MCP server running on stdio');
    });

  await program.parseAsync();
}
