import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { simpleParser } from 'mailparser';
import { getClient, getPassword } from './accounts.js';
import { addr, gmailLabel, humanLabel, htmlToText, messageIdList, parseHeaders, replySubject, stripSelf, webLink } from './util.js';

const SOURCE_CAP = 1_500_000; // bytes of raw message fetched for body text; attachments past this are listed, not read
const SUMMARY = { uid: true, envelope: true, flags: true, labels: true, threadId: true, emailId: true, internalDate: true, size: true };

async function withBox(entry, path, fn) {
  const lock = await entry.client.getMailboxLock(path);
  try { return await fn(entry.client); } finally { lock.release(); }
}

function folderPath(entry, folder) {
  if (!folder) return entry.special['\\All'];
  const f = folder.toLowerCase();
  if (f === 'inbox') return 'INBOX';
  const key = { all: '\\All', trash: '\\Trash', spam: '\\Spam', sent: '\\Sent', drafts: '\\Drafts' }[f];
  if (key && entry.special[key]) return entry.special[key];
  return folder; // a label path such as Universities/UCSD
}

function summarize(m, entry) {
  const e = m.envelope || {};
  return {
    id: m.emailId, thread_id: m.threadId, date: m.internalDate,
    from: addr(e.from), to: addr(e.to), cc: addr(e.cc), subject: e.subject || '',
    unread: !m.flags?.has('\\Seen'), starred: Boolean(m.flags?.has('\\Flagged')),
    labels: [...(m.labels || [])].map(humanLabel), size: m.size,
    link: webLink(entry.web_index, m.emailId),
  };
}

async function uidsFor(client, ids) {
  const uids = [];
  const missing = [];
  for (const id of ids) {
    const r = await client.search({ emailId: String(id) }, { uid: true });
    if (r && r.length) uids.push(...r); else missing.push(String(id));
  }
  return { uids, missing };
}

export async function searchEmails(alias, { query, limit = 20, folder }) {
  const entry = await getClient(alias);
  return withBox(entry, folderPath(entry, folder), async (c) => {
    const uids = await c.search({ gmraw: query }, { uid: true });
    if (!uids || !uids.length) return { account: entry.alias, total: 0, messages: [] };
    const pick = uids.slice(-Math.max(1, Math.min(limit, 100)));
    const msgs = await c.fetchAll(pick, SUMMARY, { uid: true });
    const messages = msgs.map((m) => summarize(m, entry)).sort((a, b) => new Date(b.date) - new Date(a.date));
    return { account: entry.alias, total: uids.length, messages };
  });
}

async function fullMessage(m, entry) {
  const base = summarize(m, entry);
  let text = '';
  let attachments = [];
  if (m.source) {
    const parsed = await simpleParser(m.source, { skipImageLinks: true, skipTextLinks: true });
    text = parsed.text || htmlToText(parsed.html) || '';
    attachments = (parsed.attachments || []).map((a) => ({ filename: a.filename, content_type: a.contentType, size: a.size }));
  }
  return { ...base, message_id_header: m.envelope?.messageId, text, attachments, truncated: (m.size || 0) > SOURCE_CAP };
}

export async function getThread(alias, { thread_id }) {
  const entry = await getClient(alias);
  return withBox(entry, entry.special['\\All'], async (c) => {
    const uids = await c.search({ threadId: String(thread_id) }, { uid: true });
    if (!uids || !uids.length) throw new Error(`thread ${thread_id} not found in All Mail (it may be in Trash or Spam)`);
    const out = [];
    for await (const m of c.fetch(uids, { ...SUMMARY, source: { maxLength: SOURCE_CAP } }, { uid: true })) out.push(await fullMessage(m, entry));
    out.sort((a, b) => new Date(a.date) - new Date(b.date));
    return { account: entry.alias, thread_id: String(thread_id), messages: out };
  });
}

export async function getMessage(alias, { id }) {
  const entry = await getClient(alias);
  for (const path of [entry.special['\\All'], entry.special['\\Trash'], entry.special['\\Spam']].filter(Boolean)) {
    const found = await withBox(entry, path, async (c) => {
      const uids = await c.search({ emailId: String(id) }, { uid: true });
      if (!uids || !uids.length) return null;
      const m = await c.fetchOne(uids[0], { ...SUMMARY, source: { maxLength: SOURCE_CAP } }, { uid: true });
      return m ? { ...(await fullMessage(m, entry)), folder: path } : null;
    });
    if (found) return found;
  }
  throw new Error(`message ${id} not found`);
}

async function originalForReply(entry, id) {
  return withBox(entry, entry.special['\\All'], async (c) => {
    const uids = await c.search({ emailId: String(id) }, { uid: true });
    if (!uids || !uids.length) throw new Error(`message ${id} not found in All Mail`);
    const m = await c.fetchOne(uids[0], { uid: true, envelope: true, headers: ['references', 'message-id', 'reply-to'] }, { uid: true });
    const h = parseHeaders(m.headers);
    const e = m.envelope || {};
    return {
      messageId: e.messageId || messageIdList(h['message-id'])[0],
      references: messageIdList(h.references),
      subject: e.subject || '',
      from: addr(e.from), replyTo: addr(e.replyTo), to: addr(e.to), cc: addr(e.cc),
    };
  });
}

async function buildMail(entry, { to, cc, bcc, subject, text, reply_to_id, reply_all }) {
  const mail = { from: entry.email, to, cc, bcc, subject, text };
  if (reply_to_id) {
    const o = await originalForReply(entry, reply_to_id);
    if (o.messageId) {
      mail.inReplyTo = o.messageId;
      mail.references = [...o.references, o.messageId].join(' ');
    }
    if (!subject) mail.subject = replySubject(o.subject);
    if (!to) {
      const primary = o.replyTo.length ? o.replyTo : o.from;
      mail.to = reply_all ? stripSelf([...primary, ...o.to], entry.email) : primary;
      if (reply_all && !cc) mail.cc = stripSelf(o.cc, entry.email);
    }
  }
  if (!mail.to || (Array.isArray(mail.to) && !mail.to.length)) throw new Error('no recipient');
  if (!mail.subject) throw new Error('no subject');
  return mail;
}

export async function sendEmail(alias, args) {
  const entry = await getClient(alias);
  const mail = await buildMail(entry, args);
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: entry.email, pass: getPassword(entry.alias) },
  });
  const info = await transport.sendMail(mail);
  transport.close();
  return {
    account: entry.alias, from: entry.email, to: mail.to, cc: mail.cc, subject: mail.subject,
    message_id_header: info.messageId, accepted: info.accepted, rejected: info.rejected,
  };
}

export async function createDraft(alias, args) {
  const entry = await getClient(alias);
  const mail = await buildMail(entry, args);
  const raw = await new MailComposer(mail).compile().build();
  const drafts = entry.special['\\Drafts'];
  if (!drafts) throw new Error('no Drafts folder exposed over IMAP');
  const res = await withBox(entry, drafts, (c) => c.append(drafts, raw, ['\\Draft']));
  return { account: entry.alias, folder: drafts, uid: res?.uid, to: mail.to, subject: mail.subject };
}

export async function modifyLabels(alias, { ids, add = [], remove = [] }) {
  const entry = await getClient(alias);
  return withBox(entry, entry.special['\\All'], async (c) => {
    const { uids, missing } = await uidsFor(c, ids);
    if (uids.length && add.length) await c.messageFlagsAdd(uids, add.map(gmailLabel), { uid: true, useLabels: true });
    if (uids.length && remove.length) await c.messageFlagsRemove(uids, remove.map(gmailLabel), { uid: true, useLabels: true });
    return { account: entry.alias, changed: uids.length, missing, added: add, removed: remove };
  });
}

export async function markRead(alias, { ids, read = true }) {
  const entry = await getClient(alias);
  return withBox(entry, entry.special['\\All'], async (c) => {
    const { uids, missing } = await uidsFor(c, ids);
    if (uids.length) {
      if (read) await c.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      else await c.messageFlagsRemove(uids, ['\\Seen'], { uid: true });
    }
    return { account: entry.alias, changed: uids.length, missing, read };
  });
}

export async function trash(alias, { ids }) {
  const entry = await getClient(alias);
  return withBox(entry, entry.special['\\All'], async (c) => {
    const { uids, missing } = await uidsFor(c, ids);
    if (uids.length) await c.messageMove(uids, entry.special['\\Trash'], { uid: true });
    return { account: entry.alias, trashed: uids.length, missing };
  });
}

export async function untrash(alias, { ids, to_inbox = true }) {
  const entry = await getClient(alias);
  const moved = await withBox(entry, entry.special['\\Trash'], async (c) => {
    const { uids, missing } = await uidsFor(c, ids);
    if (uids.length) await c.messageMove(uids, entry.special['\\All'], { uid: true });
    return { restored: uids.length, missing };
  });
  if (to_inbox && moved.restored) await modifyLabels(alias, { ids, add: ['INBOX'] });
  return { account: entry.alias, ...moved, to_inbox };
}

export async function listLabels(alias) {
  const entry = await getClient(alias);
  const boxes = await entry.client.list({ statusQuery: { messages: true, unseen: true } });
  return {
    account: entry.alias,
    labels: boxes.map((b) => ({
      name: b.path,
      special_use: b.specialUse ? humanLabel(b.specialUse) : undefined,
      messages: b.status?.messages,
      unseen: b.status?.unseen,
    })),
  };
}
