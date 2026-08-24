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
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

// =========================
// Web Server
// =========================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot is online.");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "online",
    bot: client?.user?.tag || "connecting"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// =========================
// Discord Client
// =========================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// =========================
// Slash Commands
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
// Register GLOBAL Commands
// No GUILD_ID needed
// =========================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    console.log("🔄 Registering global slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands
      }
    );

    console.log("✅ Global slash commands registered.");
  } catch (error) {
    console.error("❌ Command registration failed:");
    console.error(error);
  }
}

// =========================
// Bot Ready
// =========================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 Connected to ${client.guilds.cache.size} server(s).`);

  await registerCommands();
});

// =========================
// Commands
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`📥 Received /${interaction.commandName}`);

  // GUESS NUMBER
  if (interaction.commandName === "guessnumber") {
    try {
      // Acknowledge immediately.
      await interaction.deferReply();

      const answer = Math.floor(Math.random() * 100) + 1;

      await interaction.editReply(
        `🎯 Guess a number between **1 and 100**!\n\n` +
        `🔢 The answer is **${answer}**.`
      );

      console.log(`🎯 Generated answer: ${answer}`);
    } catch (error) {
      console.error("❌ /guessnumber error:", error);
    }

    return;
  }

  // EMBED
  if (interaction.commandName === "embed") {
    try {
      await interaction.deferReply();

      const embed = new EmbedBuilder()
        .setTitle("FS Bot")
        .setDescription("✅ The bot is working correctly!")
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed]
      });
    } catch (error) {
      console.error("❌ /embed error:", error);
    }

    return;
  }
});

// =========================
// Discord Events
// =========================

client.on("error", error => {
  console.error("❌ Discord client error:", error);
});

client.on("warn", warning => {
  console.warn("⚠️ Discord warning:", warning);
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
  console.error("❌ Discord login failed:");
  console.error(error);
  process.exit(1);
});
