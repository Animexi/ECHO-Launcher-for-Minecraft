const axios = require('axios');
const { BrowserWindow } = require('electron');
const url = require('url');
const crypto = require('crypto');

class ElyByAuth {
  constructor() {
    this.clientId = null;
    this.clientSecret = null;
    this.authUrl = 'https://account.ely.by/oauth2/v1';
    this.apiUrl = 'https://account.ely.by/api';
    this.authserverUrl = 'https://authserver.ely.by';
    this.skinSystemUrl = 'http://skinsystem.ely.by';
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

  /**
   * Декодирует base64 строку в объект
   */
  _decodeBase64Value(base64Value) {
    try {
      const decoded = Buffer.from(base64Value, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch (e) {
      console.error('[ElyByAuth] Ошибка декодирования base64:', e.message);
      return null;
    }
  }

  /**
   * Получает профиль пользователя (с тектурой скина) по нику
   */
  async fetchMinecraftProfile(username) {
    try {
      console.log(`[ElyByAuth] Загрузка профиля для пользователя: ${username}`);
      
      const response = await axios.get(`${this.skinSystemUrl}/profile/${encodeURIComponent(username)}`, {
        timeout: 10000,
        validateStatus: (status) => status < 500
      });

      console.log(`[ElyByAuth] Ответ профиля: статус=${response.status}`);

      if (response.status === 204 || !response.data) {
        console.log(`[ElyByAuth] Профиль не найден для пользователя: ${username}`);
        return null;
      }

      if (response.status === 404) {
        console.log(`[ElyByAuth] Профиль 404 для пользователя: ${username}`);
        return null;
      }

      const profile = response.data;
      console.log(`[ElyByAuth] Профиль получен: id=${profile.id}, name=${profile.name}`);

      // Ищем свойство textures
      const texturesProp = profile.properties?.find(p => p.name === 'textures');
      if (texturesProp) {
        console.log(`[ElyByAuth] Найдено свойство textures, signature: ${texturesProp.signature ? 'да' : 'нет'}`);
        const textures = this._decodeBase64Value(texturesProp.value);
        if (textures && textures.SKIN) {
          console.log(`[ElyByAuth] URL скина: ${textures.SKIN.url}`);
          console.log(`[ElyByAuth] Модель скина: ${textures.SKIN.metadata?.model || 'default'}`);
        } else {
          console.log(`[ElyByAuth] Текстуры не найдены в decoded данных`);
        }
        if (textures && textures.CAPE) {
          console.log(`[ElyByAuth] URL плаща: ${textures.CAPE.url}`);
        }
        return {
          id: profile.id,
          name: profile.name,
          textures: textures,
          texturesProperty: texturesProp
        };
      } else {
        console.log(`[ElyByAuth] Свойство textures не найдено в профиле`);
        return {
          id: profile.id,
          name: profile.name,
          textures: null,
          texturesProperty: null
        };
      }
    } catch (error) {
      console.error(`[ElyByAuth] Ошибка загрузки профиля для ${username}:`, error.message);
      if (error.response) {
        console.error(`[ElyByAuth] Ответ сервера: статус=${error.response.status}, данные=`, error.response.data);
      }
      return null;
    }
  }

  /**
   * Получает URL скина по нику напрямую
   */
  async getSkinUrl(username) {
    try {
      console.log(`[ElyByAuth] Прямой запрос скина для: ${username}`);
      const skinUrl = `${this.skinSystemUrl}/skins/${encodeURIComponent(username)}.png`;
      console.log(`[ElyByAuth] URL запроса скина: ${skinUrl}`);
      
      const response = await axios.head(skinUrl, {
        timeout: 5000,
        validateStatus: (status) => status < 500
      });
      
      console.log(`[ElyByAuth] Статус проверки скина: ${response.status}`);
      return response.status === 200 ? skinUrl : null;
    } catch (error) {
      console.log(`[ElyByAuth] Скин не найден для ${username}: ${error.message}`);
      return null;
    }
  }

  async startUsernamePasswordAuth(username, password) {
    try {
      console.log(`[ElyByAuth] Начало авторизации для пользователя: ${username}`);
      const clientToken = this.generateUUID();
      console.log(`[ElyByAuth] Сгенерирован clientToken: ${clientToken}`);

      const response = await axios.post(`${this.authserverUrl}/auth/authenticate`, {
        username: username,
        password: password,
        clientToken: clientToken,
        requestUser: true
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      console.log(`[ElyByAuth] Ответ от authserver: статус=${response.status}`);
      console.log(`[ElyByAuth] Данные ответа: accessToken=${response.data.accessToken ? 'да' : 'нет'}, profile=${response.data.selectedProfile ? 'да' : 'нет'}`);

      if (response.data && response.data.accessToken) {
        const authResult = {
          accessToken: response.data.accessToken,
          refreshToken: response.data.clientToken || null,
          expiresIn: 86400,
          tokenType: 'Bearer',
          username: response.data.selectedProfile?.name || username,
          uuid: response.data.selectedProfile?.id || this.generateUUID(),
          clientToken: clientToken
        };

        // Получаем профиль и скин
        const profileName = response.data.selectedProfile?.name || username;
        console.log(`[ElyByAuth] Загрузка профиля и скина для: ${profileName}`);
        const profile = await this.fetchMinecraftProfile(profileName);
        
        if (profile) {
          authResult.profile = profile;
          if (profile.textures && profile.textures.SKIN) {
            authResult.skinUrl = profile.textures.SKIN.url;
            authResult.skinModel = profile.textures.SKIN.metadata?.model || 'default';
            console.log(`[ElyByAuth] Скин получен: ${authResult.skinUrl} (модель: ${authResult.skinModel})`);
          } else {
            authResult.skinUrl = null;
            authResult.skinModel = 'default';
            console.log(`[ElyByAuth] Скин не найден, используется стандартный`);
          }
        } else {
          authResult.profile = null;
          authResult.skinUrl = null;
          authResult.skinModel = 'default';
          console.log(`[ElyByAuth] Профиль не загружен, скин не установлен`);
        }

        console.log(`[ElyByAuth] Авторизация успешна для: ${authResult.username}, UUID: ${authResult.uuid}`);
        return authResult;
      } else {
        console.error(`[ElyByAuth] Ответ не содержит accessToken`);
        throw new Error('Authentication failed: no accessToken');
      }
    } catch (error) {
      console.error(`[ElyByAuth] Ошибка авторизации для ${username}:`, error.message);
      
      // Проверяем на 2FA
      if (error.response?.status === 401 && error.response?.data?.errorMessage?.includes('two factor')) {
        console.log(`[ElyByAuth] Требуется 2FA токен`);
        const err = new Error('TWO_FACTOR_REQUIRED');
        err.requires2FA = true;
        err.errorMessage = error.response.data.errorMessage;
        throw err;
      }

      if (error.response?.data?.errorMessage) {
        console.error(`[ElyByAuth] Ошибка от сервера: ${error.response.data.errorMessage}`);
        throw new Error(error.response.data.errorMessage);
      } else if (error.response?.data?.error) {
        console.error(`[ElyByAuth] Ошибка от сервера: ${error.response.data.error}`);
        throw new Error(error.response.data.error);
      } else if (error.code === 'ECONNABORTED') {
        console.error(`[ElyByAuth] Таймаут подключения к authserver.ely.by`);
        throw new Error('Таймаут подключения к серверу авторизации');
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        console.error(`[ElyByAuth] Невозможно подключиться к authserver.ely.by`);
        throw new Error('Невозможно подключиться к серверу авторизации. Проверьте интернет-соединение.');
      } else {
        console.error(`[ElyByAuth] Неизвестная ошибка:`, error);
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
      console.log('[ElyByAuth] Получение информации об аккаунте...');
      const response = await axios.get(`${this.apiUrl}/account/v1/info`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 10000
      });
      console.log(`[ElyByAuth] Информация об аккаунте получена: uuid=${response.data.uuid}, username=${response.data.username}`);
      return {
        id: response.data.id,
        uuid: response.data.uuid,
        username: response.data.username,
        email: response.data.email || null,
        preferredLanguage: response.data.preferredLanguage || 'ru'
      };
    } catch (error) {
      console.error(`[ElyByAuth] Ошибка получения информации об аккаунте:`, error.message);
      if (error.response) {
        console.error(`[ElyByAuth] Ответ сервера: статус=${error.response.status}`, error.response.data);
      }
      throw error;
    }
  }

  async getMinecraftProfile(accessToken) {
    try {
      console.log('[ElyByAuth] Получение Minecraft профиля...');
      const accountInfo = await this.getAccountInfo(accessToken);
      const username = accountInfo.username;
      
      // Получаем профиль через систему скинов Ely.by
      const profile = await this.fetchMinecraftProfile(username);
      
      if (profile) {
        console.log(`[ElyByAuth] Minecraft профиль получен: id=${profile.id}, name=${profile.name}`);
        return {
          id: profile.id,
          name: profile.name,
          properties: profile.texturesProperty ? [profile.texturesProperty] : [],
          skinUrl: profile.textures?.SKIN?.url || null,
          skinModel: profile.textures?.SKIN?.metadata?.model || 'default'
        };
      } else {
        console.log(`[ElyByAuth] Minecraft профиль не найден`);
        return {
          id: accountInfo.uuid,
          name: username,
          properties: [],
          skinUrl: null,
          skinModel: 'default'
        };
      }
    } catch (error) {
      console.error(`[ElyByAuth] Ошибка получения Minecraft профиля:`, error.message);
      throw error;
    }
  }

  async authenticateForGame(accessToken) {
    try {
      console.log('[ElyByAuth] Аутентификация для игры...');
      const accountInfo = await this.getAccountInfo(accessToken);
      const username = accountInfo.username;
      
      // Получаем профиль с тектурой
      const profile = await this.fetchMinecraftProfile(username);
      
      let properties = [];
      let skinUrl = null;
      let skinModel = 'default';

      if (profile && profile.texturesProperty) {
        properties = [profile.texturesProperty];
        skinUrl = profile.textures?.SKIN?.url || null;
        skinModel = profile.textures?.SKIN?.metadata?.model || 'default';
        console.log(`[ElyByAuth] Аутентификация для игры успешна, скин: ${skinUrl || 'нет'}`);
      } else {
        console.log(`[ElyByAuth] Аутентификация для игры успешна, скин не найден`);
      }

      return {
        accessToken: accessToken,
        uuid: accountInfo.uuid ? accountInfo.uuid.replace(/-/g, '') : this.generateUUID(),
        username: username,
        properties: properties,
        skinUrl: skinUrl,
        skinModel: skinModel
      };
    } catch (error) {
      console.error(`[ElyByAuth] Ошибка аутентификации для игры:`, error.message);
      throw error;
    }
  }

  async validateToken(accessToken) {
    try {
      console.log('[ElyByAuth] Валидация токена...');
      await this.getAccountInfo(accessToken);
      console.log('[ElyByAuth] Токен валиден');
      return true;
    } catch (error) {
      console.log(`[ElyByAuth] Токен невалиден: ${error.message}`);
      return false;
    }
  }

  /**
   * Обновляет скин аккаунта (вызывается после авторизации)
   */
  async updateAccountSkinFromServer(username) {
    try {
      console.log(`[ElyByAuth] Обновление скина для пользователя: ${username}`);
      const profile = await this.fetchMinecraftProfile(username);
      
      if (profile && profile.textures) {
        console.log(`[ElyByAuth] Скин обновлён для ${username}: ${profile.textures.SKIN.url}`);
        return {
          skinUrl: profile.textures.SKIN.url,
          skinModel: profile.textures.SKIN.metadata?.model || 'default',
          capeUrl: profile.textures.CAPE?.url || null,
          success: true
        };
      } else {
        console.log(`[ElyByAuth] Скин не найден для ${username}, используется стандартный`);
        return {
          skinUrl: null,
          skinModel: 'default',
          capeUrl: null,
          success: true
        };
      }
    } catch (error) {
      console.error(`[ElyByAuth] Ошибка обновления скина для ${username}:`, error.message);
      return {
        skinUrl: null,
        skinModel: 'default',
        capeUrl: null,
        success: false,
        error: error.message
      };
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