const https = require('https');

module.exports = async function (context, req) {
  try {
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (!webhook) {
      context.res = { status: 500, body: 'Server misconfigured: SLACK_WEBHOOK_URL missing' };
      return;
    }

    const payload = req.body || { text: 'Hello from CivicMapper' };
    const body = Buffer.from(JSON.stringify(payload));

    await postJSON(webhook, body);
    context.res = { status: 204 };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: 'Failed to post to Slack' };
  }
};

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    };
    const req = https.request(opts, (res) => {
      res.on('data', () => {});
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error('Slack HTTP ' + res.statusCode)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
