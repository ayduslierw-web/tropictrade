const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const BASE_URL = 'https://tropictrade.onrender.com';
const STEAM_OPENID = 'https://steamcommunity.com/openid/';

app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'tropictrade-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(__dirname, {
  index: false
}));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'TropicTrade'
  });
});

/* =========================
   STEAM OPENID
   API KEY НЕ НУЖЕН
========================= */

app.get('/auth/steam', (req, res) => {
  const returnUrl = `${BASE_URL}/auth/steam/callback`;

  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl,
    'openid.realm': BASE_URL,
    'openid.identity':
      'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id':
      'http://specs.openid.net/auth/2.0/identifier_select'
  });

  res.redirect(`${STEAM_OPENID}?${params.toString()}`);
});

/* =========================
   STEAM CALLBACK
========================= */

app.get('/auth/steam/callback', async (req, res) => {
  try {
    if (req.query['openid.mode'] !== 'id_res') {
      return res.status(400).send('Steam авторизация отменена.');
    }

    const claimedId = String(
      req.query['openid.claimed_id'] || ''
    );

    const returnTo = String(
      req.query['openid.return_to'] || ''
    );

    const expectedReturn =
      `${BASE_URL}/auth/steam/callback`;

    if (
      !claimedId.startsWith(
        'https://steamcommunity.com/openid/id/'
      ) &&
      !claimedId.startsWith(
        'http://steamcommunity.com/openid/id/'
      )
    ) {
      return res.status(400).send(
        'Некорректный Steam Claimed ID.'
      );
    }

    if (!returnTo.startsWith(expectedReturn)) {
      return res.status(400).send(
        'Некорректный OpenID return URL.'
      );
    }

    const verify = new URLSearchParams();

    for (const [key, value] of Object.entries(req.query)) {
      if (
        key.startsWith('openid.') &&
        key !== 'openid.mode'
      ) {
        verify.set(key, String(value));
      }
    }

    verify.set(
      'openid.mode',
      'check_authentication'
    );

    const response = await fetch(STEAM_OPENID, {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded',
        'User-Agent':
          'TropicTrade/1.0'
      },
      body: verify.toString()
    });

    const text = await response.text();

    if (
      !response.ok ||
      !/^is_valid:true\s*$/m.test(text)
    ) {
      console.error(
        'Steam verification failed:',
        text
      );

      return res.status(401).send(
        'Steam не подтвердил авторизацию.'
      );
    }

    const match =
      claimedId.match(
        /\/openid\/id\/(\d+)$/
      );

    if (!match) {
      return res.status(400).send(
        'Не удалось получить SteamID.'
      );
    }

    req.session.steamId = match[1];

    req.session.save(() => {
      res.redirect(
        `${BASE_URL}/#profile`
      );
    });

  } catch (error) {
    console.error(
      'Steam callback error:',
      error
    );

    res.status(500).send(
      'Ошибка Steam авторизации.'
    );
  }
});

/* =========================
   LOGOUT
========================= */

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect(
      `${BASE_URL}/#profile`
    );
  });
});

/* =========================
   CURRENT USER
========================= */

app.get('/api/me', (req, res) => {
  if (!req.session.steamId) {
    return res.json({
      authenticated: false
    });
  }

  res.json({
    authenticated: true,
    steamId: req.session.steamId
  });
});

/* =========================
   CS2 INVENTORY
   БЕЗ STEAM API KEY
========================= */

app.get('/api/inventory', async (req, res) => {
  const steamId =
    req.session.steamId;

  if (!steamId) {
    return res.status(401).json({
      error: 'NOT_AUTHENTICATED',
      message:
        'Сначала войди через Steam.'
    });
  }

  try {
    const startAssetId =
      String(
        req.query.start_assetid || ''
      ).trim();

    const url = new URL(
      `https://steamcommunity.com/inventory/${steamId}/730/2`
    );

    url.searchParams.set(
      'l',
      'english'
    );

    url.searchParams.set(
      'count',
      '100'
    );

    if (startAssetId) {
      url.searchParams.set(
        'start_assetid',
        startAssetId
      );
    }

    const response = await fetch(
      url,
      {
        headers: {
          Accept:
            'application/json',
          'User-Agent':
            'TropicTrade/1.0'
        }
      }
    );

    const text =
      await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch (_) {}

    if (!response.ok || !data) {
      return res.status(502).json({
        error:
          'STEAM_INVENTORY_UNAVAILABLE',
        message:
          'Steam не отдаёт инвентарь. Проверь настройки приватности Steam.'
      });
    }

    if (data.success === false) {
      return res.status(403).json({
        error:
          'STEAM_INVENTORY_PRIVATE',
        message:
          'Инвентарь Steam закрыт. Открой инвентарь в настройках приватности Steam.'
      });
    }

    const assets =
      Array.isArray(data.assets)
        ? data.assets
        : [];

    const descriptions =
      Array.isArray(data.descriptions)
        ? data.descriptions
        : [];

    res.json({
      success: true,
      steamId,
      assets,
      descriptions,
      total_inventory_count:
        Number(
          data.total_inventory_count ||
          assets.length
        ),
      more_items:
        Boolean(data.more_items),
      last_assetid:
        data.last_assetid || null
    });

  } catch (error) {
    console.error(
      'Inventory error:',
      error
    );

    res.status(502).json({
      error:
        'STEAM_INVENTORY_ERROR',
      message:
        'Не удалось связаться со Steam. Попробуй обновить страницу.'
    });
  }
});

/* =========================
   FALLBACK
========================= */

app.use((req, res) => {
  if (
    req.method === 'GET' &&
    !req.path.startsWith('/api/') &&
    !req.path.startsWith('/auth/')
  ) {
    return res.sendFile(
      path.join(
        __dirname,
        'index.html'
      )
    );
  }

  res.status(404).send(
    'Not Found'
  );
});

/* =========================
   START
========================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `TropicTrade running on port ${PORT}`
    );

    console.log(
      `BASE_URL=${BASE_URL}`
    );
  }
);
