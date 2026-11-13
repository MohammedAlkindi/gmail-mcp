const SYSTEM_LABELS = {
  '\\Inbox': 'INBOX', '\\Sent': 'SENT', '\\Draft': 'DRAFT', '\\Drafts': 'DRAFT', '\\Trash': 'TRASH',
  '\\Spam': 'SPAM', '\\Starred': 'STARRED', '\\Important': 'IMPORTANT', '\\All': 'ALL',
};
const TO_GMAIL = { INBOX: '\\Inbox', STARRED: '\\Starred', IMPORTANT: '\\Important', SPAM: '\\Spam', TRASH: '\\Trash' };

export function humanLabel(l) { return SYSTEM_LABELS[l] || l; }
export function gmailLabel(name) { return TO_GMAIL[name.toUpperCase()] || name; }

export function addr(list) {
  if (!list) return [];
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address || ''));
}

export function webLink(webIndex, emailId) {
  if (webIndex === undefined || webIndex === null || !emailId) return undefined;
  return `https://mail.google.com/mail/u/${webIndex}/#all/${BigInt(emailId).toString(16)}`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e) => {
      if (ENTITIES[e] !== undefined) return ENTITIES[e];
      if (e[0] === '#') {
        const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Parse a raw RFC 5322 header block into a lower-cased map of unfolded values.
export function parseHeaders(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
  const out = {};
  for (const line of text.replace(/\r\n[ \t]+/g, ' ').replace(/\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    out[k] = out[k] ? `${out[k]} ${v}` : v;
  }
  return out;
}

export function replySubject(subject) {
  const s = (subject || '').trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function messageIdList(value) {
  return (value || '').match(/<[^>]+>/g) || [];
}

export function stripSelf(list, self) {
  const me = (self || '').toLowerCase();
  return list.filter((a) => !a.toLowerCase().includes(me));
}
