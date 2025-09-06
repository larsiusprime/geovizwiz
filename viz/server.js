const express = require('express');
const cors = require('cors');
const https = require('https');
const url = require('url');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Slack webhook URL from your .env
const SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/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";

// Proxy endpoint for Slack webhook
app.post('/api/slack-webhook', async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text message is required' });
        }

        const webhookUrl = url.parse(SLACK_WEBHOOK_URL);
        const postData = JSON.stringify({ text });

        const options = {
            hostname: webhookUrl.hostname,
            port: 443,
            path: webhookUrl.path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const slackReq = https.request(options, (slackRes) => {
            let data = '';
            
            slackRes.on('data', (chunk) => {
                data += chunk;
            });
            
            slackRes.on('end', () => {
                if (slackRes.statusCode === 200) {
                    console.log('✅ Slack message sent successfully:', text);
                    res.json({ success: true, message: 'Message sent to Slack' });
                } else {
                    console.log('❌ Slack API error:', slackRes.statusCode, data);
                    res.status(slackRes.statusCode).json({ 
                        error: 'Slack API error', 
                        status: slackRes.statusCode,
                        response: data 
                    });
                }
            });
        });

        slackReq.on('error', (error) => {
            console.log('❌ Request error:', error.message);
            res.status(500).json({ error: 'Failed to send message to Slack' });
        });

        slackReq.write(postData);
        slackReq.end();

    } catch (error) {
        console.log('❌ Server error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📤 Slack webhook proxy ready at http://localhost:${PORT}/api/slack-webhook`);
}); 