const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags
} = require("discord.js");

const express = require("express");

// ==================================================
// ENVIRONMENT
// ==================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 10000;

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID is missing.");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("❌ GUILD_ID is missing.");
  process.exit(1);
}

console.log("✅ Environment variables found.");

// ==================================================
// RENDER WEB SERVER
// ==================================================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("FS Bot is online!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ==================================================
// DISCORD CLIENT
// ==================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ==================================================
// GAME STORAGE
// ==================================================

const games = new Map();

// ==================================================
// EMBED COLORS
// ==================================================

const COLORS = {
  blue: 0x3498db,
  red: 0xe74c3c,
  green: 0x2ecc71,
  yellow: 0xf1c40f,
  orange: 0xe67e22,
  purple: 0x9b59b6,
  pink: 0xff69b4,
  cyan: 0x00ffff,
  aqua: 0x1abc9c,
  gold: 0xffd700,
  white: 0xffffff,
  gray: 0x808080,
  black: 0x000000
};

// ==================================================
// SLASH COMMANDS
// ==================================================

const guessNumberCommand = new SlashCommandBuilder()
  .setName("guessnumber")
  .setDescription("Start a Guess Number Game")
  .addIntegerOption(option =>
    option
      .setName("answer")
      .setDescription("Secret answer from 1 to 10000")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(10000)
  );

const embedCommand = new SlashCommandBuilder()
  .setName("embed")
  .setDescription("Create a custom embed")
  .addStringOption(option =>
    option
      .setName("title")
      .setDescription("Embed title")
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName("description")
      .setDescription("Embed description")
      .setRequired(false)
  )
  .addStringOption(option =>
    option
      .setName("color")
      .setDescription("Embed color")
      .setRequired(false)
      .addChoices(
        { name: "Blue", value: "blue" },
        { name: "Red", value: "red" },
        { name: "Green", value: "green" },
        { name: "Yellow", value: "yellow" },
        { name: "Orange", value: "orange" },
        { name: "Purple", value: "purple" },
        { name: "Pink", value: "pink" },
        { name: "Cyan", value: "cyan" },
        { name: "Aqua", value: "aqua" },
        { name: "Gold", value: "gold" },
        { name: "White", value: "white" },
        { name: "Gray", value: "gray" },
        { name: "Black", value: "black" }
      )
  );

const commands = [
  guessNumberCommand.toJSON(),
  embedCommand.toJSON()
];

// ==================================================
// REGISTER GUILD COMMANDS
// ==================================================

async function registerCommands() {
  try {
    console.log("🔄 Registering guild slash commands...");

    const rest = new REST({
      version: "10"
    }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: commands
      }
    );

    console.log("✅ Guild slash commands registered successfully.");
  } catch (error) {
    console.error("❌ Slash command registration failed:");
    console.error(error);
  }
}

// ==================================================
// DISCORD DEBUG
// ==================================================

client.on("debug", message => {
  console.log(`[Discord] ${message}`);
});

client.on("warn", message => {
  console.warn(`[Discord Warning] ${message}`);
});

client.on("error", error => {
  console.error("❌ Discord client error:");
  console.error(error);
});

client.on("shardError", error => {
  console.error("❌ Discord shard error:");
  console.error(error);
});

// ==================================================
// READY
// ==================================================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  console.log(
    `🏠 Connected to ${client.guilds.cache.size} server(s).`
  );

  await registerCommands();
});

// ==================================================
// INTERACTION HANDLER
// ==================================================

client.on("interactionCreate", async interaction => {

  // ==================================================
  // /GUESSNUMBER
  // ==================================================

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "guessnumber"
  ) {
    try {

      // ------------------------------------------------
      // ACKNOWLEDGE IMMEDIATELY
      // ------------------------------------------------

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      console.log(
        `📥 /guessnumber from ${interaction.user.tag}`
      );

      // ------------------------------------------------
      // GET ANSWER
      // ------------------------------------------------

      const answer =
        interaction.options.getInteger("answer");

      console.log(
        `🎯 Answer received: ${answer}`
      );

      if (
        answer === null ||
        answer < 1 ||
        answer > 10000
      ) {
        await interaction.editReply({
          content:
            "❌ Please provide an answer from 1 to 10000."
        });

        return;
      }

      // ------------------------------------------------
      // GAME ID
      // ------------------------------------------------

      const gameId =
        `${interaction.guildId}-${interaction.channelId}`;

      // ------------------------------------------------
      // CHECK EXISTING GAME
      // ------------------------------------------------

      if (games.has(gameId)) {
        await interaction.editReply({
          content:
            "❌ There is already a Guess Number game in this channel."
        });

        return;
      }

      // ------------------------------------------------
      // CREATE GAME
      // ------------------------------------------------

      games.set(gameId, {
        hostId: interaction.user.id,
        answer: answer,
        started: false
      });

      console.log(
        `💾 Game created: ${gameId}`
      );

      // ------------------------------------------------
      // RESPOND TO COMMAND
      // ------------------------------------------------

      await interaction.editReply({
        content: "✅ Game created!"
      });

      // ------------------------------------------------
      // DM ANSWER TO HOST
      // ------------------------------------------------

      const dmEmbed = new EmbedBuilder()
        .setColor(0x808080)
        .setDescription(
          `> 🔢 **Answer:** \`${answer}\`\n` +
          `> 📌 **Range:** \`1 - 10000\``
        );

      try {
        await interaction.user.send({
          embeds: [dmEmbed]
        });

        console.log(
          "📩 Answer sent to host DM."
        );
      } catch (error) {
        console.log(
          "⚠️ Could not send DM to host."
        );
      }

      // ------------------------------------------------
      // PUBLIC GAME EVENT
      // ------------------------------------------------

      const gameEmbed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle("GAME EVENT 🧧")
        .setDescription(
          `> **Host by <@${interaction.user.id}>**\n` +
          `> **Click \`Start Button\` below to start the Guess Number Game.**`
        );

      const startButton = new ButtonBuilder()
        .setCustomId(
          `guess_start_${gameId}`
        )
        .setLabel("Start")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder()
        .addComponents(startButton);

      await interaction.channel.send({
        embeds: [gameEmbed],
        components: [row]
      });

      console.log(
        "🎮 Public game event sent."
      );

    } catch (error) {

      console.error(
        "❌ /guessnumber error:"
      );

      console.error(error);

      // 10062 means Discord interaction expired.
      // DO NOT attempt another reply.
      if (
        error?.code === 10062 ||
        error?.rawError?.code === 10062
      ) {
        console.error(
          "⚠️ Interaction expired / Unknown interaction."
        );

        return;
      }

      // If already deferred, edit instead of reply.
      if (interaction.deferred) {
        try {
          await interaction.editReply({
            content:
              "❌ An error occurred while creating the game."
          });
        } catch (editError) {
          console.error(
            "❌ Could not edit interaction:"
          );
          console.error(editError);
        }
      }
    }

    return;
  }

  // ==================================================
  // /EMBED
  // ==================================================

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "embed"
  ) {
    try {

      // Immediate acknowledgement
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      const title =
        interaction.options.getString("title");

      const description =
        interaction.options.getString("description");

      const color =
        interaction.options.getString("color") ||
        "gray";

      // Current Philippines time
      const now =
        new Date().toLocaleTimeString(
          "en-PH",
          {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
          }
        );

      const embed = new EmbedBuilder()
        .setColor(
          COLORS[color] ?? COLORS.gray
        )
        .setFooter({
          text: `Today at ${now}`
        });

      if (title && title.trim()) {
        embed.setTitle(title);
      }

      if (
        description &&
        description.trim()
      ) {
        embed.setDescription(
          description
        );
      }

      await interaction.channel.send({
        embeds: [embed]
      });

      await interaction.editReply({
        content: "✅ Embed sent!"
      });

      console.log(
        "✅ /embed completed."
      );

    } catch (error) {

      console.error(
        "❌ /embed error:"
      );

      console.error(error);

      if (
        error?.code === 10062 ||
        error?.rawError?.code === 10062
      ) {
        return;
      }

      if (interaction.deferred) {
        try {
          await interaction.editReply({
            content:
              "❌ Could not create the embed."
          });
        } catch (editError) {
          console.error(editError);
        }
      }
    }

    return;
  }

  // ==================================================
  // START BUTTON
  // ==================================================

  if (
    interaction.isButton() &&
    interaction.customId.startsWith(
      "guess_start_"
    )
  ) {
    try {

      const gameId =
        interaction.customId.replace(
          "guess_start_",
          ""
        );

      const game =
        games.get(gameId);

      if (!game) {
        await interaction.reply({
          content:
            "❌ This game no longer exists.",
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------------------
      // HOST CHECK
      // ------------------------------------------------

      const isHost =
        interaction.user.id ===
        game.hostId;

      // ------------------------------------------------
      // MANAGE MESSAGES CHECK
      // ------------------------------------------------

      const canManageMessages =
        interaction.memberPermissions?.has(
          PermissionFlagsBits.ManageMessages
        ) === true;

      if (
        !isHost &&
        !canManageMessages
      ) {
        await interaction.reply({
          content:
            "❌ Only the **host** or members with **Manage Messages** permission can start this game.",
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------------------
      // ALREADY STARTED
      // ------------------------------------------------

      if (game.started) {
        await interaction.reply({
          content:
            "❌ The game has already started!",
          flags: MessageFlags.Ephemeral
        });

        return;
      }

      // ------------------------------------------------
      // ACKNOWLEDGE BUTTON IMMEDIATELY
      // ------------------------------------------------

      await interaction.deferUpdate();

      game.started = true;

      // ------------------------------------------------
      // START EMBED
      // ------------------------------------------------

      const startEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔓 **UNLOCK!**\n` +
            `> 🔢 **1 - 10000**\n` +
            `> 💀 **TRY TO WIN**`
          );

      await interaction.message.edit({
        embeds: [startEmbed],
        components: []
      });

      console.log(
        `🎮 Game started by ${interaction.user.tag}`
      );

    } catch (error) {

      console.error(
        "❌ Start button error:"
      );

      console.error(error);

      if (
        error?.code === 10062 ||
        error?.rawError?.code === 10062
      ) {
        return;
      }
    }

    return;
  }
});

// ==================================================
// NUMBER GUESSING
// ==================================================

client.on("messageCreate", async message => {

  if (message.author.bot) return;
  if (!message.guild) return;

  const gameId =
    `${message.guild.id}-${message.channel.id}`;

  const game =
    games.get(gameId);

  if (!game) return;
  if (!game.started) return;

  const content =
    message.content.trim();

  // Only numbers
  if (!/^\d+$/.test(content)) {
    return;
  }

  const guess =
    Number(content);

  // Only 1 - 10000
  if (
    guess < 1 ||
    guess > 10000
  ) {
    return;
  }

  try {

    // ==================================================
    // WINNER
    // ==================================================

    if (guess === game.answer) {

      const winEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔒 **LOCK!**\n` +
            `> 🎊 <@${message.author.id}> **WON!**\n` +
            `> ✅ **${guess}**`
          );

      await message.channel.send({
        embeds: [winEmbed]
      });

      console.log(
        `🏆 ${message.author.tag} WON with ${guess}.`
      );

      games.delete(gameId);

      return;
    }

    // ==================================================
    // YOU'RE SO CLOSE
    // ==================================================

    // 10% of the answer, minimum 10.
    // Example:
    // Answer 100  -> 10
    // Answer 500  -> 50
    // Answer 1000 -> 100
    // Answer 10000 -> 1000

    const closeDistance =
      Math.max(
        10,
        Math.floor(game.answer * 0.10)
      );

    const difference =
      Math.abs(
        game.answer - guess
      );

    if (
      difference <= closeDistance
    ) {

      const closeEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            "> 😱 **YOU’RE SO CLOSE BRO!**"
          );

      await message.reply({
        embeds: [closeEmbed]
      });

    }

  } catch (error) {

    console.error(
      "❌ Guess processing error:"
    );

    console.error(error);
  }
});

// ==================================================
// LOGIN
// ==================================================

console.log("🔑 Logging into Discord...");

client.login(TOKEN)
  .then(() => {
    console.log(
      "🔐 Discord login request completed."
    );
  })
  .catch(error => {
    console.error(
      "❌ Discord login failed:"
    );

    console.error(error);
  });

// ==================================================
// ERROR HANDLERS
// ==================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled rejection:"
    );

    console.error(error);
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught exception:"
    );

    console.error(error);
  }
);
