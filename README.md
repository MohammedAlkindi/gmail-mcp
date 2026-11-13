# gmail-mcp

Multi-account Gmail MCP server over IMAP and SMTP. One stdio server, every tool takes an `account` alias, so Claude can read, label, trash and send from several Gmail accounts separately without Google Cloud OAuth.

- Auth: Gmail app passwords (2-Step Verification required), stored under `~/.gmail-mcp/accounts.json` protected with Windows DPAPI. Only this Windows user can decrypt them.
- Search uses Gmail's own query syntax through the `X-GM-RAW` IMAP extension.
- No permanent delete exists. `trash` moves to Trash; `untrash` moves back.
- `send_email` is the only irreversible tool.

```
node src/cli.js add ucsd you@school.edu 2
node src/cli.js set-password ucsd        # prompted, not echoed
node src/cli.js test ucsd
claude mcp add --scope user gmail-accounts -- node C:/path/to/gmail-mcp/src/server.js
```
