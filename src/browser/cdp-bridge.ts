import { chromium } from 'playwright';

export interface LoginRecipe {
  loginUrl: string;
  emailSelector: string;
  passwordSelector: string;
  submitSelector: string;
  postLoginCheck?: string;
}

export interface LoginResult {
  success: boolean;
  pageTitle: string;
  currentUrl: string;
  message: string;
}

function sanitize(message: string, secrets: string[]): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret) {
      while (sanitized.includes(secret)) {
        sanitized = sanitized.replace(secret, '***');
      }
    }
  }
  return sanitized;
}

export class CdpBridge {
  async performLogin(recipe: LoginRecipe, email: string, password: string): Promise<LoginResult> {
    const cdpUrl = process.env['VAULT_CDP_URL'] ?? 'http://localhost:9222';
    const secrets = [password, email];
    let browser;

    try {
      try {
        browser = await chromium.connectOverCDP(cdpUrl);
      } catch {
        return {
          success: false,
          pageTitle: '',
          currentUrl: '',
          message: 'Cannot connect to Chrome. Start Chrome with --remote-debugging-port=9222',
        };
      }

      const context = browser.contexts()[0] ?? await browser.newContext();
      const page = await context.newPage();

      try {
        await page.goto(recipe.loginUrl, { waitUntil: 'load', timeout: 15_000 });
      } catch {
        return {
          success: false,
          pageTitle: '',
          currentUrl: recipe.loginUrl,
          message: 'Login timed out after 15s',
        };
      }

      try {
        await page.locator(recipe.emailSelector).fill(email);
      } catch {
        return {
          success: false,
          pageTitle: '',
          currentUrl: page.url(),
          message: `Selector not found: emailSelector`,
        };
      }

      try {
        await page.locator(recipe.passwordSelector).fill(password);
      } catch {
        return {
          success: false,
          pageTitle: '',
          currentUrl: page.url(),
          message: `Selector not found: passwordSelector`,
        };
      }

      try {
        await page.locator(recipe.submitSelector).click();
      } catch {
        return {
          success: false,
          pageTitle: '',
          currentUrl: page.url(),
          message: `Selector not found: submitSelector`,
        };
      }

      try {
        await page.waitForLoadState('networkidle', { timeout: 15_000 });
      } catch {
        return {
          success: false,
          pageTitle: await page.title().catch(() => ''),
          currentUrl: page.url(),
          message: 'Login timed out after 15s',
        };
      }

      if (recipe.postLoginCheck) {
        try {
          const found =
            (await page.locator(recipe.postLoginCheck).first().isVisible({ timeout: 5_000 }).catch(() => false)) ||
            (await page.getByText(recipe.postLoginCheck).first().isVisible({ timeout: 5_000 }).catch(() => false));
          if (!found) {
            return {
              success: false,
              pageTitle: await page.title().catch(() => ''),
              currentUrl: page.url(),
              message: 'Post-login check failed',
            };
          }
        } catch {
          return {
            success: false,
            pageTitle: await page.title().catch(() => ''),
            currentUrl: page.url(),
            message: 'Post-login check failed',
          };
        }
      }

      try {
        await page.locator(recipe.passwordSelector).evaluate((el) => {
          (el as HTMLInputElement).value = '';
        });
      } catch {
        // Field may not exist after navigation — safe to ignore
      }

      const pageTitle = await page.title().catch(() => '');
      const currentUrl = page.url();

      return {
        success: true,
        pageTitle,
        currentUrl,
        message: 'Login successful',
      };
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        pageTitle: '',
        currentUrl: '',
        message: sanitize(raw, secrets),
      };
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}
