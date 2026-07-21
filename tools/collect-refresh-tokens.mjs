#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OAUTH_CLIENT_ID_ENV = 'AG_SWITCHBOARD_GOOGLE_CLIENT_ID';
const OAUTH_CLIENT_SECRET_ENV = 'AG_SWITCHBOARD_GOOGLE_CLIENT_SECRET';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const OAUTH_SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs',
];

function printHelp() {
    console.log(`
AG Switchboard refresh-token collector

Usage:
  npm run collect:tokens -- --input emails.txt --output refresh-tokens.txt
  node tools/collect-refresh-tokens.mjs -i emails.txt -o refresh-tokens.txt

Input file:
  one Google email per line
  blank lines and lines starting with # are ignored

Output file:
  email@example.com|refresh_token

Options:
  -i, --input <file>       email list file
  -o, --output <file>      output token file (default: refresh-tokens.txt)
  --timeout-sec <seconds>  per-account OAuth timeout (default: 300)
  --browser <name|path>    private browser to use: chrome, edge, brave, firefox, or an executable path
  --client-id <id>         Google OAuth client ID (or ${OAUTH_CLIENT_ID_ENV})
  --client-secret <secret> Google OAuth client secret (or ${OAUTH_CLIENT_SECRET_ENV})
  --no-open                print auth URL without opening a browser
  -h, --help               show this help
`);
}

function parseArgs(argv) {
    const options = {
        input: '',
        output: 'refresh-tokens.txt',
        timeoutMs: DEFAULT_TIMEOUT_MS,
        openBrowser: true,
        browser: '',
        clientId: process.env[OAUTH_CLIENT_ID_ENV] || '',
        clientSecret: process.env[OAUTH_CLIENT_SECRET_ENV] || '',
        help: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === '-h' || arg === '--help') {
            options.help = true;
        } else if ((arg === '-i' || arg === '--input') && next) {
            options.input = next;
            i++;
        } else if ((arg === '-o' || arg === '--output') && next) {
            options.output = next;
            i++;
        } else if (arg === '--timeout-sec' && next) {
            const seconds = Number.parseInt(next, 10);
            if (Number.isFinite(seconds) && seconds > 0) {
                options.timeoutMs = seconds * 1000;
            }
            i++;
        } else if (arg === '--no-open') {
            options.openBrowser = false;
        } else if (arg === '--browser' && next) {
            options.browser = next;
            i++;
        } else if (arg === '--client-id' && next) {
            options.clientId = next;
            i++;
        } else if (arg === '--client-secret' && next) {
            options.clientSecret = next;
            i++;
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
    }

    return options;
}

async function readEmailList(filePath) {
    const content = await readFile(filePath, 'utf8');
    const emails = [];
    const seen = new Set();

    for (const line of content.split(/\r?\n/)) {
        const raw = line.trim();
        if (!raw || raw.startsWith('#')) continue;

        const email = raw.split('|')[0].trim();
        const key = email.toLowerCase();
        if (!email || seen.has(key)) continue;

        seen.add(key);
        emails.push(email);
    }

    return emails;
}

async function readExistingOutput(filePath) {
    const existing = new Set();
    if (!existsSync(filePath)) return existing;

    const content = await readFile(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
        const email = line.split('|')[0]?.trim();
        if (email) existing.add(email.toLowerCase());
    }

    return existing;
}

async function appendTokenLine(filePath, email, refreshToken) {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${email}|${refreshToken}\n`, 'utf8');
}

function privateArgsFor(kind, url) {
    if (kind === 'edge') return ['--inprivate', '--new-window', url];
    if (kind === 'firefox') return ['--private-window', url];
    return ['--incognito', '--new-window', url];
}

function inferBrowserKind(value) {
    const lower = value.toLowerCase();
    if (lower.includes('msedge') || lower.includes('edge')) return 'edge';
    if (lower.includes('firefox')) return 'firefox';
    if (lower.includes('brave')) return 'brave';
    return 'chrome';
}

function browserAliasToWindowsCandidates(alias) {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';

    const candidates = {
        chrome: [
            `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
            `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
            localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : '',
        ],
        edge: [
            `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
            `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ],
        brave: [
            `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
            `${programFilesX86}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
            localAppData ? `${localAppData}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe` : '',
        ],
        firefox: [
            `${programFiles}\\Mozilla Firefox\\firefox.exe`,
            `${programFilesX86}\\Mozilla Firefox\\firefox.exe`,
        ],
    };

    return candidates[alias] || [];
}

function windowsPrivateBrowserCandidates(preferredBrowser) {
    const aliases = ['chrome', 'edge', 'brave', 'firefox'];
    if (preferredBrowser) {
        const alias = preferredBrowser.toLowerCase();
        if (aliases.includes(alias)) {
            return browserAliasToWindowsCandidates(alias)
                .filter(Boolean)
                .map(command => ({ command, kind: alias }));
        }
        return [{ command: preferredBrowser, kind: inferBrowserKind(preferredBrowser) }];
    }

    return aliases.flatMap(alias =>
        browserAliasToWindowsCandidates(alias)
            .filter(Boolean)
            .map(command => ({ command, kind: alias }))
    );
}

function unixPrivateBrowserCandidates(preferredBrowser) {
    if (preferredBrowser) {
        const kind = inferBrowserKind(preferredBrowser);
        return [{ command: preferredBrowser, args: privateArgsFor(kind, '') }];
    }

    if (process.platform === 'darwin') {
        return [
            { command: 'open', args: ['-na', 'Google Chrome', '--args', ...privateArgsFor('chrome', '')] },
            { command: 'open', args: ['-na', 'Microsoft Edge', '--args', ...privateArgsFor('edge', '')] },
            { command: 'open', args: ['-na', 'Brave Browser', '--args', ...privateArgsFor('brave', '')] },
            { command: 'open', args: ['-na', 'Firefox', '--args', ...privateArgsFor('firefox', '')] },
        ];
    }

    return [
        { command: 'google-chrome', args: privateArgsFor('chrome', '') },
        { command: 'chrome', args: privateArgsFor('chrome', '') },
        { command: 'chromium', args: privateArgsFor('chrome', '') },
        { command: 'microsoft-edge', args: privateArgsFor('edge', '') },
        { command: 'brave-browser', args: privateArgsFor('brave', '') },
        { command: 'firefox', args: privateArgsFor('firefox', '') },
    ];
}

function openPrivateBrowser(url, preferredBrowser = '') {
    if (process.platform === 'win32') {
        for (const candidate of windowsPrivateBrowserCandidates(preferredBrowser)) {
            if (!existsSync(candidate.command)) continue;

            spawn(candidate.command, privateArgsFor(candidate.kind, url), {
                detached: true,
                stdio: 'ignore',
            }).unref();
            return true;
        }
        return false;
    }

    const [candidate] = unixPrivateBrowserCandidates(preferredBrowser);
    if (!candidate) return false;

    const args = candidate.args.map(arg => arg === '' ? url : arg);
    spawn(candidate.command, args, {
        detached: true,
        stdio: 'ignore',
    }).unref();
    return true;
}

function getOAuthCredentials(options) {
    const clientId = options.clientId.trim();
    const clientSecret = options.clientSecret.trim();

    if (!clientId || !clientSecret) {
        throw new Error(`Google OAuth credentials are not configured. Set ${OAUTH_CLIENT_ID_ENV} and ${OAUTH_CLIENT_SECRET_ENV}, or pass --client-id and --client-secret.`);
    }

    return { clientId, clientSecret };
}

function buildAuthUrl(redirectUri, state, email, credentials) {
    const params = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
    });

    if (email) params.set('login_hint', email);
    return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code, redirectUri, credentials) {
    const body = new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
    });

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const text = await res.text();

    if (!res.ok) {
        throw new Error(`Token request failed: HTTP ${res.status} - ${text.slice(0, 200)}`);
    }

    const tokens = JSON.parse(text);
    if (!tokens.refresh_token) {
        throw new Error('Google did not return a refresh_token. Remove the previous grant for this app, then try again.');
    }

    return tokens;
}

async function fetchUserInfo(accessToken) {
    const res = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const text = await res.text();

    if (!res.ok) {
        throw new Error(`UserInfo failed: HTTP ${res.status} - ${text.slice(0, 200)}`);
    }

    return JSON.parse(text);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sendHtml(res, status, title, body) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;line-height:1.5">
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<p>You can close this tab and return to the terminal.</p>
</body>
</html>`);
}

async function collectForEmail(expectedEmail, options) {
    return new Promise((resolveResult) => {
        const credentials = getOAuthCredentials(options);
        const state = crypto.randomBytes(16).toString('hex');
        let server = null;
        let settled = false;
        let redirectUri = '';

        function finish(result) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            server?.close();
            resolveResult(result);
        }

        const timeout = setTimeout(() => {
            finish({ ok: false, email: expectedEmail, error: 'OAuth timed out' });
        }, options.timeoutMs);

        server = http.createServer(async (req, res) => {
            if (!req.url?.startsWith('/callback')) {
                res.writeHead(404);
                res.end();
                return;
            }

            const callbackUrl = new URL(req.url, 'http://127.0.0.1');
            const code = callbackUrl.searchParams.get('code') || '';
            const returnedState = callbackUrl.searchParams.get('state') || '';
            const oauthError = callbackUrl.searchParams.get('error') || '';

            if (oauthError) {
                sendHtml(res, 400, 'Authorization cancelled', oauthError);
                finish({ ok: false, email: expectedEmail, error: oauthError });
                return;
            }

            if (!code || returnedState !== state) {
                sendHtml(res, 400, 'Invalid callback', 'The OAuth callback did not match this collector session.');
                finish({ ok: false, email: expectedEmail, error: 'Invalid OAuth callback' });
                return;
            }

            try {
                const tokens = await exchangeCode(code, redirectUri, credentials);
                const userInfo = await fetchUserInfo(tokens.access_token);
                const actualEmail = userInfo.email || '';

                if (expectedEmail && actualEmail.toLowerCase() !== expectedEmail.toLowerCase()) {
                    throw new Error(`Browser returned ${actualEmail}, expected ${expectedEmail}`);
                }

                sendHtml(res, 200, 'Token collected', `Refresh token collected for ${actualEmail}.`);
                finish({ ok: true, email: actualEmail, refreshToken: tokens.refresh_token });
            } catch (err) {
                sendHtml(res, 500, 'Token collection failed', err?.message || String(err));
                finish({ ok: false, email: expectedEmail, error: err?.message || String(err) });
            }
        });

        server.on('error', (err) => {
            finish({ ok: false, email: expectedEmail, error: err?.message || String(err) });
        });

        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            redirectUri = `http://127.0.0.1:${port}/callback`;

            const authUrl = buildAuthUrl(redirectUri, state, expectedEmail, credentials);
            console.log(`\n[${expectedEmail}] Open this Google authorization URL:`);
            console.log(authUrl);

            if (options.openBrowser) {
                const opened = openPrivateBrowser(authUrl, options.browser);
                if (opened) {
                    console.log('Incognito/private browser opened. Complete the Google consent screen there.');
                } else {
                    console.log('Could not find a supported incognito/private browser automatically.');
                    console.log('Copy the URL above into a new incognito/private window.');
                }
            }
        });
    });
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    if (!options.input) {
        printHelp();
        process.exitCode = 1;
        return;
    }

    getOAuthCredentials(options);

    const inputPath = resolve(options.input);
    const outputPath = resolve(options.output);
    const emails = await readEmailList(inputPath);
    const existing = await readExistingOutput(outputPath);

    if (emails.length === 0) {
        console.log('No emails found in input file.');
        return;
    }

    console.log(`Loaded ${emails.length} email(s). Output: ${outputPath}`);
    console.log('This collector never asks for or stores Google passwords.');
    console.log('Browser sessions are opened in incognito/private mode by default.');

    const summary = { success: 0, skipped: 0, failed: 0 };
    for (const email of emails) {
        if (existing.has(email.toLowerCase())) {
            console.log(`[skip] ${email} already exists in output file.`);
            summary.skipped++;
            continue;
        }

        const result = await collectForEmail(email, options);
        if (result.ok) {
            await appendTokenLine(outputPath, result.email, result.refreshToken);
            existing.add(result.email.toLowerCase());
            summary.success++;
            console.log(`[ok] ${result.email} saved.`);
        } else {
            summary.failed++;
            console.log(`[fail] ${email}: ${result.error}`);
        }
    }

    console.log(`\nDone. success=${summary.success} skipped=${summary.skipped} failed=${summary.failed}`);
    console.log(`Import this file in AG Switchboard: ${outputPath}`);
}

main().catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
});
