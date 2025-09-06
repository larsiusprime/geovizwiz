// Test script to debug the Vite proxy configuration
const https = require('https');
const url = require('url');

// Your Slack webhook URL
const SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/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";

// Parse the webhook URL to understand the structure
const webhookUrl = url.parse(SLACK_WEBHOOK_URL);
console.log('🔍 Webhook URL Analysis:');
console.log('Full URL:', SLACK_WEBHOOK_URL);
console.log('Hostname:', webhookUrl.hostname);
console.log('Path:', webhookUrl.path);
console.log('Pathname:', webhookUrl.pathname);
console.log('---');

// Test 1: Direct request to Slack (should work)
function testDirectSlack() {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ text: 'Direct test from Node.js' });
        
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

        console.log('📤 Testing direct Slack request:');
        console.log('Options:', JSON.stringify(options, null, 2));

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log('✅ Direct Slack Response:', res.statusCode, data);
                resolve({ status: res.statusCode, data });
            });
        });

        req.on('error', (error) => {
            console.log('❌ Direct Slack Error:', error.message);
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

// Test 2: Simulate what the Vite proxy should do
function testProxySimulation() {
    return new Promise((resolve, reject) => {
        // Simulate the rewrite: (path) => path.replace('/api/slack', '')
        const originalPath = '/api/slack';
        const rewrittenPath = originalPath.replace('/api/slack', '');
        
        console.log('🔍 Proxy simulation:');
        console.log('Original path:', originalPath);
        console.log('Rewritten path:', rewrittenPath);
        console.log('Target path:', webhookUrl.path);
        
        // This should be equivalent to the direct request
        const postData = JSON.stringify({ text: 'Proxy simulation test' });
        
        const options = {
            hostname: webhookUrl.hostname,
            port: 443,
            path: webhookUrl.path, // Use the original webhook path
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        console.log('📤 Testing proxy simulation:');
        console.log('Options:', JSON.stringify(options, null, 2));

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log('✅ Proxy Simulation Response:', res.statusCode, data);
                resolve({ status: res.statusCode, data });
            });
        });

        req.on('error', (error) => {
            console.log('❌ Proxy Simulation Error:', error.message);
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

async function runTests() {
    console.log('🚀 Starting proxy debugging tests...\n');
    
    try {
        await testDirectSlack();
        console.log('\n---\n');
        await testProxySimulation();
        console.log('\n✅ All tests completed');
    } catch (error) {
        console.log('\n❌ Test failed:', error.message);
    }
}

runTests(); 