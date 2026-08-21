const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

const BASE_URL = (
  process.env.BASE_URL ||
  `http://localhost:${PORT}`
).replace(/\/$/, "");

const STEAM_OPENID_URL =
  "https://steamcommunity.com/openid/login";

app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "tropictrade-secret-change-me",

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

/* =========================
   STATIC FILES
========================= */

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "TropicTrade"
  });
});

/* =========================
   STEAM LOGIN
   API KEY НЕ НУЖЕН
========================= */

app.get("/auth/steam", (req, res) => {
  const returnUrl =
    `${BASE_URL}/auth/steam/callback`;

  const params = new URLSearchParams();

  params.set(
    "openid.ns",
    "http://specs.openid.net/auth/2.0"
  );

  params.set(
    "openid.mode",
    "checkid_setup"
  );

  params.set(
    "openid.return_to",
    returnUrl
  );

  params.set(
    "openid.realm",
    BASE_URL
  );

  params.set(
    "openid.identity",
    "http://specs.openid.net/auth/2.0/identifier_select"
  );

  params.set(
    "openid.claimed_id",
    "http://specs.openid.net/auth/2.0/identifier_select"
  );

  const steamLoginUrl =
    `${STEAM_OPENID_URL}?${params.toString()}`;

  console.log(
    "Steam login:",
    steamLoginUrl
  );

  res.redirect(302, steamLoginUrl);
});

/* =========================
   STEAM CALLBACK
========================= */

app.get(
  "/auth/steam/callback",
  async (req, res) => {
    try {
      console.log(
        "Steam callback received"
      );

      if (
        req.query["openid.mode"] !==
        "id_res"
      ) {
        return res
          .status(400)
          .send(
            "Steam авторизация отменена."
          );
      }

      const claimedId = String(
        req.query["openid.claimed_id"] ||
        ""
      );

      const returnTo = String(
        req.query["openid.return_to"] ||
        ""
      );

      /* Проверяем Steam ID */

      const steamMatch =
        claimedId.match(
          /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/
        );

      if (!steamMatch) {
        return res
          .status(400)
          .send(
            "Не удалось получить Steam ID."
          );
      }

      /* Проверяем return URL */

      if (
        !returnTo.startsWith(
          `${BASE_URL}/auth/steam/callback`
        )
      ) {
        return res
          .status(400)
          .send(
            "Некорректный Steam return URL."
          );
      }

      /* =========================
         ПРОВЕРКА У STEAM
      ========================= */

      const verifyParams =
        new URLSearchParams();

      for (
        const [key, value]
        of Object.entries(req.query)
      ) {
        if (
          key.startsWith("openid.")
        ) {
          verifyParams.set(
            key,
            String(value)
          );
        }
      }

      verifyParams.set(
        "openid.mode",
        "check_authentication"
      );

      const response =
        await fetch(
          STEAM_OPENID_URL,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded",

              "User-Agent":
                "TropicTrade/1.0"
            },

            body:
              verifyParams.toString()
          }
        );

      const text =
        await response.text();

      console.log(
        "Steam verification:",
        text
      );

      if (
        !response.ok ||
        !/is_valid\s*:\s*true/i.test(text)
      ) {
        return res
          .status(401)
          .send(
            "Steam не подтвердил авторизацию."
          );
      }

      /* =========================
         СОХРАНЯЕМ STEAM ID
      ========================= */

      const steamId =
        steamMatch[1];

      req.session.steamId =
        steamId;

      req.session.save(
        (error) => {
          if (error) {
            console.error(
              "Session save error:",
              error
            );

            return res
              .status(500)
              .send(
                "Не удалось сохранить сессию."
              );
          }

          res.redirect(
            `${BASE_URL}/#profile`
          );
        }
      );

    } catch (error) {
      console.error(
        "Steam callback error:",
        error
      );

      res
        .status(500)
        .send(
          "Ошибка Steam авторизации."
        );
    }
  }
);

/* =========================
   LOGOUT
========================= */

app.get(
  "/auth/logout",
  (req, res) => {
    req.session.destroy(
      () => {
        res.redirect(
          `${BASE_URL}/#profile`
        );
      }
    );
  }
);

/* =========================
   CURRENT USER
========================= */

app.get(
  "/api/me",
  (req, res) => {
    if (!req.session.steamId) {
      return res.json({
        authenticated: false
      });
    }

    res.json({
      authenticated: true,
      steamId:
        req.session.steamId
    });
  }
);

/* =========================
   CS2 INVENTORY
   БЕЗ STEAM API KEY
========================= */

app.get(
  "/api/inventory",
  async (req, res) => {

    const steamId =
      req.session.steamId;

    if (!steamId) {
      return res
        .status(401)
        .json({
          error:
            "NOT_AUTHENTICATED",

          message:
            "Сначала войди через Steam."
        });
    }

    try {
      const url =
        new URL(
          `https://steamcommunity.com/inventory/${steamId}/730/2`
        );

      url.searchParams.set(
        "l",
        "english"
      );

      url.searchParams.set(
        "count",
        "100"
      );

      if (
        req.query.start_assetid
      ) {
        url.searchParams.set(
          "start_assetid",
          String(
            req.query.start_assetid
          )
        );
      }

      const response =
        await fetch(
          url,
          {
            headers: {
              Accept:
                "application/json",

              "User-Agent":
                "TropicTrade/1.0"
            }
          }
        );

      const text =
        await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        return res
          .status(502)
          .json({
            error:
              "INVALID_STEAM_RESPONSE",

            message:
              "Steam вернул некорректный ответ."
          });
      }

      if (!response.ok) {
        return res
          .status(502)
          .json({
            error:
              "STEAM_INVENTORY_UNAVAILABLE",

            message:
              "Steam не отдаёт инвентарь."
          });
      }

      if (
        data.success === false
      ) {
        return res
          .status(403)
          .json({
            error:
              "STEAM_INVENTORY_PRIVATE",

            message:
              "Инвентарь Steam закрыт."
          });
      }

      res.json({
        success: true,

        steamId,

        assets:
          Array.isArray(
            data.assets
          )
            ? data.assets
            : [],

        descriptions:
          Array.isArray(
            data.descriptions
          )
            ? data.descriptions
            : [],

        total_inventory_count:
          Number(
            data.total_inventory_count ||
            0
          ),

        more_items:
          Boolean(
            data.more_items
          ),

        last_assetid:
          data.last_assetid ||
          null
      });

    } catch (error) {
      console.error(
        "Inventory error:",
        error
      );

      res
        .status(502)
        .json({
          error:
            "STEAM_INVENTORY_ERROR",

          message:
            "Не удалось получить инвентарь Steam."
        });
    }
  }
);

/* =========================
   FALLBACK
========================= */

app.use(
  (req, res) => {

    if (
      req.method === "GET" &&
      !req.path.startsWith(
        "/api/"
      ) &&
      !req.path.startsWith(
        "/auth/"
      )
    ) {
      return res.sendFile(
        path.join(
          __dirname,
          "index.html"
        )
      );
    }

    res
      .status(404)
      .send("Not Found");
  }
);

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "TropicTrade started"
    );

    console.log(
      `PORT=${PORT}`
    );

    console.log(
      `BASE_URL=${BASE_URL}`
    );

    console.log(
      `STEAM_OPENID_URL=${STEAM_OPENID_URL}`
    );

    console.log(
      "================================"
    );
  }
);
