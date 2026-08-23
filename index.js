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
const PORT = process.env.PORT || 3000;

// ====================
// Render Web Server
// ====================

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("Discord Bot is online!");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "online" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Web server running on port ${PORT}`);
});

// ====================
// Discord Client
// ====================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const games = new Map();
const whitelistedUsers = new Set();
const whitelistedRoles = new Set();

// ====================
// Slash Commands
// ====================

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
    .setName("whitelist")
    .setDescription("Add or remove a user or role from the whitelist")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to whitelist")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Role to whitelist")
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Add or Remove")
        .setRequired(true)
        .addChoices(
          { name: "Add", value: "add" },
          { name: "Remove", value: "remove" }
        )
    )
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log("Slash commands registered!");
  } catch (error) {
    console.error("Command registration error:", error);
  }
})();

// ====================
// Auto Status
// ====================

function updateStatus() {
  if (!client.user) return;

  const serverCount = client.guilds.cache.size;

  client.user.setActivity(
    `You •  ${serverCount} Server${serverCount === 1 ? "" : "s"}`,
    {
      type: 3
    }
  );
}

// ====================
// Bot Ready
// ====================

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);

  updateStatus();

  setInterval(updateStatus, 5 * 60 * 1000);
});

client.on("guildCreate", updateStatus);
client.on("guildDelete", updateStatus);

// ====================
// Interactions
// ====================

client.on("interactionCreate", async interaction => {

  // ====================
  // /guessnumber
  // ====================

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "guessnumber"
  ) {

    const answer =
      interaction.options.getInteger("answer");

    const host = interaction.user;

    const gameId =
      `${interaction.guildId}-${interaction.channelId}`;

    if (games.has(gameId)) {
      return interaction.reply({
        content:
          "❌ There is already a Guess Number game in this channel.",
        ephemeral: true
      });
    }

    games.set(gameId, {
      hostId: host.id,
      answer: answer,
      started: false
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

    // No visible slash-command response
    await interaction.deferReply({ ephemeral: true });
    await interaction.deleteReply();

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });
  }

  // ====================
  // /whitelist
  // ====================

  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "whitelist"
  ) {

    const user =
      interaction.options.getUser("user");

    const role =
      interaction.options.getRole("role");

    const mode =
      interaction.options.getString("mode");

    if (!user && !role) {
      return interaction.reply({
        content:
          "❌ You must provide a **user** or **role**.",
        ephemeral: true
      });
    }

    const action =
      mode === "add"
        ? "added to"
        : "removed from";

    if (user) {
      if (mode === "add") {
        whitelistedUsers.add(user.id);
      } else {
        whitelistedUsers.delete(user.id);
      }
    }

    if (role) {
      if (mode === "add") {
        whitelistedRoles.add(role.id);
      } else {
        whitelistedRoles.delete(role.id);
      }
    }

    const targets = [];

    if (user) {
      targets.push(`<@${user.id}>`);
    }

    if (role) {
      targets.push(`<@&${role.id}>`);
    }

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle("WHITELIST")
      .setDescription(
        `> ✅ ${targets.join(" and ")} **${action} the whitelist.**`
      );

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  // ====================
  // Start Button
  // ====================

  if (
    interaction.isButton() &&
    interaction.customId.startsWith("guess_start_")
  ) {

    const gameId =
      interaction.customId.replace("guess_start_", "");

    const game = games.get(gameId);

    if (!game) {
      return interaction.reply({
        content:
          "❌ This game no longer exists.",
        ephemeral: true
      });
    }

    // Host can start
    const isHost =
      interaction.user.id === game.hostId;

    // Manage Messages can start
    const canManageMessages =
      interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
      );

    if (!isHost && !canManageMessages) {
      return interaction.reply({
        content:
          "❌ Only the **host** or members with **Manage Messages** permission can start this game.",
        ephemeral: true
      });
    }

    if (game.started) {
      return interaction.reply({
        content:
          "❌ The game has already started!",
        ephemeral: true
      });
    }

    game.started = true;

    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setDescription(
        `> 🔓 **UNLOCK!**\n` +
        `> 🔢 **1 - 10000**\n` +
        `> 💀 **TRY TO WIN**`
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

  const content =
    message.content.trim();

  // Only numbers
  if (!/^\d+$/.test(content)) return;

  const guess = Number(content);

  // Only 1 - 10000
  if (guess < 1 || guess > 10000) {
    return;
  }

  // ====================
  // CORRECT ANSWER
  // ====================

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

  // ====================
  // DISTANCE
  // ====================

  const difference =
    Math.abs(game.answer - guess);

  // 50 or less away
  if (difference <= 50) {

    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x808080)
          .setDescription(
            `> 😱 **YOU’RE SO CLOSE BRO!**`
          )
      ]
    });
  }

  // 51 - 100 away
  if (difference <= 100) {

    if (guess < game.answer) {

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              `> 💀 **HIGHER**`
            )
        ]
      });

    } else {

      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x808080)
            .setDescription(
              `> 🤝 **LOWER BRO!**`
            )
        ]
      });
    }
  }

  // More than 100 away = no response
});

// ====================
// Error Handling
// ====================

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

// ====================
// Login
// ====================

client.login(TOKEN);
