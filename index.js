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
  PermissionsBitField
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
  res.send("FS Bot is online.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// =========================
// Discord client
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =========================
// Game storage
// =========================

// One active game per channel
const games = new Map();

// =========================
// Slash commands
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Create a number guessing game.")
    .addIntegerOption(option =>
      option
        .setName("answer")
        .setDescription("The secret answer from 1 to 10000.")
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
// Register commands globally
// =========================

async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    console.log("🔄 Registering global commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log("✅ Global commands registered.");
  } catch (error) {
    console.error("❌ Command registration failed:", error);
  }
}

// =========================
// Ready
// =========================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 Servers: ${client.guilds.cache.size}`);

  await registerCommands();
});

// =========================
// Interaction handler
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

      // Save game for this channel
      games.set(interaction.channelId, {
        answer,
        hostId: interaction.user.id,
        active: false
      });

      // DM answer to host
      const answerEmbed = new EmbedBuilder()
        .setDescription(`🔢 **Answer:** \`${answer}\``)
        .setColor(0x808080);

      try {
        await interaction.user.send({
          embeds: [answerEmbed]
        });
      } catch (error) {
        await interaction.reply({
          content:
            "❌ I couldn't DM you. Please enable DMs from server members and try again.",
          ephemeral: true
        });

        games.delete(interaction.channelId);
        return;
      }

      // Public game panel
      const panelEmbed = new EmbedBuilder()
        .setTitle("GAME EVENT 🧧")
        .setDescription(
          "> **Click the** `Start Button` **to start the** `Game.`"
        )
        .setColor(0x808080);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("guess_start")
          .setLabel("Start")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.reply({
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
        .setColor(0x808080);

      if (title) {
        embed.setTitle(title);
      }

      await interaction.reply({
        embeds: [embed]
      });

      return;
    }

    // =========================
    // Start button
    // =========================

    if (
      interaction.isButton() &&
      interaction.customId === "guess_start"
    ) {
      const game = games.get(interaction.channelId);

      if (!game) {
        await interaction.reply({
          content: "❌ There is no active game in this channel.",
          ephemeral: true
        });
        return;
      }

      if (game.active) {
        await interaction.reply({
          content: "⚠️ The game has already started.",
          ephemeral: true
        });
        return;
      }

      game.active = true;

      // Unlock channel for normal members
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

      const gameEmbed = new EmbedBuilder()
        .setDescription(
          "> 🔓 **UNLOCK!**\n" +
          "> 🔢 **1 - 10000**\n" +
          "> 💀 **TRY TO WIN**"
        )
        .setColor(0x808080);

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
// Guess messages
// =========================

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;

    const game = games.get(message.channelId);

    if (!game || !game.active) return;

    // Only accept numbers
    const guess = Number(message.content.trim());

    if (!Number.isInteger(guess)) return;

    if (guess < 1 || guess > 10000) return;

    // =========================
    // Correct answer
    // =========================

    if (guess === game.answer) {

      const winEmbed = new EmbedBuilder()
        .setDescription(
          `> 🔒 **LOCK!**\n` +
          `> 🎊 <@${message.author.id}> **WON!**\n` +
          `> ✅ **${guess}**`
        )
        .setColor(0x808080);

      await message.channel.send({
        embeds: [winEmbed]
      });

      // Lock channel again
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

    // =========================
    // Wrong answer
    // =========================

    const difference = Math.abs(guess - game.answer);

    // ×10 distance
    const distance = difference * 10;

    const closeEmbed = new EmbedBuilder()
      .setDescription(
        `> 🔓\n` +
        `> 😱 **YOU'RE SO CLOSE BRO!**\n\n` +
        `> 📏 **${distance}** ×`
      )
      .setColor(0x808080);

    await message.channel.send({
      embeds: [closeEmbed]
    });

  } catch (error) {
    console.error("❌ Message error:", error);
  }
});

// =========================
// Errors
// =========================

client.on("error", error => {
  console.error("❌ Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("❌ Unhandled rejection:", error);
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
