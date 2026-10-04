// Local SMTP sink for tests: accepts everything on :2525 and appends parsed messages to _mails.jsonl.
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { appendFileSync, writeFileSync } from 'fs';
writeFileSync('_mails.jsonl', '');
const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, session, cb) {
    simpleParser(stream)
      .then((m) => {
        appendFileSync('_mails.jsonl', JSON.stringify({ to: m.to?.text, from: m.from?.text, subject: m.subject, text: m.text, html: m.html, listUnsubscribe: m.headerLines.find((h) => h.key === 'list-unsubscribe')?.line.replace(/^[^:]+:\s*/, ''), listUnsubscribePost: m.headerLines.find((h) => h.key === 'list-unsubscribe-post')?.line.replace(/^[^:]+:\s*/, '') }) + '\n');
        cb();
      })
      .catch(cb);
  },
});
server.listen(2525, '127.0.0.1', () => console.log('SMTP sink on 127.0.0.1:2525'));
