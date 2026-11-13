import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, parseHeaders, replySubject, messageIdList, gmailLabel, humanLabel, stripSelf, webLink } from '../src/util.js';

test('htmlToText keeps paragraphs and drops markup', () => {
  const t = htmlToText('<html><head><style>p{}</style></head><body><p>Hi&nbsp;there,</p><div>line &amp; two</div><ul><li>a</li><li>b</li></ul><script>x()</script></body></html>');
  assert.equal(t, 'Hi there,\nline & two\n- a\n- b');
});

test('parseHeaders unfolds continuation lines', () => {
  const h = parseHeaders('Message-ID: <a@x>\r\nReferences: <1@x>\r\n <2@x>\r\nSubject: Hello\r\n\r\n');
  assert.equal(h['message-id'], '<a@x>');
  assert.deepEqual(messageIdList(h.references), ['<1@x>', '<2@x>']);
  assert.equal(h.subject, 'Hello');
});

test('replySubject adds Re: once', () => {
  assert.equal(replySubject('Hello'), 'Re: Hello');
  assert.equal(replySubject('RE: Hello'), 'RE: Hello');
});

test('label names round-trip through Gmail system names', () => {
  assert.equal(gmailLabel('inbox'), '\\Inbox');
  assert.equal(gmailLabel('Universities/UCSD'), 'Universities/UCSD');
  assert.equal(humanLabel('\\Inbox'), 'INBOX');
  assert.equal(humanLabel('Career'), 'Career');
});

test('stripSelf removes the sending account from reply-all lists', () => {
  assert.deepEqual(stripSelf(['A <a@x>', 'Me <me@x>'], 'me@x'), ['A <a@x>']);
});

test('webLink uses the hex Gmail message id', () => {
  assert.equal(webLink(2, '1234567890123456789'), 'https://mail.google.com/mail/u/2/#all/112210f47de98115');
  assert.equal(webLink(undefined, '1'), undefined);
});
