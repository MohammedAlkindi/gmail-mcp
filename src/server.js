#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listAccounts, closeAll } from './accounts.js';
import * as mail from './mail.js';

const server = new McpServer({ name: 'gmail-accounts', version: '0.1.0' });

const account = z.string().optional().describe('Account alias (see list_accounts). Required when more than one account is configured.');
const ids = z.array(z.string()).min(1).max(100).describe('Message ids as returned by search_emails (the id field, not thread_id).');

function tool(name, description, shape, fn) {
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try {
      const result = await fn(args || {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `${name} failed: ${err?.message || err}` }] };
    }
  });
}

tool('list_accounts', 'List the configured Gmail accounts with their aliases.', {}, async () => listAccounts());

tool('search_emails', 'Search one Gmail account with Gmail search syntax (from:, to:, subject:, label:, is:unread, newer_than:7d, has:attachment ...). Newest first. Searches All Mail unless folder is given.', {
  account,
  query: z.string().min(1).describe('Gmail search query, e.g. "in:inbox is:unread newer_than:3d"'),
  limit: z.number().int().min(1).max(100).optional().describe('Max messages to return (default 20)'),
  folder: z.string().optional().describe('inbox, all, trash, spam, sent, drafts, or a label path. Default all.'),
}, ({ account: a, ...rest }) => mail.searchEmails(a, rest));

tool('get_thread', 'Read every message in a thread, with plain-text bodies and attachment names.', {
  account, thread_id: z.string().describe('thread_id from search_emails'),
}, ({ account: a, ...rest }) => mail.getThread(a, rest));

tool('get_message', 'Read one message with its plain-text body and attachment names.', {
  account, id: z.string().describe('message id from search_emails'),
}, ({ account: a, ...rest }) => mail.getMessage(a, rest));

const compose = {
  account,
  to: z.array(z.string()).optional().describe('Recipients. Optional when replying: defaults to the original sender.'),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional().describe('Optional when replying: defaults to Re: original subject.'),
  text: z.string().describe('Plain-text body'),
  reply_to_id: z.string().optional().describe('Message id to reply to. Sets In-Reply-To and References so Gmail threads it.'),
  reply_all: z.boolean().optional().describe('With reply_to_id: also address the original To and Cc recipients.'),
};

tool('send_email', 'Send an email from one account over SMTP. Irreversible: confirm with the user first.', compose, ({ account: a, ...rest }) => mail.sendEmail(a, rest));
tool('create_draft', 'Save a draft in one account. Nothing is sent.', compose, ({ account: a, ...rest }) => mail.createDraft(a, rest));

tool('modify_labels', 'Add or remove Gmail labels on messages. Use INBOX, STARRED, IMPORTANT for system labels; removing INBOX archives.', {
  account, ids,
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
}, ({ account: a, ...rest }) => mail.modifyLabels(a, rest));

tool('archive', 'Remove messages from the inbox (they stay in All Mail).', { account, ids }, ({ account: a, ids: list }) => mail.modifyLabels(a, { ids: list, remove: ['INBOX'] }));

tool('mark_read', 'Mark messages read or unread.', {
  account, ids, read: z.boolean().optional().describe('true marks read (default), false marks unread'),
}, ({ account: a, ...rest }) => mail.markRead(a, rest));

tool('trash', 'Move messages to Trash. Gmail empties Trash after 30 days; there is no permanent delete here.', { account, ids }, ({ account: a, ...rest }) => mail.trash(a, rest));

tool('untrash', 'Move messages out of Trash back to All Mail, and into the inbox unless to_inbox is false.', {
  account, ids, to_inbox: z.boolean().optional(),
}, ({ account: a, ...rest }) => mail.untrash(a, rest));

tool('list_labels', 'List labels and folders of one account with message and unread counts.', { account }, ({ account: a }) => mail.listLabels(a));

const transport = new StdioServerTransport();
await server.connect(transport);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await closeAll(); process.exit(0); });
