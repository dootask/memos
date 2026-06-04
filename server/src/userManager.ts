import type { AppConfig } from './config.js';
import type { DooTaskUser } from './dootaskClient.js';
import type { Logger } from './logger.js';
import { MemosClient, SignInResult } from './memosClient.js';
import { derivePassword } from './session.js';

// DooTask system_theme -> Memos theme (CSS in web/public/themes).
const THEME_MAP: Record<string, string> = {
  light: 'default',
  dark: 'default-dark',
};

// Memos theme -> background color (from web/src/utils/theme.ts), for the splash.
const THEME_BG: Record<string, string> = {
  default: '#faf9f5',
  'default-dark': '#1d1f23',
  paper: '#f5ede4',
};

// DooTask system_lang -> Memos locale code.
const LOCALE_MAP: Record<string, string> = {
  zh: 'zh-Hans',
  'zh-cht': 'zh-Hant',
  en: 'en',
  ko: 'ko',
  ja: 'ja',
  de: 'de',
  fr: 'fr',
  id: 'id',
  ru: 'ru',
};

/**
 * Maps DooTask identities onto Memos accounts: lazily creating users, keeping
 * admin roles in sync with the configured DooTask admin id list, and signing
 * users in with their deterministic password.
 */
export class UserManager {
  private adminToken: string | null = null;

  constructor(
    private readonly memos: MemosClient,
    private readonly cfg: AppConfig,
    private readonly logger: Logger,
  ) {}

  usernameFor(dootaskUserId: number): string {
    return `${this.cfg.usernamePrefix}${dootaskUserId}`;
  }

  passwordFor(dootaskUserId: number): string {
    return derivePassword(dootaskUserId, this.cfg.internalSecret);
  }

  isAdmin(dootaskUserId: number): boolean {
    return this.cfg.adminUserIds.includes(dootaskUserId);
  }

  /** Sign in (creating the account first if needed) and return Memos tokens. */
  async ensureSignedIn(user: DooTaskUser): Promise<SignInResult> {
    const username = this.usernameFor(user.userid);
    const password = this.passwordFor(user.userid);

    let result = await this.memos.signIn(username, password);
    if (!result) {
      // First time we see this user (or password drift) — create then retry.
      await this.memos.createUser({
        username,
        password,
        displayName: user.nickname,
        email: user.email,
      });
      result = await this.memos.signIn(username, password);
    }
    if (!result) {
      // Account exists with a different password (e.g. created out-of-band).
      // Reset it via admin and retry once.
      const admin = await this.getAdminToken();
      if (admin) {
        await this.memos.updateUser(username, { password }, admin);
        result = await this.memos.signIn(username, password);
      }
    }
    if (!result) {
      throw new Error(`unable to sign in memos user ${username}`);
    }

    await this.reconcile(user, result);
    return result;
  }

  /**
   * Push DooTask's current theme & language onto the Memos account (authoritative
   * — applied on every SSO entry). `themeRaw`/`langRaw` come from the iframe URL
   * (`{system_theme}` / `{system_lang}`). Unknown values are skipped.
   */
  async applyPreferences(username: string, token: string, themeRaw?: string, langRaw?: string): Promise<void> {
    const { theme, locale } = this.mapPreferences(themeRaw, langRaw);
    const fields: { locale?: string; theme?: string } = {};
    if (theme) fields.theme = theme;
    if (locale) fields.locale = locale;
    if (Object.keys(fields).length === 0) return;
    await this.memos.updateGeneralSetting(username, fields, token);
  }

  /** Map DooTask theme/lang to Memos theme, locale and a splash background. */
  mapPreferences(themeRaw?: string, langRaw?: string): { theme?: string; locale?: string; bg: string } {
    const theme = THEME_MAP[(themeRaw || '').toLowerCase()];
    const locale = LOCALE_MAP[(langRaw || '').toLowerCase()];
    return { theme, locale, bg: THEME_BG[theme || 'default'] };
  }

  /** Keep role / profile aligned with DooTask after a successful sign-in. */
  private async reconcile(user: DooTaskUser, result: SignInResult): Promise<void> {
    const username = this.usernameFor(user.userid);
    const wantAdmin = this.isAdmin(user.userid);
    const isAdmin = result.user.role === 'ADMIN' || result.user.role === 'HOST';

    const patch: Record<string, string> = {};
    if (wantAdmin && !isAdmin) patch.role = 'ADMIN';
    if (!wantAdmin && result.user.role === 'ADMIN') patch.role = 'USER';
    if (user.nickname && user.nickname !== result.user.displayName) patch.displayName = user.nickname;
    if (user.email && user.email !== result.user.email) patch.email = user.email;
    if (Object.keys(patch).length === 0) return;

    const admin = await this.getAdminToken();
    if (!admin) {
      this.logger.warn({ username }, 'no admin token available to reconcile user');
      return;
    }
    await this.memos.updateUser(username, patch, admin);
  }

  /**
   * Set the Memos avatar to a data URI (Memos rejects plain URLs). Isolated from
   * profile reconciliation so a bad avatar never blocks name/role sync.
   */
  async setAvatar(username: string, dataUri: string): Promise<void> {
    const admin = await this.getAdminToken();
    if (!admin) return;
    await this.memos.updateUser(username, { avatarUrl: dataUri }, admin);
  }

  /** Obtain (and cache) a bearer token for an admin account. */
  private async getAdminToken(): Promise<string | null> {
    if (this.adminToken) return this.adminToken;
    for (const adminId of this.cfg.adminUserIds) {
      const r = await this.memos.signIn(this.usernameFor(adminId), this.passwordFor(adminId));
      if (r && (r.user.role === 'ADMIN' || r.user.role === 'HOST')) {
        this.adminToken = r.accessToken;
        return this.adminToken;
      }
    }
    return null;
  }

  /**
   * Seed admin accounts at startup so the instance is initialized with the right
   * admins before any regular user logs in. Best-effort: failures are logged,
   * not fatal (Memos may not be ready yet on first boot).
   */
  async seedAdmins(): Promise<void> {
    if (this.cfg.adminUserIds.length === 0) {
      this.logger.info('no admin user ids configured; skipping admin seeding');
      return;
    }

    let profile;
    try {
      profile = await this.memos.getInstanceProfile();
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'memos not reachable yet; deferring seeding');
      return;
    }

    // Initialize the instance with the first admin so it owns the ADMIN role.
    if (!profile.admin) {
      const firstId = this.cfg.adminUserIds[0];
      const created = await this.memos.createUser({
        username: this.usernameFor(firstId),
        password: this.passwordFor(firstId),
        displayName: `DooTask Admin ${firstId}`,
      });
      this.logger.info({ firstId, created: Boolean(created) }, 'seeded primary memos admin');
    }

    const adminToken = await this.getAdminToken();
    if (!adminToken) {
      this.logger.warn('could not obtain admin token during seeding');
      return;
    }

    // Ensure every configured admin exists and holds the ADMIN role.
    for (const adminId of this.cfg.adminUserIds) {
      const username = this.usernameFor(adminId);
      const password = this.passwordFor(adminId);
      let memUser = await this.memos.getUser(username, adminToken);
      if (!memUser) {
        await this.memos.createUser({ username, password, displayName: `DooTask Admin ${adminId}` });
        memUser = await this.memos.getUser(username, adminToken);
      }
      if (memUser && memUser.role !== 'ADMIN' && memUser.role !== 'HOST') {
        await this.memos.updateUser(username, { role: 'ADMIN' }, adminToken);
      }
    }
    this.logger.info({ admins: this.cfg.adminUserIds }, 'admin seeding complete');
  }
}
