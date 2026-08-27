const {
  Client,
  GatewayIntentBits,
  Partials
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

// =====================================================
// ENVIRONMENT
// =====================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const PORT = process.env.PORT || 3000;

if (!TOKEN) {
  console.error("❌ Missing DISCORD_TOKEN.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ Missing CLIENT_ID.");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("❌ Missing GUILD_ID.");
  process.exit(1);
}

// =====================================================
// EXPRESS / RENDER
// =====================================================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("FS Bot is online.");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    bot: client.user
      ? client.user.tag
      : "connecting",
    guildId: GUILD_ID
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🌐 Web server running on port ${PORT}`
  );
});

// =====================================================
// DISCORD CLIENT
// =====================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Channel,
    Partials.Message
  ]
});

// =====================================================
// CONFIG
// =====================================================

const PREFIX = ".";

const MAX_DOWNLOAD_SIZE =
  20 * 1024 * 1024;

const DOWNLOAD_TIMEOUT =
  15000;

// =====================================================
// RANDOM FILE NAME
// =====================================================

function randomName(length = 10) {
  const chars =
    "abcdefghijklmnopqrstuvwxyz";

  let result = "";

  for (let i = 0; i < length; i++) {
    result +=
      chars[
        Math.floor(
          Math.random() *
          chars.length
        )
      ];
  }

  return result;
}

// =====================================================
// URL CHECK
// =====================================================

function isValidURL(value) {
  try {
    const url = new URL(
      String(value).trim()
    );

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

// =====================================================
// FIND URL IN TEXT
// =====================================================

function extractURL(text) {
  if (!text) {
    return null;
  }

  const matches =
    String(text).match(
      /https?:\/\/[^\s<>"']+/i
    );

  if (!matches) {
    return null;
  }

  let url =
    matches[0].trim();

  // Remove common trailing characters
  url = url.replace(
    /[)\]}>,"'`]+$/g,
    ""
  );

  return isValidURL(url)
    ? url
    : null;
}

// =====================================================
// FETCH URL
// =====================================================

async function downloadURL(url) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      DOWNLOAD_TIMEOUT
    );

  try {
    const response =
      await fetch(url, {
        redirect: "follow",
        signal:
          controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 FS-Bot"
        }
      });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const contentLength =
      response.headers.get(
        "content-length"
      );

    if (
      contentLength &&
      Number(contentLength) >
        MAX_DOWNLOAD_SIZE
    ) {
      throw new Error(
        "File is too large."
      );
    }

    const arrayBuffer =
      await response.arrayBuffer();

    const buffer =
      Buffer.from(
        arrayBuffer
      );

    if (
      buffer.length >
      MAX_DOWNLOAD_SIZE
    ) {
      throw new Error(
        "File is too large."
      );
    }

    return {
      buffer,
      contentType:
        response.headers.get(
          "content-type"
        ) || "",
      finalURL:
        response.url || url
    };

  } finally {
    clearTimeout(timeout);
  }
}

// =====================================================
// TEMP FILE CLEANUP
// =====================================================

const TEMP_DIR =
  path.join(
    __dirname,
    "temp"
  );

if (
  !fs.existsSync(
    TEMP_DIR
  )
) {
  fs.mkdirSync(
    TEMP_DIR,
    {
      recursive: true
    }
  );
}

// =====================================================
// GET COMMAND
// =====================================================

async function handleGetCommand(
  message,
  args
) {
  let url = null;

  // ---------------------------------------------------
  // .get URL
  // ---------------------------------------------------

  if (args.length > 0) {
    url =
      extractURL(
        args.join(" ")
      );
  }

  // ---------------------------------------------------
  // .get while replying to a message
  // ---------------------------------------------------

  if (
    !url &&
    message.reference &&
    message.reference.messageId
  ) {
    try {
      const referenced =
        await message.channel.messages.fetch(
          message.reference.messageId
        );

      if (referenced) {
        url =
          extractURL(
            referenced.content
          );

        // Check attachments for URL-like text
        if (!url) {
          for (
            const attachment of
            referenced.attachments.values()
          ) {
            if (
              isValidURL(
                attachment.url
              )
            ) {
              url =
                attachment.url;
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error(
        "❌ Failed to read replied message:",
        error
      );
    }
  }

  // ---------------------------------------------------
  // No URL
  // ---------------------------------------------------

  if (!url) {
    await message.reply({
      content:
        "Enter a valid URL.",
      allowedMentions: {
        repliedUser: true
      }
    });

    return;
  }

  // ---------------------------------------------------
  // Download
  // ---------------------------------------------------

  await message.channel.sendTyping();

  try {
    const result =
      await downloadURL(
        url
      );

    // -------------------------------------------------
    // Always random 10-character name
    // -------------------------------------------------

    let extension = ".txt";

    try {
      const parsed =
        new URL(
          result.finalURL
        );

      const pathname =
        parsed.pathname;

      const match =
        pathname.match(
          /\.([a-zA-Z0-9]{1,10})$/
        );

      if (match) {
        const ext =
          match[1].toLowerCase();

        // Keep common source extensions
        const allowed =
          [
            "txt",
            "lua",
            "json",
            "js",
            "html",
            "css",
            "xml"
          ];

        if (
          allowed.includes(
            ext
          )
        ) {
          extension =
            "." + ext;
        }
      }
    } catch {}

    const filename =
      randomName(10) +
      extension;

    const filePath =
      path.join(
        TEMP_DIR,
        filename
      );

    fs.writeFileSync(
      filePath,
      result.buffer
    );

    try {
      await message.reply({
        files: [
          {
            attachment:
              filePath,
            name:
              filename
          }
        ],
        allowedMentions: {
          repliedUser: true
        }
      });
    } finally {
      setTimeout(
        () => {
          fs.unlink(
            filePath,
            () => {}
          );
        },
        5000
      );
    }

  } catch (error) {
    console.error(
      "❌ .get error:",
      error
    );

    await message.reply({
      content:
        "❌ I couldn't download that URL.",
      allowedMentions: {
        repliedUser: true
      }
    });
  }
}

// =====================================================
// FILE INFORMATION
// =====================================================

function getMessageFile(
  message
) {
  if (
    !message.attachments ||
    message.attachments.size === 0
  ) {
    return null;
  }

  const attachment =
    message.attachments.first();

  if (!attachment) {
    return null;
  }

  return {
    name:
      attachment.name ||
      "file",
    url:
      attachment.url,
    size:
      attachment.size || 0
  };
}

// =====================================================
// FORWARDED MESSAGE FILE
// =====================================================

async function getReferencedFile(
  message
) {
  if (
    !message.reference ||
    !message.reference.messageId
  ) {
    return null;
  }

  try {
    const referenced =
      await message.channel.messages.fetch(
        message.reference.messageId
      );

    if (!referenced) {
      return null;
    }

    return getMessageFile(
      referenced
    );
  } catch {
    return null;
  }
}

// =====================================================
// OBFUSCATOR DETECTOR
// =====================================================

function detectObfuscator(
  content,
  filename = ""
) {
  const text =
    String(content || "");

  const lower =
    text.toLowerCase();

  // ---------------------------------------------------
  // Prometheus / WeAreDevs style signatures
  // ---------------------------------------------------

  if (
    lower.includes(
      "prometheus"
    ) ||
    lower.includes(
      "prometheus-lua"
    ) ||
    lower.includes(
      "wearedevs"
    ) ||
    lower.includes(
      "wearedevs.net"
    )
  ) {
    return {
      name:
        "Prometheus / WeAreDevs",
      percent: 98
    };
  }

  // ---------------------------------------------------
  // Luraph
  // ---------------------------------------------------

  if (
    lower.includes(
      "luraph"
    ) ||
    lower.includes(
      "luraph.com"
    ) ||
    lower.includes(
      "lph_"
    )
  ) {
    return {
      name:
        "Luraph",
      percent: 98
    };
  }

  // ---------------------------------------------------
  // MoonVeil
  // ---------------------------------------------------

  if (
    lower.includes(
      "moonveil"
    ) ||
    lower.includes(
      "moonveil.lua"
    )
  ) {
    return {
      name:
        "Moonveil",
      percent: 97
    };
  }

  // ---------------------------------------------------
  // Luarmor
  // ---------------------------------------------------

  if (
    lower.includes(
      "luarmor"
    ) ||
    lower.includes(
      "luarmor.net"
    ) ||
    lower.includes(
      "luarmor_api"
    )
  ) {
    return {
      name:
        "Luarmor",
      percent: 97
    };
  }

  // ---------------------------------------------------
  // 25ms
  // ---------------------------------------------------

  if (
    lower.includes(
      "25ms"
    ) ||
    lower.includes(
      "25ms-obfuscator"
    )
  ) {
    return {
      name:
        "25ms Obfuscator",
      percent: 96
    };
  }

  // ---------------------------------------------------
  // PolSec
  // ---------------------------------------------------

  if (
    lower.includes(
      "polsec"
    ) ||
    lower.includes(
      "pol sec"
    )
  ) {
    return {
      name:
        "PolSec",
      percent: 96
    };
  }

  // ---------------------------------------------------
  // Galactic Protection
  // ---------------------------------------------------

  if (
    lower.includes(
      "galactic"
    ) &&
    lower.includes(
      "protection"
    )
  ) {
    return {
      name:
        "Galactic Protection",
      percent: 94
    };
  }

  // ---------------------------------------------------
  // Lightray
  // ---------------------------------------------------

  if (
    lower.includes(
      "lightray"
    )
  ) {
    return {
      name:
        "Lightray",
      percent: 95
    };
  }

  // ---------------------------------------------------
  // Generic heavy obfuscation
  // ---------------------------------------------------

  const longHex =
    (
      text.match(
        /0x[0-9a-f]{6,}/gi
      ) || []
    ).length;

  const escaped =
    (
      text.match(
        /\\x[0-9a-f]{2}/gi
      ) || []
    ).length;

  const hugeTables =
    (
      text.match(
        /\{[^{}]{1000,}\}/g
      ) || []
    ).length;

  const loadCount =
    (
      lower.match(
        /loadstring/g
      ) || []
    ).length;

  let score = 0;

  if (
    longHex > 10
  ) {
    score += 25;
  }

  if (
    escaped > 20
  ) {
    score += 25;
  }

  if (
    hugeTables > 2
  ) {
    score += 20;
  }

  if (
    loadCount > 5
  ) {
    score += 15;
  }

  if (
    text.length > 100000
  ) {
    score += 10;
  }

  if (
    score >= 50
  ) {
    return {
      name:
        "Unknown / Custom Obfuscator",
      percent:
        Math.min(
          score,
          94
        )
    };
  }

  // ---------------------------------------------------
  // Unobfuscated
  // ---------------------------------------------------

  return {
    name:
      "Unobfuscated",
    percent: 99
  };
}

// =====================================================
// DETECT COMMAND
// =====================================================

async function handleDetectCommand(
  message
) {
  let file =
    getMessageFile(
      message
    );

  // ---------------------------------------------------
  // If no direct attachment, check replied message
  // ---------------------------------------------------

  if (!file) {
    file =
      await getReferencedFile(
        message
      );
  }

  // ---------------------------------------------------
  // No file
  // ---------------------------------------------------

  if (!file) {
    await message.reply({
      content:
        "❌ Reply to or upload a file with `.dt` / `.detect`.",
      allowedMentions: {
        repliedUser: true
      }
    });

    return;
  }

  // ---------------------------------------------------
  // Only source/text-like files
  // ---------------------------------------------------

  const filename =
    file.name.toLowerCase();

  const allowed =
    filename.endsWith(".txt") ||
    filename.endsWith(".lua") ||
    filename.endsWith(".js");

  if (!allowed) {
    await message.reply({
      content:
        "❌ Only `.txt`, `.lua`, or `.js` files can be detected.",
      allowedMentions: {
        repliedUser: true
      }
    });

    return;
  }

  // ---------------------------------------------------
  // Download
  // ---------------------------------------------------

  try {
    const response =
      await fetch(
        file.url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 FS-Bot"
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const arrayBuffer =
      await response.arrayBuffer();

    const buffer =
      Buffer.from(
        arrayBuffer
      );

    if (
      buffer.length >
      MAX_DOWNLOAD_SIZE
    ) {
      await message.reply({
        content:
          "❌ File is too large.",
        allowedMentions: {
          repliedUser: true
        }
      });

      return;
    }

    const content =
      buffer.toString(
        "utf8"
      );

    const detected =
      detectObfuscator(
        content,
        file.name
      );

    await message.reply({
      content:
        `**${detected.name} ( ${detected.percent}% )**`,
      allowedMentions: {
        repliedUser: true
      }
    });

  } catch (error) {
    console.error(
      "❌ Detection error:",
      error
    );

    await message.reply({
      content:
        "❌ I couldn't read that file.",
      allowedMentions: {
        repliedUser: true
      }
    });
  }
}

// =====================================================
// MESSAGE HANDLER
// =====================================================

client.on(
  "messageCreate",
  async message => {
    try {
      // Ignore bots
      if (
        message.author.bot
      ) {
        return;
      }

      // ------------------------------------------------
      // ONLY ALLOW THE CONFIGURED GUILD
      // ------------------------------------------------

      if (
        message.guildId &&
        message.guildId !==
          GUILD_ID
      ) {
        return;
      }

      const content =
        message.content.trim();

      // ------------------------------------------------
      // .get
      // ------------------------------------------------

      if (
        content === ".get" ||
        content.startsWith(
          ".get "
        )
      ) {
        const args =
          content
            .slice(4)
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        await handleGetCommand(
          message,
          args
        );

        return;
      }

      // ------------------------------------------------
      // .dt / .detect
      // ------------------------------------------------

      const lower =
        content.toLowerCase();

      if (
        lower === ".dt" ||
        lower === ".detect"
      ) {
        await handleDetectCommand(
          message
        );

        return;
      }

    } catch (error) {
      console.error(
        "❌ Message handler error:",
        error
      );
    }
  }
);

// =====================================================
// READY
// =====================================================

client.once(
  "ready",
  () => {
    console.log(
      "========================================"
    );

    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    console.log(
      `🏠 Allowed Guild ID: ${GUILD_ID}`
    );

    console.log(
      `📡 Connected to ${client.guilds.cache.size} server(s)`
    );

    console.log(
      "========================================"
    );

    // Warn if configured guild isn't cached
    if (
      !client.guilds.cache.has(
        GUILD_ID
      )
    ) {
      console.warn(
        "⚠️ GUILD_ID is not currently cached."
      );
    }
  }
);

// =====================================================
// DISCORD ERRORS
// =====================================================

client.on(
  "error",
  error => {
    console.error(
      "❌ Discord client error:",
      error
    );
  }
);

client.on(
  "warn",
  warning => {
    console.warn(
      "⚠️ Discord warning:",
      warning
    );
  }
);

// =====================================================
// PROCESS ERRORS
// =====================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled promise rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught exception:",
      error
    );
  }
);

// =====================================================
// LOGIN
// =====================================================

console.log(
  "🔑 Logging into Discord..."
);

client.login(
  TOKEN
).catch(
  error => {
    console.error(
      "❌ Discord login failed:",
      error
    );

    process.exit(1);
  }
);
