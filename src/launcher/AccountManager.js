const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class AccountManager {
  constructor() {
    this.minecraftDir = path.join(os.homedir(), '.minecraft_custom');
    this.accountsFile = path.join(this.minecraftDir, 'accounts.json');
    this.accounts = [];
    this.activeAccountId = null;
    this.init();
  }

  async init() {
    await fs.ensureDir(this.minecraftDir);
    await this.loadAccounts();
  }

  async loadAccounts() {
    try {
      if (await fs.pathExists(this.accountsFile)) {
        const data = await fs.readJson(this.accountsFile);
        this.accounts = data.accounts || [];
        this.activeAccountId = data.activeAccountId || null;
      } else {
        this.accounts = [];
        this.activeAccountId = null;
      }
    } catch (error) {
      console.error('Error loading accounts:', error);
      this.accounts = [];
      this.activeAccountId = null;
    }
  }

  async saveAccounts() {
    try {
      await fs.writeJson(this.accountsFile, {
        accounts: this.accounts,
        activeAccountId: this.activeAccountId
      }, { spaces: 2 });
    } catch (error) {
      console.error('Error saving accounts:', error);
      throw error;
    }
  }

  /**
   * Add a new local account
   */
  async addLocalAccount(username) {
    if (!username || username.length === 0 || username.length > 16) {
      throw new Error('Invalid username length (1-16 characters)');
    }

    // Check if account already exists
    const exists = this.accounts.find(acc =>
      acc.type === 'local' && acc.username.toLowerCase() === username.toLowerCase()
    );

    if (exists) {
      throw new Error('Account with this username already exists');
    }

    const account = {
      id: this.generateId(),
      type: 'local',
      username: username,
      uuid: this.generateUUID(),
      createdAt: new Date().toISOString(),
      lastUsed: null,
      skin: null
    };

    this.accounts.push(account);

    // Set as active if it's the first account
    if (this.accounts.length === 1) {
      this.activeAccountId = account.id;
    }

    await this.saveAccounts();
    return account;
  }

  /**
   * Add a new Ely.by account
   */
  async addElyByAccount(authData) {
    if (!authData || !authData.username || !authData.uuid) {
      throw new Error('Invalid Ely.by auth data');
    }

    // Check if account already exists
    const exists = this.accounts.find(acc =>
      acc.type === 'ely' && acc.uuid === authData.uuid
    );

    if (exists) {
      // Update existing account
      exists.username = authData.username;
      exists.accessToken = authData.accessToken;
      exists.refreshToken = authData.refreshToken;
      exists.expiresAt = authData.expiresAt;
      exists.lastUsed = new Date().toISOString();
      await this.saveAccounts();
      return exists;
    }

    const account = {
      id: this.generateId(),
      type: 'ely',
      username: authData.username,
      uuid: authData.uuid,
      accessToken: authData.accessToken,
      refreshToken: authData.refreshToken,
      expiresAt: authData.expiresAt,
      createdAt: new Date().toISOString(),
      lastUsed: null,
      skin: null
    };

    this.accounts.push(account);

    // Set as active if it's the first account
    if (this.accounts.length === 1) {
      this.activeAccountId = account.id;
    }

    await this.saveAccounts();
    return account;
  }

  /**
   * Remove an account
   */
  async removeAccount(accountId) {
    const index = this.accounts.findIndex(acc => acc.id === accountId);

    if (index === -1) {
      throw new Error('Account not found');
    }

    this.accounts.splice(index, 1);

    // If removed account was active, set another one as active
    if (this.activeAccountId === accountId) {
      this.activeAccountId = this.accounts.length > 0 ? this.accounts[0].id : null;
    }

    await this.saveAccounts();
  }

  /**
   * Set active account
   */
  async setActiveAccount(accountId) {
    const account = this.accounts.find(acc => acc.id === accountId);

    if (!account) {
      throw new Error('Account not found');
    }

    this.activeAccountId = accountId;
    account.lastUsed = new Date().toISOString();
    await this.saveAccounts();
    return account;
  }

  /**
   * Get active account
   */
  getActiveAccount() {
    if (!this.activeAccountId) {
      return null;
    }

    return this.accounts.find(acc => acc.id === this.activeAccountId) || null;
  }

  /**
   * Get all accounts
   */
  getAllAccounts() {
    return this.accounts;
  }

  /**
   * Get account by ID
   */
  getAccount(accountId) {
    return this.accounts.find(acc => acc.id === accountId) || null;
  }

  /**
   * Update account skin
   */
  async updateAccountSkin(accountId, skinData) {
    const account = this.accounts.find(acc => acc.id === accountId);

    if (!account) {
      throw new Error('Account not found');
    }

    account.skin = skinData;
    await this.saveAccounts();
    return account;
  }

  /**
   * Update Ely.by account tokens
   */
  async updateElyByTokens(accountId, tokens) {
    const account = this.accounts.find(acc => acc.id === accountId);

    if (!account || account.type !== 'ely') {
      throw new Error('Ely.by account not found');
    }

    account.accessToken = tokens.accessToken;
    account.refreshToken = tokens.refreshToken;
    account.expiresAt = tokens.expiresAt;
    await this.saveAccounts();
    return account;
  }

  /**
   * Generate random ID
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }

  /**
   * Generate random UUID
   */
  generateUUID() {
    const hex = '0123456789abcdef';
    let uuid = '';
    for (let i = 0; i < 32; i++) {
      uuid += hex[Math.floor(Math.random() * 16)];
      if (i === 7 || i === 11 || i === 15 || i === 19) {
        uuid += '-';
      }
    }
    return uuid;
  }
}

module.exports = AccountManager;
