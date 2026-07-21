import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import {
    CLIENT_ID as ENV_CLIENT_ID, CLIENT_SECRET as ENV_CLIENT_SECRET, TOKEN_URL, AUTH_URL,
    USERINFO_URL, OAUTH_SCOPES, OAUTH_CALLBACK_TIMEOUT_MS,
    OAUTH_CLIENT_ID_SECRET_KEY, OAUTH_CLIENT_SECRET_SECRET_KEY,
} from '../constants';
import { getOAuthSuccessHtml } from '../templates/oauthSuccess';
import { createLogger } from '../utils/logger';

/** Timeout for Google API HTTP requests (userinfo, token exchange) */
const GOOGLE_API_TIMEOUT_MS = 10_000;
import { collectBody } from '../utils/http';

const log = createLogger('GoogleAuth');

export interface OAuthFlowOptions {
    loginHint?: string;
    usePrivateBrowser?: boolean;
    statusMessage?: string;
}

interface OAuthCredentials {
    clientId: string;
    clientSecret: string;
}

export class GoogleAuthService {
    constructor(private readonly context?: vscode.ExtensionContext) {}

    async setupOAuthCredentialsFromFile(): Promise<boolean> {
        if (!this.context) {
            vscode.window.showErrorMessage('OAuth credential setup is unavailable because extension storage is not initialized.');
            return false;
        }

        const picked = await vscode.window.showOpenDialog({
            title: 'Select Google OAuth client_secret.json',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Google OAuth JSON': ['json'],
                'All files': ['*'],
            },
        });

        const fileUri = picked?.[0];
        if (!fileUri) return false;

        try {
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            const credentials = this.parseOAuthCredentialsJson(Buffer.from(bytes).toString('utf8'));

            await this.context.secrets.store(OAUTH_CLIENT_ID_SECRET_KEY, credentials.clientId);
            await this.context.secrets.store(OAUTH_CLIENT_SECRET_SECRET_KEY, credentials.clientSecret);

            vscode.window.showInformationMessage(
                `Google OAuth credentials saved for ${this.maskClientId(credentials.clientId)}.`
            );
            return true;
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to setup Google OAuth credentials: ${err?.message || err}`);
            return false;
        }
    }

    /** Exchange an authorization code for access + refresh tokens */
    async exchangeCode(code: string, redirectUri: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
        const credentials = await this.getOAuthCredentials();
        const body = new URLSearchParams({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
        }).toString();

        return this.postForm(TOKEN_URL, body);
    }

    /** Refresh an expired access token using the stored refresh token */
    async refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
        const credentials = await this.getOAuthCredentials();
        const body = new URLSearchParams({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }).toString();

        return this.postForm(TOKEN_URL, body);
    }

    /** Fetch Google user profile (email, name) */
    async fetchUserInfo(accessToken: string): Promise<{ email: string; name: string }> {
        return new Promise((resolve, reject) => {
            const req = https.get(USERINFO_URL, {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: GOOGLE_API_TIMEOUT_MS,
            }, async (res) => {
                try {
                    const { status, body } = await collectBody(res);
                    if (status === 200) {
                        resolve(JSON.parse(body));
                    } else {
                        reject(new Error(`UserInfo failed: HTTP ${status}`));
                    }
                } catch (e) { reject(e); }
            });
            req.on('error', reject);
        });
    }

    /**
     * Full OAuth2 flow: open browser → local callback server → capture tokens.
     * Returns the raw token response and user info, or null on cancel/timeout.
     */
    async startOAuthFlow(options: OAuthFlowOptions = {}): Promise<{
        tokens: { access_token: string; refresh_token: string; expires_in: number };
        userInfo: { email: string; name: string };
    } | null> {
        let credentials: OAuthCredentials;
        try {
            credentials = await this.getOAuthCredentials();
        } catch (err: any) {
            vscode.window.showErrorMessage(err?.message || String(err));
            return null;
        }

        return new Promise((resolve) => {
            const port = 19876 + Math.floor(Math.random() * 100);
            const redirectUri = `http://127.0.0.1:${port}/callback`;
            const state = crypto.randomBytes(16).toString('hex');

            const authParams = new URLSearchParams({
                client_id: credentials.clientId,
                redirect_uri: redirectUri,
                response_type: 'code',
                scope: OAUTH_SCOPES.join(' '),
                access_type: 'offline',
                prompt: 'consent',
                include_granted_scopes: 'true',
                state,
            });
            if (options.loginHint) authParams.set('login_hint', options.loginHint);

            const authUrl = `${AUTH_URL}?` + authParams.toString();

            let server: http.Server | null = null;
            const timeout = setTimeout(() => {
                server?.close();
                resolve(null);
            }, OAUTH_CALLBACK_TIMEOUT_MS);

            server = http.createServer(async (req, res) => {
                if (!req.url?.startsWith('/callback')) {
                    res.writeHead(404);
                    res.end();
                    return;
                }

                const parsed = new URL(req.url!, 'http://localhost');
                const code = parsed.searchParams.get('code') ?? '';
                const returnedState = parsed.searchParams.get('state') ?? '';

                if (!code || returnedState !== state) {
                    res.writeHead(400);
                    res.end('Invalid callback. Please try again.');
                    clearTimeout(timeout);
                    server?.close();
                    resolve(null);
                    return;
                }

                try {
                    const tokens = await this.exchangeCode(code, redirectUri);
                    const userInfo = await this.fetchUserInfo(tokens.access_token);

                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(getOAuthSuccessHtml(userInfo.email));

                    clearTimeout(timeout);
                    server?.close();
                    resolve({ tokens, userInfo });
                } catch (err: any) {
                    log.error('OAuth error:', err);
                    res.writeHead(500);
                    res.end('Authentication failed: ' + err.message);
                    clearTimeout(timeout);
                    server?.close();
                    resolve(null);
                }
            });

            server.listen(port, '127.0.0.1', () => {
                if (options.usePrivateBrowser) {
                    const opened = this.openPrivateBrowser(authUrl);
                    if (!opened) {
                        vscode.env.clipboard.writeText(authUrl);
                        vscode.window.showWarningMessage(
                            'Could not find Chrome, Edge, Brave, or Firefox for private login. The OAuth URL was copied; paste it into an incognito/private window.'
                        );
                    }
                } else {
                    vscode.env.openExternal(vscode.Uri.parse(authUrl));
                }
                vscode.window.showInformationMessage(
                    options.statusMessage || 'Browser opened for Google login. Complete the sign-in to add your account.'
                );
            });

            server.on('error', (err) => {
                log.error('Callback server error:', err);
                clearTimeout(timeout);
                resolve(null);
            });
        });
    }

    // --- Private ---

    private async getOAuthCredentials(): Promise<OAuthCredentials> {
        const stored = await this.getStoredOAuthCredentials();
        const cfg = vscode.workspace.getConfiguration('ag-switchboard');
        const clientId = (stored?.clientId || cfg.get<string>('oauthClientId', '') || ENV_CLIENT_ID).trim();
        const clientSecret = (stored?.clientSecret || cfg.get<string>('oauthClientSecret', '') || ENV_CLIENT_SECRET).trim();

        if (!clientId || !clientSecret) {
            throw new Error(
                'Google OAuth credentials are not configured. Run "AG Switchboard: Setup Google OAuth Credentials", set ag-switchboard.oauthClientId and ag-switchboard.oauthClientSecret, or set AG_SWITCHBOARD_GOOGLE_CLIENT_ID and AG_SWITCHBOARD_GOOGLE_CLIENT_SECRET.'
            );
        }

        return { clientId, clientSecret };
    }

    private async getStoredOAuthCredentials(): Promise<OAuthCredentials | null> {
        if (!this.context) return null;

        const clientId = (await this.context.secrets.get(OAUTH_CLIENT_ID_SECRET_KEY))?.trim() || '';
        const clientSecret = (await this.context.secrets.get(OAUTH_CLIENT_SECRET_SECRET_KEY))?.trim() || '';
        if (!clientId || !clientSecret) return null;

        return { clientId, clientSecret };
    }

    private parseOAuthCredentialsJson(content: string): OAuthCredentials {
        let parsed: any;
        try {
            parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
        } catch {
            throw new Error('Selected file is not valid JSON.');
        }

        if (parsed?.web && !parsed?.installed) {
            throw new Error('This looks like a Web application OAuth client. Create a Desktop app client in Google Cloud, then download its JSON file.');
        }

        const source = parsed?.installed || parsed;
        const clientId = typeof source?.client_id === 'string' ? source.client_id.trim() : '';
        const clientSecret = typeof source?.client_secret === 'string' ? source.client_secret.trim() : '';

        if (!clientId || !clientSecret) {
            throw new Error('Could not find client_id and client_secret. Select the Desktop app client_secret.json from Google Cloud.');
        }

        if (!clientId.endsWith('.apps.googleusercontent.com')) {
            throw new Error('client_id does not look like a Google OAuth client ID.');
        }

        return { clientId, clientSecret };
    }

    private maskClientId(clientId: string): string {
        if (clientId.length <= 28) return clientId;
        return `${clientId.slice(0, 10)}...${clientId.slice(-18)}`;
    }

    private privateArgsFor(kind: string, url: string): string[] {
        if (kind === 'edge') return ['--inprivate', '--new-window', url];
        if (kind === 'firefox') return ['--private-window', url];
        return ['--incognito', '--new-window', url];
    }

    private browserAliasToWindowsCandidates(alias: string): string[] {
        const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        const localAppData = process.env.LOCALAPPDATA || '';

        const candidates: Record<string, string[]> = {
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

    private openPrivateBrowser(url: string): boolean {
        const aliases = ['chrome', 'edge', 'brave', 'firefox'];

        if (process.platform === 'win32') {
            for (const alias of aliases) {
                for (const command of this.browserAliasToWindowsCandidates(alias).filter(Boolean)) {
                    if (!existsSync(command)) continue;
                    spawn(command, this.privateArgsFor(alias, url), {
                        detached: true,
                        stdio: 'ignore',
                    }).unref();
                    return true;
                }
            }
            return false;
        }

        const candidates = process.platform === 'darwin'
            ? [
                { command: 'open', args: ['-na', 'Google Chrome', '--args', ...this.privateArgsFor('chrome', url)] },
                { command: 'open', args: ['-na', 'Microsoft Edge', '--args', ...this.privateArgsFor('edge', url)] },
                { command: 'open', args: ['-na', 'Brave Browser', '--args', ...this.privateArgsFor('brave', url)] },
                { command: 'open', args: ['-na', 'Firefox', '--args', ...this.privateArgsFor('firefox', url)] },
            ]
            : [
                { command: 'google-chrome', args: this.privateArgsFor('chrome', url) },
                { command: 'chrome', args: this.privateArgsFor('chrome', url) },
                { command: 'chromium', args: this.privateArgsFor('chrome', url) },
                { command: 'microsoft-edge', args: this.privateArgsFor('edge', url) },
                { command: 'brave-browser', args: this.privateArgsFor('brave', url) },
                { command: 'firefox', args: this.privateArgsFor('firefox', url) },
            ];

        try {
            const first = candidates[0];
            spawn(first.command, first.args, {
                detached: true,
                stdio: 'ignore',
            }).unref();
            return true;
        } catch {
            return false;
        }
    }

    private postForm(endpoint: string, body: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const parsed = new URL(endpoint);
            const req = https.request({
                hostname: parsed.hostname,
                path: parsed.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(body),
                },
                timeout: GOOGLE_API_TIMEOUT_MS,
            }, async (res) => {
                try {
                    const { status, body: data } = await collectBody(res);
                    if (status === 200) {
                        resolve(JSON.parse(data));
                    } else {
                        reject(new Error(`Token request failed: HTTP ${status} — ${data.substring(0, 200)}`));
                    }
                } catch (e) { reject(e); }
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }
}
