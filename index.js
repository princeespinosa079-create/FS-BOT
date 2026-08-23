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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing environment variables.");
  process.exit(1);
}

// ==============================
// Render Web Server
// ==============================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("FS Bot Online");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "online" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ==============================
// Discord
// ==============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const games = new Map();

// ==============================
// Commands
// ==============================

const commands = [
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Start a Guess Number Game")
    .addIntegerOption(option =>
      option
        .setName("answer")
        .setDescription("Secret answer from 1 to 10000")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Create an embed")
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
          { name: "Gold", value: "gold" },
          { name: "White", value: "white" },
          { name: "Gray", value: "gray" },
          { name: "Black", value: "black" }
        )
    )
].map(x => x.toJSON());

// ==============================
// Register Commands
// ==============================

async function registerCommands() {
  try {
    const rest = new REST({ version: "10" })
      .setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: commands
      }
    );

    console.log("✅ Slash commands registered.");
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
  console.log(
    `✅ Logged in as ${client.user.tag}`
  );

  await registerCommands();
});

// ==============================
// INTERACTIONS
// ==============================

client.on("interactionCreate", async interaction => {

  console.log(
    `📥 Interaction received: ${
      interaction.isChatInputCommand()
        ? interaction.commandName
        : interaction.type
    }`
  );

  // ==============================
  // GUESSNUMBER
  // ==============================

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "guessnumber"
  ) {

    const answer =
      interaction.options.getInteger("answer");

    console.log(
      `🎯 Answer received: ${answer}`
    );

    // RESPOND IMMEDIATELY
    try {

      await interaction.reply({
        content: "✅ Command received!",
        ephemeral: true
      });

      console.log(
        "✅ Discord interaction acknowledged."
      );

    } catch (error) {

      console.error(
        "❌ REPLY FAILED:",
        error
      );

      return;
    }

    // Everything below happens AFTER Discord has received response

    const gameId =
      `${interaction.guildId}-${interaction.channelId}`;

    if (games.has(gameId)) {
      await interaction.editReply({
        content:
          "❌ There is already a game in this channel."
      });
      return;
    }

    games.set(gameId, {
      hostId: interaction.user.id,
      answer: answer,
      started: false
    });

    // DM host
    try {

      const dm = new EmbedBuilder()
        .setColor(0x808080)
        .setDescription(
          `> 🔢 **Answer:** \`${answer}\`\n` +
          `> 📌 **Range:** \`1 - 10000\``
        );

      await interaction.user.send({
        embeds: [dm]
      });

    } catch (error) {
      console.log(
        "⚠️ Could not DM host."
      );
    }

    // Public embed
    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle("GAME EVENT 🧧")
      .setDescription(
        `> **Host by <@${interaction.user.id}>**\n` +
        `> **Click \`Start Button\` below to start the Guess Number Game.**`
      );

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `guess_start_${gameId}`
          )
          .setLabel("Start")
          .setStyle(ButtonStyle.Primary)
      );

    try {

      await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });

      await interaction.editReply({
        content: " "
      });

    } catch (error) {

      console.error(
        "❌ Could not send game:",
        error
      );
    }

    return;
  }

  // ==============================
  // EMBED
  // ==============================

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "embed"
  ) {

    const title =
      interaction.options.getString("title");

    const description =
      interaction.options.getString("description");

    const color =
      interaction.options.getString("color") || "gray";

    const colors = {
      blue: 0x3498DB,
      red: 0xE74C3C,
      green: 0x2ECC71,
      yellow: 0xF1C40F,
      orange: 0xE67E22,
      purple: 0x9B59B6,
      pink: 0xFF69B4,
      cyan: 0x00FFFF,
      gold: 0xFFD700,
      white: 0xFFFFFF,
      gray: 0x808080,
      black: 0x000000
    };

    const embed = new EmbedBuilder()
      .setColor(colors[color] || 0x808080)
      .setFooter({
        text: `Today at ${new Date().toLocaleTimeString(
          "en-PH",
          {
            hour: "2-digit",
            minute: "2-digit"
          }
        )}`
      });

    if (title) {
      embed.setTitle(title);
    }

    if (description) {
      embed.setDescription(description);
    }

    try {
      await interaction.reply({
        embeds: [embed]
      });

      console.log(
        "✅ /embed responded."
      );

    } catch (error) {
      console.error(
        "❌ /embed error:",
        error
      );
    }

    return;
  }

  // ==============================
  // START BUTTON
  // ==============================

  if (
    interaction.isButton() &&
    interaction.customId.startsWith(
      "guess_start_"
    )
  ) {

    const gameId =
      interaction.customId.replace(
        "guess_start_",
        ""
      );

    const game =
      games.get(gameId);

    if (!game) {
      return interaction.reply({
        content:
          "❌ This game no longer exists.",
        ephemeral: true
      });
    }

    const isHost =
      interaction.user.id === game.hostId;

    const canManage =
      interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
      );

    if (!isHost && !canManage) {
      return interaction.reply({
        content:
          "❌ Only the host or a member with Manage Messages can start.",
        ephemeral: true
      });
    }

    if (game.started) {
      return interaction.reply({
        content:
          "❌ Game already started.",
        ephemeral: true
      });
    }

    try {
      await interaction.deferUpdate();
    } catch (error) {
      console.error(
        "❌ Button error:",
        error
      );
      return;
    }

    game.started = true;

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setDescription(
        `> 🔓 **UNLOCK!**\n` +
        `> 🔢 **1 - 10000**\n` +
        `> 💀 **TRY TO WIN**`
      );

    await interaction.message.edit({
      embeds: [embed],
      components: []
    });

    return;
  }
});

// ==============================
// Guessing
// ==============================

client.on("messageCreate", async message => {

  if (message.author.bot) return;
  if (!message.guild) return;

  const gameId =
    `${message.guild.id}-${message.channel.id}`;

  const game =
    games.get(gameId);

  if (!game || !game.started) return;

  const content =
    message.content.trim();

  if (!/^\d+$/.test(content)) return;

  const guess =
    Number(content);

  if (
    guess < 1 ||
    guess > 10000
  ) return;

  // WIN
  if (guess === game.answer) {

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setDescription(
        `> 🔒 **LOCK!**\n` +
        `> 🎊 <@${message.author.id}> **WON!**\n` +
        `> ✅ **${guess}**`
      );

    await message.channel.send({
      embeds: [embed]
    });

    games.delete(gameId);

    return;
  }

  // CLOSE
  const difference =
    Math.abs(game.answer - guess);

  const closeRange =
    Math.max(
      1,
      Math.floor(game.answer * 0.10)
    );

  if (difference <= closeRange) {

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setDescription(
        "> 😱 **YOU’RE SO CLOSE BRO!**"
      );

    await message.reply({
      embeds: [embed]
    });
  }
});

// ==============================
// ERRORS
// ==============================

client.on("error", error => {
  console.error(
    "❌ Discord error:",
    error
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
// LOGIN
// ==============================

console.log("🔑 Logging into Discord...");

client.login(TOKEN);
