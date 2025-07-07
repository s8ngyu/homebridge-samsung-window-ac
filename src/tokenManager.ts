import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import type { Logging } from 'homebridge';

interface TokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  installed_app_id: string;
  access_tier: number;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class TokenManager {
  private readonly tokenFilePath: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: number = 0;

  constructor(
    private readonly log: Logging,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly initialRefreshToken: string,
    private readonly storageDir: string
  ) {
    this.tokenFilePath = path.join(this.storageDir, 'tokens.json');
    this.refreshToken = this.initialRefreshToken;
  }

  /**
   * Initialize token manager by loading stored tokens or getting new ones
   */
  async initialize(): Promise<void> {
    try {
      // Try to load stored tokens first
      if (await this.loadStoredTokens()) {
        this.log.debug('Loaded stored tokens');
        
        // Check if access token is still valid (with 5 minute buffer)
        if (Date.now() < this.expiresAt - 5 * 60 * 1000) {
          this.log.debug('Stored access token is still valid');
          return;
        }
      }

      // Get new tokens using the refresh token
      await this.refreshTokens();
    } catch (error) {
      this.log.error('Failed to initialize token manager:', error);
      throw error;
    }
  }

  /**
   * Get current access token, refreshing if necessary
   */
  async getAccessToken(): Promise<string> {
    // Check if we need to refresh the token (with 5 minute buffer)
    if (!this.accessToken || Date.now() >= this.expiresAt - 5 * 60 * 1000) {
      await this.refreshTokens();
    }

    if (!this.accessToken) {
      throw new Error('No access token available');
    }

    return this.accessToken;
  }

  /**
   * Refresh access token using refresh token
   */
  private async refreshTokens(): Promise<void> {
    try {
      this.log.debug('Refreshing tokens...');

      const response = await axios.post<TokenResponse>(
        'https://api.smartthings.com/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          refresh_token: this.refreshToken!,
        }),
        {
          auth: {
            username: this.clientId,
            password: this.clientSecret,
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      this.accessToken = response.data.access_token;
      this.refreshToken = response.data.refresh_token;
      this.expiresAt = Date.now() + response.data.expires_in * 1000;

      this.log.debug('Tokens refreshed successfully');

      // Save tokens to file
      await this.saveStoredTokens();
    } catch (error) {
      this.log.error('Failed to refresh tokens:', error);
      throw error;
    }
  }

  /**
   * Save tokens to file
   */
  private async saveStoredTokens(): Promise<void> {
    try {
      const tokens: StoredTokens = {
        accessToken: this.accessToken!,
        refreshToken: this.refreshToken!,
        expiresAt: this.expiresAt,
      };

      // Ensure storage directory exists
      await fs.promises.mkdir(this.storageDir, { recursive: true });

      await fs.promises.writeFile(
        this.tokenFilePath,
        JSON.stringify(tokens, null, 2),
        'utf8'
      );

      this.log.debug('Tokens saved to file');
    } catch (error) {
      this.log.error('Failed to save tokens:', error);
      // Don't throw error as this is not critical
    }
  }

  /**
   * Load tokens from file
   */
  private async loadStoredTokens(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.tokenFilePath)) {
        return false;
      }

      const data = await fs.promises.readFile(this.tokenFilePath, 'utf8');
      const tokens: StoredTokens = JSON.parse(data);

      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.expiresAt = tokens.expiresAt;

      return true;
    } catch (error) {
      this.log.error('Failed to load stored tokens:', error);
      return false;
    }
  }
} 