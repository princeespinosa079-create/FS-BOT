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
const PORT = process.env.PORT || 3000;

// ====================
// Render Web Server
// ====================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Discord Bot is online!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Web server running on port ${PORT}`);
});

// ====================
// Discord Bot
// ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const games = new Map();

const command = new SlashCommandBuilder()
  .setName("guessnumber")
  .setDescription("Start a Guess Number Game")
  .addIntegerOption(option =>
    option
      .setName("number")
      .setDescription("Maximum number from 1 to 10000")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(10000)
  );

// ====================
// Register Slash Command
// ====================

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Registering /guessnumber...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: [command.toJSON()]
      }
    );

    console.log("/guessnumber registered!");
  } catch (error) {
    console.error(error);
  }
})();

// ====================
// Bot Ready
// ====================

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);

  client.user.setActivity("Guess Number", {
    type: 0
  });
});

// ====================
// Interactions
// ====================

client.on("interactionCreate", async interaction => {

  // /guessnumber
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "guessnumber"
  ) {

    const maxNumber = interaction.options.getInteger("number");
    const host = interaction.user;

    const gameId =
      `${interaction.guildId}-${interaction.channelId}`;

    if (games.has(gameId)) {
      return interaction.reply({
        content: "❌ There is already a Guess Number game in this channel.",
        ephemeral: true
      });
    }

    games.set(gameId, {
      hostId: host.id,
      maxNumber: maxNumber,
      started: false,
      secret: null
    });

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle("GAME EVENT 🧧")
      .setDescription(
        `> **Host by <@${host.id}>**\n` +
        `> **Click \`Start Button\` below to start the Guess Number Game.**`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`guess_start_${gameId}`)
        .setLabel("Start")
        .setStyle(ButtonStyle.Primary)
    );

    // Hide the slash command response
    await interaction.deferReply({
      ephemeral: true
    });

    await interaction.deleteReply();

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });
  }

  // Start button
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("guess_start_")
  ) {

    const gameId =
      interaction.customId.replace("guess_start_", "");

    const game = games.get(gameId);

    if (!game) {
      return interaction.reply({
        content: "❌ This game no longer exists.",
        ephemeral: true
      });
    }

    if (game.started) {
      return interaction.reply({
        content: "❌ The game has already started!",
        ephemeral: true
      });
    }

    game.started = true;

    game.secret =
      Math.floor(Math.random() * game.maxNumber) + 1;

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle("GAME EVENT 🧧")
      .setDescription(
        `> **Guess Number Game Started!**\n\n` +
        `> **Host:** <@${game.hostId}>\n` +
        `> **Range:** \`1 - ${game.maxNumber}\`\n\n` +
        `**Send your number in this channel!**`
      );

    await interaction.update({
      embeds: [embed],
      components: []
    });
  }
});

// ====================
// Number Guessing
// ====================

client.on("messageCreate", async message => {

  if (message.author.bot) return;
  if (!message.guild) return;

  const gameId =
    `${message.guild.id}-${message.channel.id}`;

  const game = games.get(gameId);

  if (!game || !game.started) return;

  const content = message.content.trim();

  if (!/^\d+$/.test(content)) return;

  const guess = Number(content);

  if (guess < 1 || guess > game.maxNumber) return;

  if (guess === game.secret) {

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle("GAME EVENT 🧧")
      .setDescription(
        `> 🎉 **We have a winner!**\n\n` +
        `> **Winner:** <@${message.author.id}>\n` +
        `> **The number was:** \`${game.secret}\`\n` +
        `> **Host:** <@${game.hostId}>`
      );

    await message.channel.send({
      embeds: [embed]
    });

    games.delete(gameId);

  } else if (guess < game.secret) {

    await message.react("⬆️");

  } else {

    await message.react("⬇️");
  }
});

// ====================
// Login
// ====================

client.login(TOKEN);
