const axios = require('axios');
const { BrowserWindow } = require('electron');
const url = require('url');

class ElyByAuth {
  constructor() {
    this.clientId = null;
    this.clientSecret = null;
    this.authUrl = 'https://account.ely.by/oauth2/v1';
    this.apiUrl = 'https://account.ely.by/api';
    this.redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
    this.authlibMetaUrl = 'https://authlib-injector.yushi.moe/artifact/latest.json';
    this.elyByMetaUrl = 'https://authlib-injector.yushi.moe/';
  }

  // ---- ДОБАВЛЕН МЕТОД ГЕНЕРАЦИИ UUID ----
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

  async startUsernamePasswordAuth(username, password) {
    try {
      const response = await axios.post('https://authserver.ely.by/auth/authenticate', {
        username: username,
        password: password,
        clientToken: this.generateUUID(),  // теперь метод существует
        requestUser: true
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.accessToken) {
        return {
          accessToken: response.data.accessToken,
          refreshToken: response.data.clientToken || null,
          expiresIn: 86400,
          tokenType: 'Bearer',
          username: response.data.selectedProfile?.name || username,
          uuid: response.data.selectedProfile?.id || this.generateUUID()
        };
      } else {
        throw new Error('Authentication failed');
      }
    } catch (error) {
      console.error('Username/password auth failed:', error.response?.data || error.message);
      if (error.response?.data?.errorMessage) {
        throw new Error(error.response.data.errorMessage);
      } else if (error.response?.data?.error) {
        throw new Error(error.response.data.error);
      } else {
        throw new Error('Неверный логин или пароль');
      }
    }
  }

  async startOAuthFlow() {
    return new Promise((resolve, reject) => {
      const state = this.generateState();
      const authParams = new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: this.redirectUri,
        response_type: 'code',
        scope: 'account_info minecraft_server_session',
        state: state
      });

      const authorizationUrl = `${this.authUrl}/authorize?${authParams.toString()}`;

      const authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        show: true,
        center: true,
        title: 'Вход через Ely.by',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        },
        autoHideMenuBar: true,
        backgroundColor: '#1a1a1a'
      });

      authWindow.loadURL(authorizationUrl);

      const http = require('http');
      const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);

        if (parsedUrl.pathname === '/callback') {
          const { code, state: returnedState, error } = parsedUrl.query;

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body><h1>Ошибка авторизации</h1><p>Вы можете закрыть это окно.</p></body></html>');
            server.close();
            authWindow.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (returnedState !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body><h1>Ошибка</h1><p>Неверный state параметр</p></body></html>');
            server.close();
            authWindow.close();
            reject(new Error('Invalid state parameter'));
            return;
          }

          if (code) {
            try {
              const tokens = await this.exchangeCodeForTokens(code);
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <html>
                <head>
                  <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #0a0a0a; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .container { text-align: center; padding: 40px; background: #1a1a1a; border-radius: 8px; border: 1px solid #2a2a2a; }
                    h1 { color: #2ecc71; margin-bottom: 16px; }
                    p { color: #999; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <h1>✓ Авторизация успешна!</h1>
                    <p>Вы можете закрыть это окно</p>
                  </div>
                  <script>setTimeout(() => window.close(), 2000);</script>
                </body>
                </html>
              `);
              server.close();
              authWindow.close();
              resolve(tokens);
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end('<html><body><h1>Ошибка</h1><p>Не удалось получить токены</p></body></html>');
              server.close();
              authWindow.close();
              reject(error);
            }
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body><h1>Ошибка</h1><p>Код авторизации не получен</p></body></html>');
            server.close();
            authWindow.close();
            reject(new Error('No authorization code received'));
          }
        }
      });

      server.listen(25585, 'localhost', () => {
        console.log('OAuth callback server started on port 25585');
      });

      authWindow.on('closed', () => {
        server.close();
        reject(new Error('Auth window closed by user'));
      });
    });
  }

  async exchangeCodeForTokens(code) {
    try {
      const response = await axios.post(`${this.authUrl}/token`, {
        client_id: this.clientId,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
        code: code
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type
      };
    } catch (error) {
      console.error('Failed to exchange code for tokens:', error.response?.data || error.message);
      throw error;
    }
  }

  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.post(`${this.authUrl}/token`, {
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type
      };
    } catch (error) {
      console.error('Failed to refresh token:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAccountInfo(accessToken) {
    try {
      const response = await axios.post('https://authserver.ely.by/auth/validate', {
        accessToken: accessToken
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      // Валидация прошла, но для получения данных нужно использовать другой эндпоинт.
      // Пока возвращаем заглушку.
      return {
        id: null,
        uuid: null,
        username: null,
        email: null
      };
    } catch (error) {
      console.error('Failed to get account info:', error.response?.data || error.message);
      throw error;
    }
  }

  async getMinecraftProfile(accessToken) {
    try {
      const accountInfo = await this.getAccountInfo(accessToken);
      const response = await axios.get(`${this.elyByMetaUrl}/api/profiles/minecraft/${accountInfo.username}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return {
        id: response.data.id,
        name: response.data.name,
        properties: response.data.properties || []
      };
    } catch (error) {
      console.error('Failed to get Minecraft profile:', error.response?.data || error.message);
      throw error;
    }
  }

  async authenticateForGame(accessToken) {
    try {
      const accountInfo = await this.getAccountInfo(accessToken);
      return {
        accessToken: accessToken,
        uuid: accountInfo.uuid ? accountInfo.uuid.replace(/-/g, '') : this.generateUUID(),
        username: accountInfo.username,
        properties: []
      };
    } catch (error) {
      console.error('Failed to authenticate for game:', error.response?.data || error.message);
      throw error;
    }
  }

  async validateToken(accessToken) {
    try {
      await this.getAccountInfo(accessToken);
      return true;
    } catch (error) {
      return false;
    }
  }

  generateState() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  async logout(accessToken) {
    try {
      await axios.post(`${this.authUrl}/revoke`, {
        token: accessToken
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      return true;
    } catch (error) {
      console.error('Failed to revoke token:', error.response?.data || error.message);
      return false;
    }
  }
}

module.exports = ElyByAuth;