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
  ChannelType,
  AuditLogEvent
} = require("discord.js");

const express = require("express");

// =========================
// Environment Variables
// =========================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional — only used to clear old guild commands

const OWNER_ID = "1302080645987569694";

// =========================
// Required Environment Check
// =========================

if (!TOKEN || !CLIENT_ID) {
  console.error(
    "❌ Missing DISCORD_TOKEN or CLIENT_ID."
  );
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
    bot: client.user ? client.user.tag : "connecting",
    guilds: client.guilds?.cache?.size || 0
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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ]
});

// =========================
// Games
// =========================

const games = new Map();

// =========================
// Ping Warn System
// =========================

const pingWarnRoles = new Map();
const TEN_HOURS = 10 * 60 * 60 * 1000;

// =========================
// Anti-Nuke / Anti-Raid
// =========================

const antiNukeEnabled = new Map();
const antiNukeIgnoreRole = new Map();
const antiRaidEnabled = new Map();
const recentNukeCreates = new Map();

// =========================
// Role Mass Add Jobs
// =========================

const roleJobs = new Map();

// =========================
// Time helpers
// =========================

function getTodayTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Manila"
  });
}

function parseDuration(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim().toLowerCase();
  const match = s.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * mult[unit];
}

// =========================
// Slash Commands (GLOBAL)
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Create a number guessing game.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames.toString())
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames.toString())
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
    ),

  new SlashCommandBuilder()
    .setName("pingwarn")
    .setDescription(
      "When a role pings @everyone/@here, temporarily remove their ping permission for 10 hours."
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Turn the system ON or OFF for the role.")
        .setRequired(true)
        .addChoices(
          { name: "ON", value: "on" },
          { name: "OFF", value: "off" }
        )
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("The role that will be punished when it pings.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("spylist")
    .setDescription(
      "List spies/alts (name) and new accounts (created in last 20 days)."
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString()),

  new SlashCommandBuilder()
    .setName("antinuke")
    .setDescription(
      "Turn Anti-Nuke ON/OFF. Optional ignore role will never be banned."
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("ON or OFF")
        .setRequired(true)
        .addChoices(
          { name: "ON", value: "on" },
          { name: "OFF", value: "off" }
        )
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Role to ignore (leave blank = no ignore role).")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("antiraid")
    .setDescription(
      "Turn Anti-Raid ON or OFF (turns off external emojis/stickers in all channels)."
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("ON or OFF")
        .setRequired(true)
        .addChoices(
          { name: "ON", value: "on" },
          { name: "OFF", value: "off" }
        )
    ),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Add a role to a user or to everyone with a panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Add a role to one user (optional duration).")
        .addUserOption(o =>
          o.setName("user").setDescription("User to give the role.").setRequired(true)
        )
        .addRoleOption(o =>
          o.setName("role").setDescription("Role to add.").setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName("duration")
            .setDescription("e.g. 1h, 30m, 1d — leave blank for permanent.")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("all")
        .setDescription("Add a role to everyone (shows panel with Start/Stop).")
        .addRoleOption(o =>
          o.setName("role").setDescription("Role to add to all members.").setRequired(true)
        )
    ),

  // Owner only — at the bottom
  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("Show all servers where the bot is installed. (Owner only)"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Make the bot leave a server. (Owner only)")
    .addStringOption(option =>
      option
        .setName("server-id")
        .setDescription("The ID of the server to leave.")
        .setRequired(true)
    )
].map(c => c.toJSON());

// =========================
// Register Commands (GLOBAL)
// =========================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    // Delete old guild-only commands (if GUILD_ID still set)
    if (GUILD_ID) {
      console.log("🗑️ Clearing old guild-only commands...");
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: [] }
      );
      console.log("✅ Old guild commands deleted.");
    }

    // Also try clear guild commands for every server the bot is in
    for (const guild of client.guilds.cache.values()) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(CLIENT_ID, guild.id),
          { body: [] }
        );
      } catch {
        // ignore per-guild failures
      }
    }
    console.log("🗑️ Cleared guild commands in all joined servers.");

    // Register GLOBAL commands only
    console.log("🌍 Registering global slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands
    });
    console.log("✅ Global slash commands registered.");
  } catch (error) {
    console.error("❌ Command registration error:", error);
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
    // Owner only
    if (
      interaction.isChatInputCommand() &&
      (interaction.commandName === "serverlist" ||
        interaction.commandName === "leave")
    ) {
      if (interaction.user.id !== OWNER_ID) {
        await interaction.reply({
          content: "❌ Only the bot owner can use this command.",
          ephemeral: true
        });
        return;
      }
    }

    // Manage Nicknames / Messages
    if (
      interaction.isChatInputCommand() &&
      (interaction.commandName === "guessnumber" ||
        interaction.commandName === "embed")
    ) {
      if (
        !interaction.memberPermissions ||
        (!interaction.memberPermissions.has(PermissionFlagsBits.ManageNicknames) &&
          !interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages))
      ) {
        await interaction.reply({
          content:
            "❌ You need **Manage Nicknames** or **Manage Messages** to use this command.",
          ephemeral: true
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 2000);
        return;
      }
    }

    // Administrator
    if (
      interaction.isChatInputCommand() &&
      ["antinuke", "antiraid", "pingwarn", "spylist", "role"].includes(
        interaction.commandName
      )
    ) {
      if (
        !interaction.memberPermissions ||
        !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
      ) {
        await interaction.reply({
          content: "❌ You need **Administrator** permission.",
          ephemeral: true
        });
        return;
      }
    }

    // /serverlist
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "serverlist"
    ) {
      await interaction.deferReply({ ephemeral: true });
      const guilds = [...client.guilds.cache.values()];
      let description = `**Total Servers:** \`${guilds.length}\`\n\n`;
      if (guilds.length === 0) description += "No servers found.";

      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];
        let inviteLink = "Unavailable";
        try {
          const channel = guild.channels.cache.find(
            ch =>
              ch.isTextBased() &&
              ch.permissionsFor(guild.members.me)?.has(
                PermissionFlagsBits.CreateInstantInvite
              )
          );
          if (channel) {
            const invite = await channel.createInvite({
              maxAge: 0,
              maxUses: 0,
              unique: false,
              reason: "Server list invite"
            });
            inviteLink = invite.url;
          }
        } catch {
          inviteLink = "Unavailable";
        }
        description +=
          `**${i + 1}. ${guild.name}**\n` +
          `> **ID:** \`${guild.id}\`\n` +
          `> **Invite:** ${inviteLink}\n\n`;
      }

      const embed = new EmbedBuilder()
        .setTitle("SERVER LIST 📋")
        .setDescription(description.slice(0, 4000))
        .setColor(0x808080)
        .setFooter({ text: `Today at ${getTodayTime()}` });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // /leave
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "leave"
    ) {
      const serverId = interaction.options.getString("server-id").trim();
      const guild = client.guilds.cache.get(serverId);
      if (!guild) {
        await interaction.reply({
          content: `❌ I am not in a server with ID \`${serverId}\`.`,
          ephemeral: true
        });
        return;
      }
      const serverName = guild.name;
      try {
        await guild.leave();
        await interaction.reply({
          content: `✅ Successfully left **${serverName}** (\`${serverId}\`).`,
          ephemeral: true
        });
      } catch (error) {
        console.error("❌ Failed to leave server:", error);
        await interaction.reply({
          content: `❌ Failed to leave **${serverName}**.`,
          ephemeral: true
        });
      }
      return;
    }

    // /guessnumber
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "guessnumber"
    ) {
      const answer = interaction.options.getInteger("answer");
      if (games.has(interaction.channelId)) {
        await interaction.reply({
          content: "⚠️ There is already a Guess Game in this channel.",
          ephemeral: true
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 1500);
        return;
      }

      games.set(interaction.channelId, {
        answer,
        hostId: interaction.user.id,
        active: false
      });

      const answerEmbed = new EmbedBuilder()
        .setDescription(`🔢 **Answer:** \`${answer}\``)
        .setColor(0x808080);

      try {
        await interaction.user.send({ embeds: [answerEmbed] });
      } catch {
        games.delete(interaction.channelId);
        await interaction.reply({
          content:
            "❌ I couldn't DM you. Please enable your Discord DMs and try again.",
          ephemeral: true
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 2000);
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();

      const panelEmbed = new EmbedBuilder()
        .setTitle("GAME EVENT 🧧")
        .setDescription(
          `> **Host by:** <@${interaction.user.id}>\n` +
            `> **Click the** \`Start Button\` **to start** \`Guess Game\`.`
        )
        .setColor(0x808080);

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

    // /embed
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "embed"
    ) {
      const description = interaction.options.getString("description");
      const title = interaction.options.getString("title");
      const embed = new EmbedBuilder()
        .setDescription(description)
        .setColor(0x808080)
        .setFooter({ text: `Today at ${getTodayTime()}` });
      if (title) embed.setTitle(title);

      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();
      await interaction.channel.send({ embeds: [embed] });
      return;
    }

    // /pingwarn
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "pingwarn"
    ) {
      const mode = interaction.options.getString("mode");
      const role = interaction.options.getRole("role");
      if (!role) {
        await interaction.reply({ content: "❌ Role not found.", ephemeral: true });
        return;
      }

      const botMember = interaction.guild.members.me;
      if (!botMember || role.position >= botMember.roles.highest.position) {
        await interaction.reply({
          content: "❌ I cannot manage that role. Move my role higher.",
          ephemeral: true
        });
        return;
      }

      if (mode === "on") {
        const existing = pingWarnRoles.get(role.id);
        if (existing && existing.timeout) clearTimeout(existing.timeout);
        pingWarnRoles.set(role.id, {
          enabled: true,
          timeout: null,
          guildId: interaction.guildId
        });
        await interaction.reply({
          content:
            `✅ Ping Warn **ON** for **${role.name}**.\n` +
            `Mass ping → lose ping permission for 10 hours.`,
          ephemeral: true
        });
      } else {
        const existing = pingWarnRoles.get(role.id);
        if (existing && existing.timeout) clearTimeout(existing.timeout);
        pingWarnRoles.delete(role.id);
        try {
          await role.setPermissions(
            role.permissions.add(PermissionFlagsBits.MentionEveryone),
            "PingWarn OFF"
          );
        } catch {}
        await interaction.reply({
          content: `✅ Ping Warn **OFF** for **${role.name}**.`,
          ephemeral: true
        });
      }
      return;
    }

    // /spylist
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "spylist"
    ) {
      await interaction.deferReply({ ephemeral: true });

      try {
        await interaction.guild.members.fetch();
        const twentyDaysAgo = Date.now() - 20 * 24 * 60 * 60 * 1000;
        const spyAlt = [];
        const newAccounts = [];

        for (const member of interaction.guild.members.cache.values()) {
          if (member.user.bot) continue;
          const name = (
            member.user.username +
            " " +
            (member.nickname || "") +
            " " +
            (member.user.globalName || "")
          ).toLowerCase();
          const isAltOrSpy = name.includes("alt") || name.includes("spy");
          const isNew = member.user.createdTimestamp >= twentyDaysAgo;
          if (isAltOrSpy) spyAlt.push(member);
          if (isNew) newAccounts.push(member);
        }

        const embeds = [];

        if (spyAlt.length === 0) {
          embeds.push(
            new EmbedBuilder()
              .setTitle("SPY / ALT (LIST OF SPY AND ALT)")
              .setDescription("No members found with **alt** or **spy** in name/nickname.")
              .setColor(0x808080)
              .setFooter({ text: `Today at ${getTodayTime()}` })
          );
        } else {
          const list = spyAlt
            .map((m, i) => `**${i + 1}.** <@${m.id}> \`${m.user.tag}\``)
            .join("\n");
          embeds.push(
            new EmbedBuilder()
              .setTitle(`SPY / ALT (LIST OF SPY AND ALT) — ${spyAlt.length}`)
              .setDescription(list.slice(0, 4000))
              .setColor(0x808080)
              .setFooter({ text: `Today at ${getTodayTime()}` })
          );
        }

        if (newAccounts.length === 0) {
          embeds.push(
            new EmbedBuilder()
              .setTitle("NEW ACCOUNT LIST")
              .setDescription("No accounts created in the last **20 days**.")
              .setColor(0x808080)
              .setFooter({ text: `Today at ${getTodayTime()}` })
          );
        } else {
          const list = newAccounts
            .map((m, i) => {
              const daysOld = Math.floor(
                (Date.now() - m.user.createdTimestamp) / (1000 * 60 * 60 * 24)
              );
              return `**${i + 1}.** <@${m.id}> \`${m.user.tag}\` \`NEW ${daysOld}d\``;
            })
            .join("\n");
          embeds.push(
            new EmbedBuilder()
              .setTitle(`NEW ACCOUNT LIST — ${newAccounts.length}`)
              .setDescription(list.slice(0, 4000))
              .setColor(0x808080)
              .setFooter({ text: `Today at ${getTodayTime()}` })
          );
        }

        const allIds = [
          ...new Set([...spyAlt, ...newAccounts].map(m => m.id))
        ];

        await interaction.channel.send({
          embeds,
          allowedMentions: { users: allIds }
        });
        await interaction.deleteReply().catch(() => {});
      } catch (error) {
        console.error("❌ /spylist error:", error);
        await interaction
          .editReply({
            content: "❌ Failed to fetch members. Enable **Server Members Intent**."
          })
          .catch(() => {});
      }
      return;
    }

    // /antinuke
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "antinuke"
    ) {
      const mode = interaction.options.getString("mode");
      const ignoreRole = interaction.options.getRole("role");

      if (mode === "on") {
        antiNukeEnabled.set(interaction.guildId, true);
        if (ignoreRole) {
          antiNukeIgnoreRole.set(interaction.guildId, ignoreRole.id);
        } else {
          antiNukeIgnoreRole.delete(interaction.guildId);
        }
        await interaction.reply({
          content:
            `✅ **Anti-Nuke ON**\n` +
            `2 channel/role/category creates within **1 second** → ban.\n` +
            (ignoreRole
              ? `Ignore role: **${ignoreRole.name}**`
              : `No ignore role.`),
          ephemeral: true
        });
      } else {
        antiNukeEnabled.set(interaction.guildId, false);
        antiNukeIgnoreRole.delete(interaction.guildId);
        await interaction.reply({
          content: "✅ **Anti-Nuke OFF**.",
          ephemeral: true
        });
      }
      return;
    }

    // /antiraid
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "antiraid"
    ) {
      const mode = interaction.options.getString("mode");
      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild;
      let updated = 0;

      if (mode === "on") {
        antiRaidEnabled.set(guild.id, true);
        for (const channel of guild.channels.cache.values()) {
          if (!channel.isTextBased() || !channel.permissionOverwrites) continue;
          try {
            await channel.permissionOverwrites.edit(
              guild.roles.everyone,
              { UseExternalEmojis: false, UseExternalStickers: false },
              { reason: "Anti-Raid ON" }
            );
            updated++;
          } catch {}
        }
        await interaction.editReply({
          content: `✅ **Anti-Raid ON** — external emojis/stickers off in **${updated}** channels.`
        });
      } else {
        antiRaidEnabled.set(guild.id, false);
        for (const channel of guild.channels.cache.values()) {
          if (!channel.isTextBased() || !channel.permissionOverwrites) continue;
          try {
            await channel.permissionOverwrites.edit(
              guild.roles.everyone,
              { UseExternalEmojis: null, UseExternalStickers: null },
              { reason: "Anti-Raid OFF" }
            );
            updated++;
          } catch {}
        }
        await interaction.editReply({
          content: `✅ **Anti-Raid OFF** — restored in **${updated}** channels.`
        });
      }
      return;
    }

    // /role add
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "role" &&
      interaction.options.getSubcommand() === "add"
    ) {
      const user = interaction.options.getUser("user");
      const role = interaction.options.getRole("role");
      const durationStr = interaction.options.getString("duration");
      const durationMs = parseDuration(durationStr);

      const member = await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);
      if (!member) {
        await interaction.reply({
          content: "❌ Member not found.",
          ephemeral: true
        });
        return;
      }

      const botMember = interaction.guild.members.me;
      if (!botMember || role.position >= botMember.roles.highest.position) {
        await interaction.reply({
          content: "❌ I cannot manage that role.",
          ephemeral: true
        });
        return;
      }

      try {
        await member.roles.add(role, `Added by ${interaction.user.tag}`);
        let msg = `✅ Added **${role.name}** to <@${user.id}>.`;
        if (durationMs) {
          msg += ` Removes in **${durationStr}**.`;
          setTimeout(async () => {
            try {
              await member.roles.remove(role, "Temporary role expired");
            } catch {}
          }, durationMs);
        } else {
          msg += " (permanent)";
        }
        await interaction.reply({ content: msg, ephemeral: true });
      } catch {
        await interaction.reply({
          content: "❌ Failed to add role.",
          ephemeral: true
        });
      }
      return;
    }

    // /role all
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "role" &&
      interaction.options.getSubcommand() === "all"
    ) {
      const role = interaction.options.getRole("role");
      const botMember = interaction.guild.members.me;
      if (!botMember || role.position >= botMember.roles.highest.position) {
        await interaction.reply({
          content: "❌ I cannot manage that role.",
          ephemeral: true
        });
        return;
      }

      await interaction.guild.members.fetch().catch(() => {});
      const total = interaction.guild.members.cache.filter(
        m => !m.user.bot && !m.roles.cache.has(role.id)
      ).size;

      const estimatedSeconds = Math.ceil(total * 1.2);
      const estimatedMin = Math.floor(estimatedSeconds / 60);
      const estimatedSec = estimatedSeconds % 60;
      const timeStr =
        estimatedMin > 0
          ? `~${estimatedMin}m ${estimatedSec}s`
          : `~${estimatedSec}s`;

      const embed = new EmbedBuilder()
        .setTitle("ROLE ALL PANEL")
        .setDescription(
          `> **Role:** ${role}\n` +
            `> **Members to add:** \`${total}\`\n` +
            `> **Estimated time:** \`${timeStr}\`\n\n` +
            `Click **Start** to begin.\nClick **Stop** to cancel.`
        )
        .setColor(0x808080)
        .setFooter({ text: `Today at ${getTodayTime()}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`roleall_start_${role.id}`)
          .setLabel("Start")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`roleall_stop_${role.id}`)
          .setLabel("Stop")
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({ content: "Panel sent.", ephemeral: true });
      await interaction.channel.send({ embeds: [embed], components: [row] });
      return;
    }

    // Role all buttons
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id.startsWith("roleall_start_")) {
        if (
          !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        ) {
          await interaction.reply({
            content: "❌ Administrator only.",
            ephemeral: true
          });
          return;
        }

        const roleId = id.replace("roleall_start_", "");
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) {
          await interaction.reply({
            content: "❌ Role not found.",
            ephemeral: true
          });
          return;
        }

        if (roleJobs.get(interaction.guildId)?.running) {
          await interaction.reply({
            content: "⚠️ A job is already running.",
            ephemeral: true
          });
          return;
        }

        await interaction.deferUpdate();
        await interaction.guild.members.fetch().catch(() => {});
        const targets = [
          ...interaction.guild.members.cache
            .filter(m => !m.user.bot && !m.roles.cache.has(role.id))
            .values()
        ];

        roleJobs.set(interaction.guildId, {
          roleId,
          running: true,
          stopped: false,
          added: 0,
          total: targets.length
        });

        await interaction.message.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle("ROLE ALL — RUNNING")
              .setDescription(
                `> **Role:** ${role}\n> **Progress:** \`0 / ${targets.length}\`\n> Status: **Running...**`
              )
              .setColor(0x808080)
          ],
          components: interaction.message.components
        });

        for (const member of targets) {
          const job = roleJobs.get(interaction.guildId);
          if (!job || job.stopped) break;
          try {
            await member.roles.add(role, "Role all");
            job.added++;
          } catch {}
          if (job.added % 10 === 0 || job.added === targets.length) {
            await interaction.message
              .edit({
                embeds: [
                  new EmbedBuilder()
                    .setTitle("ROLE ALL — RUNNING")
                    .setDescription(
                      `> **Role:** ${role}\n> **Progress:** \`${job.added} / ${job.total}\`\n> Status: **Running...**`
                    )
                    .setColor(0x808080)
                ]
              })
              .catch(() => {});
          }
          await new Promise(r => setTimeout(r, 1200));
        }

        const finalJob = roleJobs.get(interaction.guildId);
        await interaction.message
          .edit({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  finalJob?.stopped ? "ROLE ALL — STOPPED" : "ROLE ALL — DONE"
                )
                .setDescription(
                  `> **Role:** ${role}\n> **Added:** \`${finalJob?.added || 0} / ${finalJob?.total || 0}\``
                )
                .setColor(0x808080)
            ],
            components: []
          })
          .catch(() => {});
        roleJobs.delete(interaction.guildId);
        return;
      }

      if (id.startsWith("roleall_stop_")) {
        if (
          !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        ) {
          await interaction.reply({
            content: "❌ Administrator only.",
            ephemeral: true
          });
          return;
        }
        const job = roleJobs.get(interaction.guildId);
        if (job && job.running) {
          job.stopped = true;
          await interaction.reply({
            content: "🛑 Stopping...",
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: "⚠️ No running job.",
            ephemeral: true
          });
        }
        return;
      }
    }

    // Guess start button
    if (interaction.isButton() && interaction.customId === "guess_start") {
      const game = games.get(interaction.channelId);
      if (!game) {
        await interaction.reply({
          content: "❌ No active guessing game.",
          ephemeral: true
        });
        return;
      }
      const isHost = interaction.user.id === game.hostId;
      const canManage =
        interaction.memberPermissions &&
        (interaction.memberPermissions.has(PermissionFlagsBits.ManageNicknames) ||
          interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages));
      if (!isHost && !canManage) {
        await interaction.reply({
          content: "❌ Only Host or staff can start.",
          ephemeral: true
        });
        return;
      }
      if (game.active) {
        await interaction.reply({
          content: "⚠️ Already started.",
          ephemeral: true
        });
        return;
      }
      game.active = true;
      if (
        interaction.guild &&
        interaction.channel?.permissionOverwrites
      ) {
        try {
          await interaction.channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            { SendMessages: true }
          );
        } catch {}
      }
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setDescription(
              "> 🔓 **UNLOCK!**\n> 🔢 **1 - 10000**\n> 💀 **TRY TO WIN**"
            )
            .setColor(0x808080)
        ],
        components: []
      });
      return;
    }
  } catch (error) {
    console.error("❌ Interaction error:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "❌ An error occurred.", ephemeral: true })
        .catch(() => {});
    }
  }
});

// =========================
// Anti-Nuke (2 creates in ~1s)
// =========================

async function handleNukeCreate(guild, auditType) {
  if (!antiNukeEnabled.get(guild.id)) return;

  try {
    const logs = await guild.fetchAuditLogs({ limit: 1, type: auditType });
    const entry = logs.entries.first();
    if (!entry) return;

    const executor = entry.executor;
    if (
      !executor ||
      executor.id === OWNER_ID ||
      executor.id === client.user?.id
    ) {
      return;
    }

    const ignoreRoleId = antiNukeIgnoreRole.get(guild.id);
    if (ignoreRoleId) {
      const member = await guild.members.fetch(executor.id).catch(() => null);
      if (member && member.roles.cache.has(ignoreRoleId)) return;
    }

    if (!recentNukeCreates.has(guild.id)) {
      recentNukeCreates.set(guild.id, new Map());
    }
    const guildMap = recentNukeCreates.get(guild.id);
    const now = Date.now();
    const key = executor.id;
    let data = guildMap.get(key) || { count: 0, first: now };
    if (now - data.first > 1000) {
      data = { count: 0, first: now };
    }
    data.count++;
    guildMap.set(key, data);

    if (data.count >= 2) {
      try {
        const member = await guild.members.fetch(executor.id).catch(() => null);
        if (member && member.bannable) {
          await member.ban({
            reason: "Anti-Nuke: mass channel/role/category create (2 in 1s)"
          });
          const logCh =
            guild.systemChannel ||
            guild.channels.cache.find(
              c =>
                c.isTextBased() &&
                c.permissionsFor(guild.members.me)?.has(
                  PermissionFlagsBits.SendMessages
                )
            );
          if (logCh) {
            await logCh
              .send({
                content: `🛡️ **Anti-Nuke** banned <@${executor.id}> for mass create (2+ in 1s).`
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        console.error("❌ Anti-Nuke ban failed:", err);
      }
      guildMap.delete(key);
    }
  } catch (err) {
    console.error("❌ Anti-Nuke error:", err.message);
  }
}

client.on("channelCreate", async channel => {
  if (!channel.guild) return;
  await handleNukeCreate(channel.guild, AuditLogEvent.ChannelCreate);
});

client.on("roleCreate", async role => {
  await handleNukeCreate(role.guild, AuditLogEvent.RoleCreate);
});

// =========================
// Messages
// =========================

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;

    // Ping Warn
    if (
      message.guild &&
      (message.mentions.everyone || message.content.includes("@here"))
    ) {
      const member = message.member;
      if (member) {
        for (const [roleId, data] of pingWarnRoles) {
          if (!data.enabled || data.guildId !== message.guildId) continue;
          if (!member.roles.cache.has(roleId)) continue;
          const role = message.guild.roles.cache.get(roleId);
          if (!role) continue;
          if (role.permissions.has(PermissionFlagsBits.MentionEveryone)) {
            try {
              await role.setPermissions(
                role.permissions.remove(PermissionFlagsBits.MentionEveryone),
                `PingWarn: ${message.author.tag}`
              );
              if (data.timeout) clearTimeout(data.timeout);
              const timeout = setTimeout(async () => {
                try {
                  const currentRole = message.guild.roles.cache.get(roleId);
                  if (currentRole) {
                    await currentRole.setPermissions(
                      currentRole.permissions.add(
                        PermissionFlagsBits.MentionEveryone
                      ),
                      "PingWarn: 10h passed"
                    );
                  }
                } catch {}
                const current = pingWarnRoles.get(roleId);
                if (current) current.timeout = null;
              }, TEN_HOURS);
              data.timeout = timeout;
              pingWarnRoles.set(roleId, data);
              await message.channel
                .send({
                  content:
                    `⚠️ **Ping Warn**\nRole **${role.name}** lost ping for **10 hours** because <@${message.author.id}> mass pinged.`,
                  allowedMentions: { users: [message.author.id] }
                })
                .catch(() => {});
            } catch {}
          }
          break;
        }
      }
    }

    // Guess game
    const game = games.get(message.channelId);
    if (game && game.active) {
      const guess = Number(message.content.trim());
      if (Number.isInteger(guess) && guess >= 1 && guess <= 10000) {
        if (guess === game.answer) {
          await message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setDescription(
                  `> 🔒 **LOCK!**\n> 🎊 <@${message.author.id}> **WON!**\n> ✅ **${guess}**`
                )
                .setColor(0x808080)
            ]
          });
          if (message.guild && message.channel.permissionOverwrites) {
            try {
              await message.channel.permissionOverwrites.edit(
                message.guild.roles.everyone,
                { SendMessages: false }
              );
            } catch {}
          }
          games.delete(message.channelId);
        }
        return;
      }
    }
  } catch (error) {
    console.error("❌ Message handler error:", error);
  }
});

// =========================
// Errors
// =========================

client.on("error", error => console.error("❌ Discord client error:", error));
client.on("warn", warning => console.warn("⚠️ Discord warning:", warning));
process.on("unhandledRejection", error =>
  console.error("❌ Unhandled promise rejection:", error)
);
process.on("uncaughtException", error =>
  console.error("❌ Uncaught exception:", error)
);

// =========================
// Login
// =========================

console.log("🔑 Logging into Discord...");
client.login(TOKEN).catch(error => {
  console.error("❌ Discord login failed:", error);
  process.exit(1);
});
