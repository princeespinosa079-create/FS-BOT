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
// Web server for Render
// =========================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("FS Bot is online.");
});

app.get("/health", (req, res) => {
  res.json({
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
  intents: [GatewayIntentBits.Guilds]
});

// =========================
// Slash Commands
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Start a number guessing game.")
    .addIntegerOption(option =>
      option
        .setName("answer")
        .setDescription("The number to guess.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10000)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Create a custom embed.")
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
    .addStringOption(option =>
      option
        .setName("color")
        .setDescription("Embed color, e.g. #00FF00")
        .setRequired(false)
    )
].map(command => command.toJSON());

// =========================
// Register Commands
// =========================

async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    console.log("🔄 Registering slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log("✅ Slash commands registered.");
  } catch (error) {
    console.error("❌ Command registration failed:", error);
  }
}

// =========================
// Bot Ready
// =========================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 Servers: ${client.guilds.cache.size}`);

  await registerCommands();
});

// =========================
// Commands
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {

    // =========================
    // /guessnumber
    // =========================

    if (interaction.commandName === "guessnumber") {
      const suppliedAnswer = interaction.options.getInteger("answer");

      const answer =
        suppliedAnswer ||
        Math.floor(Math.random() * 10000) + 1;

      await interaction.reply(
`> 🔓 **UNLOCK!**
> 🔢 **1 - 10000**
> 💀 **TRY TO WIN**

> 😱 **YOU'RE SO CLOSE BRO!**

> 🔢 **Answer:** \`${answer}\`
> 📌 **Range:** \`1 - 10000\`

> 🔒 **LOCK!**
> 🎊 <@${interaction.user.id}> **WON!**
> ✅ **${answer}**`
      );

      console.log(
        `🎯 ${interaction.user.tag} started guessnumber. Answer: ${answer}`
      );

      return;
    }

    // =========================
    // /embed
    // =========================

    if (interaction.commandName === "embed") {
      const description =
        interaction.options.getString("description");

      const title =
        interaction.options.getString("title");

      let color =
        interaction.options.getString("color") || "#00FFFF";

      if (!/^#?[0-9A-Fa-f]{6}$/.test(color)) {
        color = "#00FFFF";
      }

      if (!color.startsWith("#")) {
        color = `#${color}`;
      }

      const embed = new EmbedBuilder()
        .setDescription(description)
        .setColor(color)
        .setTimestamp();

      if (title) {
        embed.setTitle(title);
      }

      await interaction.reply({
        embeds: [embed]
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
// Error Handling
// =========================

client.on("error", error => {
  console.error("❌ Discord error:", error);
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
  console.error("❌ Login failed:", error);
  process.exit(1);
});
