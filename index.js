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
  PermissionFlagsBits
} = require("discord.js");

const express = require("express");

// ==============================
// Environment
// ==============================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 10000;

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID is missing.");
  process.exit(1);
}

console.log("✅ Environment variables found.");

// ==============================
// Render Web Server
// ==============================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("FS Bot is online!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    discord: client?.isReady?.() ? "connected" : "connecting"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ==============================
// Discord Client
// ==============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ==============================
// Games
// ==============================

const games = new Map();

// ==============================
// Slash Command
// ==============================

const guessNumberCommand =
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Start a Guess Number Game")
    .addIntegerOption(option =>
      option
        .setName("answer")
        .setDescription("The correct answer from 1 to 10000")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
    );

const rest = new REST({ version: "10" }).setToken(TOKEN);

// ==============================
// Register Commands
// ==============================

async function registerCommands() {
  try {
    console.log("🔄 Registering /guessnumber...");

    const command = guessNumberCommand.toJSON();

    const guilds = [...client.guilds.cache.values()];

    if (guilds.length === 0) {
      console.log("⚠️ Bot is not connected to any server yet.");
      return;
    }

    for (const guild of guilds) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(
            CLIENT_ID,
            guild.id
          ),
          {
            body: [command]
          }
        );

        console.log(
          `✅ /guessnumber registered in: ${guild.name}`
        );
      } catch (error) {
        console.error(
          `❌ Failed to register in ${guild.name}:`,
          error.message
        );
      }
    }

    console.log("✅ Command registration finished.");
  } catch (error) {
    console.error(
      "❌ Command registration error:",
      error
    );
  }
}

// ==============================
// Ready
// ==============================

client.once("ready", async () => {
  console.log("=================================");
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(
    `🏠 Connected to ${client.guilds.cache.size} server(s).`
  );
  console.log("🚫 Custom Watching status disabled.");
  console.log("=================================");

  await registerCommands();
});

// ==============================
// New Server
// ==============================

client.on("guildCreate", async guild => {
  console.log(`➕ Joined server: ${guild.name}`);

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        guild.id
      ),
      {
        body: [guessNumberCommand.toJSON()]
      }
    );

    console.log(
      `✅ /guessnumber registered in ${guild.name}`
    );
  } catch (error) {
    console.error(
      "❌ Guild command registration error:",
      error.message
    );
  }
});

// ==============================
// Interaction Handler
// ==============================

client.on("interactionCreate", async interaction => {
  try {

    // ==================================
    // /guessnumber
    // ==================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "guessnumber"
    ) {

      // IMPORTANT:
      // Respond immediately so Discord doesn't
      // return "The application did not respond".
      await interaction.deferReply({
        ephemeral: true
      });

      const answer =
        interaction.options.getInteger("answer");

      const host = interaction.user;

      if (
        !Number.isInteger(answer) ||
        answer < 1 ||
        answer > 10000
      ) {
        return await interaction.editReply({
          content:
            "❌ Please provide an answer from **1 to 10000**."
        });
      }

      if (!interaction.guild) {
        return await interaction.editReply({
          content:
            "❌ This command can only be used inside a server."
        });
      }

      const gameId =
        `${interaction.guild.id}-${interaction.channel.id}`;

      if (games.has(gameId)) {
        return await interaction.editReply({
          content:
            "❌ There is already a Guess Number game in this channel."
        });
      }

      // ==================================
      // Save Game
      // ==================================

      games.set(gameId, {
        hostId: host.id,
        answer: answer,
        started: false,
        guildId: interaction.guild.id,
        channelId: interaction.channel.id
      });

      console.log(
        `🎯 New game | Host: ${host.tag} | Answer: ${answer}`
      );

      // ==================================
      // DM Host
      // ==================================

      try {
        const dmEmbed = new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔢 **Answer:** \`${answer}\`\n` +
            `> 📌 **Range:** \`1 - 10000\``
          );

        await host.send({
          embeds: [dmEmbed]
        });

        console.log("📩 Answer sent to host DM.");
      } catch (dmError) {
        console.error(
          "⚠️ Could not DM host:",
          dmError.message
        );
      }

      // ==================================
      // Public Game Embed
      // ==================================

      const publicEmbed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle("GAME EVENT 🧧")
        .setDescription(
          `> **Host by <@${host.id}>**\n` +
          `> **Click \`Start\` below to start the Guess Number Game.**\n\n` +
          `> 📌 **Range:** \`1 - 10000\``
        )
        .setTimestamp();

      const row =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`guess_start:${gameId}`)
            .setLabel("Start")
            .setEmoji("▶️")
            .setStyle(ButtonStyle.Secondary)
        );

      // ==================================
      // Send Public Game
      // ==================================

      await interaction.channel.send({
        embeds: [publicEmbed],
        components: [row]
      });

      // ==================================
      // Finish Interaction
      // ==================================

      await interaction.editReply({
        content:
          "✅ Guess Number game created!"
      });

      console.log("🎮 Public game event sent.");

      return;
    }

    // ==================================
    // Start Button
    // ==================================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("guess_start:")
    ) {

      // Immediately acknowledge button interaction.
      await interaction.deferUpdate();

      const gameId =
        interaction.customId.substring(
          "guess_start:".length
        );

      const game = games.get(gameId);

      if (!game) {
        return;
      }

      // ==================================
      // Permission
      // ==================================

      const isHost =
        interaction.user.id === game.hostId;

      const canManageMessages =
        interaction.memberPermissions?.has(
          PermissionFlagsBits.ManageMessages
        );

      if (!isHost && !canManageMessages) {

        const deniedEmbed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              "> ❌ **Only the host or members with Manage Messages can start this game.**"
            );

        try {
          await interaction.followUp({
            embeds: [deniedEmbed],
            ephemeral: true
          });
        } catch (error) {
          console.error(
            "❌ Could not send permission response:",
            error.message
          );
        }

        return;
      }

      // ==================================
      // Already Started
      // ==================================

      if (game.started) {
        const alreadyEmbed =
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              "> ❌ **This game has already started.**"
            );

        try {
          await interaction.followUp({
            embeds: [alreadyEmbed],
            ephemeral: true
          });
        } catch (error) {
          console.error(
            "❌ Could not send already-started response:",
            error.message
          );
        }

        return;
      }

      // ==================================
      // Start Game
      // ==================================

      game.started = true;

      const startedEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔓 **UNLOCK!**\n` +
            `> 🔢 **1 - 10000**\n` +
            `> 🎯 **GUESS THE NUMBER!**`
          )
          .setTimestamp();

      try {
        await interaction.editReply({
          embeds: [startedEmbed],
          components: []
        });
      } catch (error) {
        console.error(
          "❌ Could not update start button:",
          error.message
        );
      }

      console.log(
        `🎮 Game started by ${interaction.user.tag}`
      );

      return;
    }

  } catch (error) {

    console.error(
      "❌ Interaction error:",
      error
    );

    // Do NOT try to reply again if the interaction
    // has already expired/been acknowledged.
    try {
      if (
        interaction.isRepliable() &&
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          content:
            "❌ Something went wrong. Please try again.",
          ephemeral: true
        });
      }
    } catch (replyError) {
      console.error(
        "❌ Could not send error response:",
        replyError.message
      );
    }
  }
});

// ==============================
// Number Guessing
// ==============================

client.on("messageCreate", async message => {
  try {

    if (message.author.bot) return;
    if (!message.guild) return;

    const gameId =
      `${message.guild.id}-${message.channel.id}`;

    const game = games.get(gameId);

    if (!game) return;
    if (!game.started) return;

    const content =
      message.content.trim();

    // Only accept whole numbers
    if (!/^\d+$/.test(content)) {
      return;
    }

    const guess = Number(content);

    if (
      guess < 1 ||
      guess > 10000
    ) {
      return;
    }

    // ==================================
    // Correct Answer
    // ==================================

    if (guess === game.answer) {

      const winnerEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 🔒 **LOCK!**\n` +
            `> 🎊 <@${message.author.id}> **WON!**\n` +
            `> ✅ **${guess}**`
          )
          .setTimestamp();

      await message.channel.send({
        embeds: [winnerEmbed]
      });

      console.log(
        `🏆 ${message.author.tag} won with ${guess}.`
      );

      games.delete(gameId);

      return;
    }

    // ==================================
    // Close Hint
    // ==================================

    const difference =
      Math.abs(guess - game.answer);

    // Within 100 = close
    if (difference <= 100) {

      const closeEmbed =
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            "> 😱 **YOU’RE SO CLOSE BRO!**"
          );

      await message.reply({
        embeds: [closeEmbed]
      });

      return;
    }

  } catch (error) {
    console.error(
      "❌ Guess handling error:",
      error.message
    );
  }
});

// ==============================
// Discord Errors
// ==============================

client.on("error", error => {
  console.error(
    "❌ Discord client error:",
    error
  );
});

client.on("warn", warning => {
  console.warn(
    "⚠️ Discord warning:",
    warning
  );
});

process.on("unhandledRejection", error => {
  console.error(
    "❌ Unhandled rejection:",
    error
  );
});

process.on("uncaughtException", error => {
  console.error(
    "❌ Uncaught exception:",
    error
  );
});

// ==============================
// Login
// ==============================

console.log("🔑 Logging into Discord...");

client.login(TOKEN)
  .then(() => {
    console.log("🔐 Discord login request completed.");
  })
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );
    process.exit(1);
  });
