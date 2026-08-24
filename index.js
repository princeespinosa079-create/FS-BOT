const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

const express = require("express");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID environment variable.");
  process.exit(1);
}

// =========================
// Web server for hosting
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
// Discord client
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

// =========================
// Slash commands
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Start a number guessing game."),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a simple embed.")
].map(command => command.toJSON());

// =========================
// Register commands globally
// No GUILD_ID required
// =========================

async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    console.log("🔄 Registering global slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log("✅ Global slash commands registered.");
  } catch (error) {
    console.error("❌ Failed to register commands:");
    console.error(error);
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
// Interaction handler
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`📥 Interaction received: /${interaction.commandName}`);

  try {
    // IMPORTANT:
    // Discord requires an interaction response
    // within a few seconds.

    if (interaction.commandName === "guessnumber") {
      const answer = Math.floor(Math.random() * 100) + 1;

      await interaction.reply({
        content: `🎯 Guess a number between **1 and 100**!\n\nThe answer is **${answer}**.`,
        ephemeral: false
      });

      console.log(`🎯 Answer generated: ${answer}`);
      return;
    }

    if (interaction.commandName === "embed") {
      const embed = new EmbedBuilder()
        .setTitle("FS Bot")
        .setDescription("✅ The bot is working correctly!")
        .setTimestamp();

      await interaction.reply({
        embeds: [embed]
      });

      return;
    }

  } catch (error) {
    console.error("❌ Interaction error:", error);

    // Don't attempt another initial reply if
    // Discord already received one.
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: "❌ An error occurred while processing the command.",
          ephemeral: true
        });
      } catch (replyError) {
        console.error("❌ Could not send error reply:", replyError);
      }
    }
  }
});

// =========================
// Discord errors
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
  console.error("❌ Discord login failed:");
  console.error(error);
  process.exit(1);
});
