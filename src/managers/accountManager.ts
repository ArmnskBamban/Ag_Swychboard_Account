import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { TrackedAccount, StoredTokens, AccountQuota } from '../types';
import { SECRETS_PREFIX, ACCOUNTS_LIST_KEY, TOKEN_REFRESH_BUFFER_SECS } from '../constants';
import { GoogleAuthService } from '../services/googleAuth';
import { QuotaApiService } from '../services/quotaApi';
import { createLogger } from '../utils/logger';

const log = createLogger('AccountManager');

interface BulkTokenImportEntry {
    lineNo: number;
    expectedEmail?: string;
    refreshToken: string;
}

interface BulkEmailCollectEntry {
    lineNo: number;
    email: string;
}

interface BulkTokenImportFailure {
    lineNo: number;
    label: string;
    error: string;
}

export interface BulkTokenImportResult {
    total: number;
    added: number;
    updated: number;
    failed: number;
    failures: BulkTokenImportFailure[];
}

export interface BulkAccountCollectResult {
    total: number;
    added: number;
    updated: number;
    failed: number;
    failures: BulkTokenImportFailure[];
}

export class AccountManager {
    private accounts: TrackedAccount[] = [];
    private quotaCache = new Map<string, AccountQuota>();

    private _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;

    private readonly authService: GoogleAuthService;
    private readonly quotaApi = new QuotaApiService();

    constructor(private readonly context: vscode.ExtensionContext) {
        this.authService = new GoogleAuthService(context);
    }

    getAuthService(): GoogleAuthService { return this.authService; }

    // --- Lifecycle ---

    async initialize(): Promise<void> {
        this.accounts = this.context.globalState.get<TrackedAccount[]>(ACCOUNTS_LIST_KEY, []);
    }

    // --- Account CRUD ---

    getAccounts(): TrackedAccount[] {
        return [...this.accounts];
    }

    getQuotaCache(): Map<string, AccountQuota> {
        return this.quotaCache;
    }

    async addAccount(): Promise<boolean> {
        const result = await this.authService.startOAuthFlow();
        if (!result) return false;

        const { tokens, userInfo } = result;
        await this.upsertAccount(userInfo.email, userInfo.name, tokens);
        return true;
    }

    async removeAccount(accountId: string): Promise<void> {
        const account = this.accounts.find(a => a.id === accountId);
        if (!account) return;

        await this.context.secrets.delete(SECRETS_PREFIX + account.email);
        this.accounts = this.accounts.filter(a => a.id !== accountId);
        await this.context.globalState.update(ACCOUNTS_LIST_KEY, this.accounts);
        this.quotaCache.delete(accountId);
        this._onDidChange.fire();
    }

    // --- Quota Fetching ---

    /** Refresh quota for ALL tracked accounts in parallel */
    async refreshAllQuotas(): Promise<AccountQuota[]> {
        const results = await Promise.allSettled(
            this.accounts.map(account => this.refreshSingleQuota(account))
        );

        const quotas: AccountQuota[] = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled') {
                quotas.push(result.value);
            } else {
                quotas.push({
                    account: this.accounts[i],
                    models: [],
                    tier: null,
                    tierName: null,
                    isForbidden: false,
                    isError: true,
                    errorMessage: result.reason?.message || 'Unknown error',
                    lastUpdated: Date.now(),
                });
            }
        }

        return quotas;
    }

    /** Get valid (auto-refreshed if needed) tokens for a tracked account */
    async getValidTokensForAccount(email: string, forceRefresh = false): Promise<StoredTokens | null> {
        try {
            return await this.getValidTokens(email, forceRefresh);
        } catch { // EXPECTED: token refresh failed — caller handles null return
            return null;
        }
    }

    // --- Private ---

    private async refreshSingleQuota(account: TrackedAccount): Promise<AccountQuota> {
        const tokens = await this.getValidTokens(account.email);
        const result = await this.quotaApi.fetchRemoteQuota(tokens.access_token);

        const quota: AccountQuota = {
            account,
            models: result.models,
            tier: result.tier,
            tierName: result.tierName,
            isForbidden: result.isForbidden,
            isError: result.isError,
            errorMessage: result.errorMessage,
            lastUpdated: Date.now(),
        };

        this.quotaCache.set(account.id, quota);
        return quota;
    }

    private async getValidTokens(email: string, forceRefresh = false): Promise<StoredTokens> {
        const json = await this.context.secrets.get(SECRETS_PREFIX + email);
        if (!json) throw new Error(`No tokens found for ${email}`);

        let tokens: StoredTokens;
        try {
            tokens = JSON.parse(json);
        } catch { /* expected: token refresh can fail for revoked accounts */
            throw new Error(`Corrupted token data for ${email}`);
        }

        // Auto-refresh if expired (with buffer) or if force-refresh requested (e.g. switch)
        if (forceRefresh || Date.now() / 1000 > tokens.expiry_timestamp - TOKEN_REFRESH_BUFFER_SECS) {
            const refreshed = await this.authService.refreshAccessToken(tokens.refresh_token);
            const updated: StoredTokens = {
                access_token: refreshed.access_token,
                // Google may rotate refresh_token — always prefer new one if returned
                refresh_token: refreshed.refresh_token || tokens.refresh_token,
                expiry_timestamp: Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600),
            };
            await this.context.secrets.store(SECRETS_PREFIX + email, JSON.stringify(updated));
            return updated;
        }

        return tokens;
    }

    private async storeTokens(email: string, tokens: { access_token: string; refresh_token: string; expires_in: number }): Promise<void> {
        const stored: StoredTokens = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_timestamp: Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
        };
        await this.context.secrets.store(SECRETS_PREFIX + email, JSON.stringify(stored));
    }

    // --- Token Login & Export ---

    /** Add account by pasting a refresh token (no browser OAuth flow needed) */
    async addAccountByToken(): Promise<boolean> {
        const refreshToken = await vscode.window.showInputBox({
            title: '🔑 Add Account via Token',
            prompt: 'Paste the refresh token to add an account',
            placeHolder: '1//0e...',
            password: true,
            ignoreFocusOut: true,
        });

        if (!refreshToken?.trim()) return false;

        const token = refreshToken.trim();

        try {
            // 1. Exchange refresh_token → access_token
            const refreshResult = await this.authService.refreshAccessToken(token);

            // 2. Fetch user identity
            const userInfo = await this.authService.fetchUserInfo(refreshResult.access_token);

            // 3. Upsert account (DRY — shared with addAccount)
            const tokens = {
                access_token: refreshResult.access_token,
                refresh_token: token,
                expires_in: refreshResult.expires_in || 3600,
            };
            await this.upsertAccount(userInfo.email, userInfo.name, tokens);
            return true;
        } catch (err: any) {
            vscode.window.showErrorMessage(`❌ Token login failed: ${err.message || err}`);
            return false;
        }
    }

    /**
     * Bulk import accounts from a token file.
     * Supported lines:
     *   refresh_token
     *   email@example.com|refresh_token
     *
     * Blank lines and lines starting with # are ignored.
     */
    async importAccountsByTokenFile(): Promise<BulkTokenImportResult | null> {
        const picked = await vscode.window.showOpenDialog({
            title: 'Import Antigravity accounts from refresh token file',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Token files': ['txt', 'csv'],
                'All files': ['*'],
            },
        });

        const fileUri = picked?.[0];
        if (!fileUri) return null;

        let entries: BulkTokenImportEntry[];
        try {
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            entries = this.parseTokenImportFile(Buffer.from(bytes).toString('utf8'));
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to read token file: ${err?.message || err}`);
            return null;
        }

        if (entries.length === 0) {
            vscode.window.showWarningMessage('No refresh tokens found. Use one token per line, or email|refresh_token.');
            return { total: 0, added: 0, updated: 0, failed: 0, failures: [] };
        }

        const result: BulkTokenImportResult = {
            total: entries.length,
            added: 0,
            updated: 0,
            failed: 0,
            failures: [],
        };

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Importing ${entries.length} Antigravity account${entries.length === 1 ? '' : 's'}`,
            cancellable: false,
        }, async (progress) => {
            const increment = 100 / entries.length;
            for (const entry of entries) {
                progress.report({ increment, message: `Line ${entry.lineNo}` });
                try {
                    const refreshResult = await this.authService.refreshAccessToken(entry.refreshToken);
                    const userInfo = await this.authService.fetchUserInfo(refreshResult.access_token);

                    if (
                        entry.expectedEmail &&
                        userInfo.email.toLowerCase() !== entry.expectedEmail.toLowerCase()
                    ) {
                        throw new Error(`Token belongs to ${userInfo.email}, expected ${entry.expectedEmail}`);
                    }

                    const action = await this.upsertAccount(userInfo.email, userInfo.name, {
                        access_token: refreshResult.access_token,
                        refresh_token: entry.refreshToken,
                        expires_in: refreshResult.expires_in || 3600,
                    }, { silent: true, fireChange: false });

                    if (action === 'added') result.added++;
                    else result.updated++;
                } catch (err: any) {
                    result.failed++;
                    result.failures.push({
                        lineNo: entry.lineNo,
                        label: entry.expectedEmail || `line ${entry.lineNo}`,
                        error: err?.message || String(err),
                    });
                }
            }
        });

        if (result.added > 0 || result.updated > 0) {
            this._onDidChange.fire();
        }

        this.logBulkImportResult(result);
        await this.showBulkImportSummary(result);
        return result;
    }

    /**
     * Collect refresh tokens through the official Google OAuth flow, then store
     * the accounts directly. The selected file should contain one email per line.
     */
    async collectAccountsFromEmailFile(): Promise<BulkAccountCollectResult | null> {
        const picked = await vscode.window.showOpenDialog({
            title: 'Collect Antigravity accounts from email list',
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Email lists': ['txt', 'csv'],
                'All files': ['*'],
            },
        });

        const fileUri = picked?.[0];
        if (!fileUri) return null;

        let entries: BulkEmailCollectEntry[];
        try {
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            entries = this.parseEmailCollectFile(Buffer.from(bytes).toString('utf8'));
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to read email list: ${err?.message || err}`);
            return null;
        }

        if (entries.length === 0) {
            vscode.window.showWarningMessage('No emails found. Use one email per line.');
            return { total: 0, added: 0, updated: 0, failed: 0, failures: [] };
        }

        const confirm = await vscode.window.showInformationMessage(
            `Collect ${entries.length} account${entries.length === 1 ? '' : 's'} with Google OAuth? An incognito/private browser window will open for each email.`,
            { modal: true },
            'Start Collection',
        );
        if (confirm !== 'Start Collection') return null;

        const result: BulkAccountCollectResult = {
            total: entries.length,
            added: 0,
            updated: 0,
            failed: 0,
            failures: [],
        };

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Collecting ${entries.length} Antigravity account${entries.length === 1 ? '' : 's'}`,
            cancellable: false,
        }, async (progress) => {
            const increment = 100 / entries.length;
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                progress.report({ message: `${entry.email} (${i + 1}/${entries.length})` });

                try {
                    const authResult = await this.authService.startOAuthFlow({
                        loginHint: entry.email,
                        usePrivateBrowser: true,
                        statusMessage: `Incognito/private browser opened for ${entry.email}. Complete the Google sign-in and consent screen.`,
                    });
                    if (!authResult) {
                        throw new Error('OAuth was cancelled or timed out');
                    }

                    const actualEmail = authResult.userInfo.email;
                    if (actualEmail.toLowerCase() !== entry.email.toLowerCase()) {
                        throw new Error(`Browser returned ${actualEmail}, expected ${entry.email}`);
                    }

                    if (!authResult.tokens.refresh_token) {
                        throw new Error('Google did not return a refresh token. Remove the previous grant for this app, then try again.');
                    }

                    const action = await this.upsertAccount(actualEmail, authResult.userInfo.name, authResult.tokens, {
                        silent: true,
                        fireChange: false,
                    });

                    if (action === 'added') result.added++;
                    else result.updated++;
                } catch (err: any) {
                    result.failed++;
                    result.failures.push({
                        lineNo: entry.lineNo,
                        label: entry.email,
                        error: err?.message || String(err),
                    });
                } finally {
                    progress.report({ increment });
                }
            }
        });

        if (result.added > 0 || result.updated > 0) {
            this._onDidChange.fire();
        }

        this.logBulkCollectResult(result);
        await this.showBulkCollectSummary(result);
        return result;
    }

    /** Get refresh token for an account (for clipboard copy / sharing) */
    async getRefreshToken(accountId: string): Promise<string | null> {
        const account = this.accounts.find(a => a.id === accountId);
        if (!account) return null;

        const json = await this.context.secrets.get(SECRETS_PREFIX + account.email);
        if (!json) return null;

        try {
            const tokens: StoredTokens = JSON.parse(json);
            return tokens.refresh_token;
        } catch { /* expected: token retrieval may fail for expired accounts */
            log.warn(`Corrupted token data for ${account.email}`);
            return null;
        }
    }

    // --- DRY Helpers ---

    /**
     * Create or update an account with fresh tokens.
     * Shared by addAccount (OAuth flow) and addAccountByToken (paste flow).
     */
    private async upsertAccount(
        email: string,
        name: string | undefined,
        tokens: { access_token: string; refresh_token: string; expires_in: number },
        options: { silent?: boolean; fireChange?: boolean } = {},
    ): Promise<'added' | 'updated'> {
        const { silent = false, fireChange = true } = options;
        const existing = this.accounts.find(a => a.email.toLowerCase() === email.toLowerCase());

        if (existing) {
            await this.storeTokens(existing.email, tokens);
            if (silent) {
                if (fireChange) this._onDidChange.fire();
                return 'updated';
            }
            vscode.window.showInformationMessage(`✅ Token refreshed for ${email}`);
            if (fireChange) this._onDidChange.fire();
            return 'updated';
        } else {
            const account: TrackedAccount = {
                id: crypto.randomBytes(8).toString('hex'),
                email,
                name: name || email,
                addedAt: Date.now(),
            };
            this.accounts.push(account);
            await this.context.globalState.update(ACCOUNTS_LIST_KEY, this.accounts);
            await this.storeTokens(account.email, tokens);
            if (silent) {
                if (fireChange) this._onDidChange.fire();
                return 'added';
            }
            vscode.window.showInformationMessage(`✅ Account added: ${email}`);
            if (fireChange) this._onDidChange.fire();
            return 'added';
        }
    }

    private parseTokenImportFile(content: string): BulkTokenImportEntry[] {
        const entries: BulkTokenImportEntry[] = [];
        const seenTokens = new Set<string>();

        content.split(/\r?\n/).forEach((line, index) => {
            const rawLine = line.trim();
            if (!rawLine || rawLine.startsWith('#')) return;

            const parts = rawLine.split('|').map(p => p.trim()).filter(Boolean);
            if (parts.length === 0) return;

            const refreshToken = parts.length === 1 ? parts[0] : parts[parts.length - 1];
            if (!refreshToken || seenTokens.has(refreshToken)) return;
            seenTokens.add(refreshToken);

            entries.push({
                lineNo: index + 1,
                expectedEmail: parts.length > 1 && parts[0].includes('@') ? parts[0] : undefined,
                refreshToken,
            });
        });

        return entries;
    }

    private parseEmailCollectFile(content: string): BulkEmailCollectEntry[] {
        const entries: BulkEmailCollectEntry[] = [];
        const seenEmails = new Set<string>();

        content.split(/\r?\n/).forEach((line, index) => {
            const rawLine = line.trim();
            if (!rawLine || rawLine.startsWith('#')) return;

            const email = rawLine.split(/[|,;]/)[0].trim();
            const key = email.toLowerCase();
            if (!this.isLikelyEmail(email) || seenEmails.has(key)) return;

            seenEmails.add(key);
            entries.push({
                lineNo: index + 1,
                email,
            });
        });

        return entries;
    }

    private isLikelyEmail(value: string): boolean {
        return /^[^\s@|,;]+@[^\s@|,;]+\.[^\s@|,;]+$/.test(value);
    }

    private logBulkImportResult(result: BulkTokenImportResult): void {
        log.info(`Bulk token import: total=${result.total} added=${result.added} updated=${result.updated} failed=${result.failed}`);
        for (const failure of result.failures) {
            log.warn(`Bulk token import failed line ${failure.lineNo} (${failure.label}): ${failure.error}`);
        }
    }

    private logBulkCollectResult(result: BulkAccountCollectResult): void {
        log.info(`Bulk OAuth collection: total=${result.total} added=${result.added} updated=${result.updated} failed=${result.failed}`);
        for (const failure of result.failures) {
            log.warn(`Bulk OAuth collection failed line ${failure.lineNo} (${failure.label}): ${failure.error}`);
        }
    }

    private async showBulkImportSummary(result: BulkTokenImportResult): Promise<void> {
        const summary = `Imported ${result.added + result.updated}/${result.total} accounts (${result.added} new, ${result.updated} refreshed, ${result.failed} failed).`;

        if (result.failed === 0) {
            vscode.window.showInformationMessage(summary);
            return;
        }

        const action = await vscode.window.showWarningMessage(
            `${summary} Failure details were logged to the AG Panel output.`,
            'Copy Failure Report',
        );
        if (action === 'Copy Failure Report') {
            const report = result.failures
                .map(f => `Line ${f.lineNo} | ${f.label} | ${f.error}`)
                .join('\n');
            await vscode.env.clipboard.writeText(report);
        }
    }

    private async showBulkCollectSummary(result: BulkAccountCollectResult): Promise<void> {
        const summary = `Collected ${result.added + result.updated}/${result.total} accounts (${result.added} new, ${result.updated} refreshed, ${result.failed} failed).`;

        if (result.failed === 0) {
            vscode.window.showInformationMessage(summary);
            return;
        }

        const action = await vscode.window.showWarningMessage(
            `${summary} Failure details were logged to the AG Panel output.`,
            'Copy Failure Report',
        );
        if (action === 'Copy Failure Report') {
            const report = result.failures
                .map(f => `Line ${f.lineNo} | ${f.label} | ${f.error}`)
                .join('\n');
            await vscode.env.clipboard.writeText(report);
        }
    }
}
