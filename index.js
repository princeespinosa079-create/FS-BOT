const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const express = require("express");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

// =========================
// Web server
// =========================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot is online.");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    bot: client.user ? client.user.tag : "connecting"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// =========================
// Discord Client
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =========================
// Games
// =========================

const games = new Map();

// =========================
// Today at HH:MM
// =========================

function getTodayTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Manila"
  });
}

// =========================
// ONLY 2 SLASH COMMANDS
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Create a number guessing game.")
    .addIntegerOption(option =>
      option
        .setName("answer")
        .setDescription("Secret answer from 1 to 10000.")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a gray embed.")
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Embed description.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription("Embed title.")
        .setRequired(false)
    )
].map(command => command.toJSON());

// =========================
// Register Commands
// =========================

async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    console.log("🔄 Replacing global slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands
      }
    );

    console.log("✅ Registered only /guessnumber and /embed.");
  } catch (error) {
    console.error("❌ Failed to register commands:", error);
  }
}

// =========================
// Ready
// =========================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 Connected to ${client.guilds.cache.size} server(s).`);

  await registerCommands();
});

// =========================
// Interactions
// =========================

client.on("interactionCreate", async interaction => {
  try {

    // =========================
    // /guessnumber
    // =========================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "guessnumber"
    ) {
      const answer = interaction.options.getInteger("answer");

      // Prevent duplicate game in the same channel
      if (games.has(interaction.channelId)) {
        await interaction.reply({
          content: "⚠️ There is already a Guess Game in this channel.",
          ephemeral: true
        });

        return;
      }

      // Save game
      games.set(interaction.channelId, {
        answer,
        hostId: interaction.user.id,
        active: false
      });

      // =========================
      // DM answer to host
      // =========================

      const answerEmbed = new EmbedBuilder()
        .setDescription(`🔢 **Answer:** \`${answer}\``)
        .setColor(0x808080)
        .setFooter({
          text: `Today at ${getTodayTime()}`
        });

      try {
        await interaction.user.send({
          embeds: [answerEmbed]
        });
      } catch (error) {
        games.delete(interaction.channelId);

        await interaction.reply({
          content:
            "❌ I couldn't DM you. Please enable your Discord DMs and try again.",
          ephemeral: true
        });

        return;
      }

      // =========================
      // Acknowledge command silently
      // =========================

      await interaction.deferReply({
        ephemeral: true
      });

      await interaction.deleteReply();

      // =========================
      // ONLY ONE PUBLIC PANEL
      // =========================

      const panelEmbed = new EmbedBuilder()
        .setTitle("GAME EVENT 🧧")
        .setDescription(
          "> **Click the** `Start Button` **to start** `Guess Game`."
        )
        .setColor(0x808080)
        .setFooter({
          text: `Today at ${getTodayTime()}`
        });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("guess_start")
          .setLabel("Start")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({
        embeds: [panelEmbed],
        components: [row]
      });

      return;
    }

    // =========================
    // /embed
    // =========================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "embed"
    ) {
      const description =
        interaction.options.getString("description");

      const title =
        interaction.options.getString("title");

      const embed = new EmbedBuilder()
        .setDescription(description)
        .setColor(0x808080)
        .setFooter({
          text: `Today at ${getTodayTime()}`
        });

      if (title) {
        embed.setTitle(title);
      }

      await interaction.reply({
        embeds: [embed]
      });

      return;
    }

    // =========================
    // Start Button
    // =========================

    if (
      interaction.isButton() &&
      interaction.customId === "guess_start"
    ) {
      const game = games.get(interaction.channelId);

      if (!game) {
        await interaction.reply({
          content: "❌ There is no active guessing game.",
          ephemeral: true
        });

        return;
      }

      if (game.active) {
        await interaction.reply({
          content: "⚠️ The Guess Game has already started.",
          ephemeral: true
        });

        return;
      }

      game.active = true;

      // =========================
      // Unlock channel
      // =========================

      if (
        interaction.guild &&
        interaction.channel &&
        interaction.channel.permissionOverwrites
      ) {
        try {
          await interaction.channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            {
              SendMessages: true
            }
          );
        } catch (error) {
          console.error("⚠️ Could not unlock channel:", error);
        }
      }

      // =========================
      // Game Embed
      // =========================

      const gameEmbed = new EmbedBuilder()
        .setDescription(
          "> 🔓 **UNLOCK!**\n" +
          "> 🔢 **1 - 10000**\n" +
          "> 💀 **TRY TO WIN**"
        )
        .setColor(0x808080)
        .setFooter({
          text: `Today at ${getTodayTime()}`
        });

      await interaction.update({
        embeds: [gameEmbed],
        components: []
      });

      return;
    }

  } catch (error) {
    console.error("❌ Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ An error occurred.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// =========================
// Guess Number Messages
// =========================

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;

    const game = games.get(message.channelId);

    if (!game || !game.active) return;

    const guess = Number(message.content.trim());

    if (!Number.isInteger(guess)) return;

    if (guess < 1 || guess > 10000) return;

    // =========================
    // Correct Answer
    // =========================

    if (guess === game.answer) {

      const winEmbed = new EmbedBuilder()
        .setDescription(
          `> 🔒 **LOCK!**\n` +
          `> 🎊 <@${message.author.id}> **WON!**\n` +
          `> ✅ **${guess}**`
        )
        .setColor(0x808080)
        .setFooter({
          text: `Today at ${getTodayTime()}`
        });

      await message.channel.send({
        embeds: [winEmbed]
      });

      // =========================
      // Lock channel
      // =========================

      if (
        message.guild &&
        message.channel.permissionOverwrites
      ) {
        try {
          await message.channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
              SendMessages: false
            }
          );
        } catch (error) {
          console.error("⚠️ Could not lock channel:", error);
        }
      }

      games.delete(message.channelId);

      return;
    }

    // Wrong guesses intentionally get NO response.

  } catch (error) {
    console.error("❌ Message handling error:", error);
  }
});

// =========================
// Errors
// =========================

client.on("error", error => {
  console.error("❌ Discord client error:", error);
});

client.on("warn", warning => {
  console.warn("⚠️ Discord warning:", warning);
});

process.on("unhandledRejection", error => {
  console.error("❌ Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("❌ Uncaught exception:", error);
});

// =========================
// Login
// =========================

console.log("🔑 Logging into Discord...");

client.login(TOKEN).catch(error => {
  console.error("❌ Discord login failed:", error);
  process.exit(1);
});
