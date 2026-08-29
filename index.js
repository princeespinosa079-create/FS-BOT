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
  AuditLogEvent
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const path = require("path");

// =========================
// Environment
// =========================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional — clear old guild cmds

const OWNER_ID = "1302080645987569694";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

// =========================
// Persist settings across redeploy
// =========================

const DATA_FILE = path.join(__dirname, "bot-data.json");

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("⚠️ Failed to load bot-data.json:", e.message);
  }
  return {
    antiNuke: {},
    antiNukeIgnore: {},
    antiRaid: {},
    pingWarn: {}
  };
}

function saveData() {
  try {
    const data = {
      antiNuke: Object.fromEntries(antiNukeEnabled),
      antiNukeIgnore: Object.fromEntries(antiNukeIgnoreRole),
      antiRaid: Object.fromEntries(antiRaidEnabled),
      pingWarn: Object.fromEntries(
        [...pingWarnRoles.entries()].map(([k, v]) => [
          k,
          {
            enabled: v.enabled,
            guildId: v.guildId,
            durationMs: v.durationMs
          }
        ])
      )
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("⚠️ Failed to save bot-data.json:", e.message);
  }
}

const saved = loadData();

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
// State
// =========================

const games = new Map();

const pingWarnRoles = new Map(
  Object.entries(saved.pingWarn || {}).map(([k, v]) => [
    k,
    { enabled: v.enabled, timeout: null, guildId: v.guildId, durationMs: v.durationMs ?? null }
  ])
);

const antiNukeEnabled = new Map(
  Object.entries(saved.antiNuke || {}).map(([k, v]) => [k, !!v])
);
const antiNukeIgnoreRole = new Map(
  Object.entries(saved.antiNukeIgnore || {})
);
const antiRaidEnabled = new Map(
  Object.entries(saved.antiRaid || {}).map(([k, v]) => [k, !!v])
);
const recentNukeCreates = new Map();
const webhookSpamTracker = new Map();
const roleJobs = new Map();

// =========================
// Helpers
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
  // support "1h", "30m", "1h 30m", "90m"
  let total = 0;
  const parts = s.match(/(\d+)\s*(s|m|h|d)/g);
  if (!parts) return null;
  for (const p of parts) {
    const m = p.match(/(\d+)\s*(s|m|h|d)/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    total += n * mult[m[2]];
  }
  return total > 0 ? total : null;
}

function formatDuration(ms) {
  if (!ms) return "permanent";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// =========================
// Slash Commands (GLOBAL)
// =========================

const commands = [
  new SlashCommandBuilder()
    .setName("guessnumber")
    .setDescription("Create a number guessing game.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addIntegerOption(o =>
      o
        .setName("answer")
        .setDescription("Secret answer from 1 to 10000.")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a gray embed.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addStringOption(o =>
      o.setName("description").setDescription("Embed description.").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("title").setDescription("Embed title.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show Anti-Nuke, Anti-Raid, and Ping Warn status.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString()),

  new SlashCommandBuilder()
    .setName("ghostping")
    .setDescription("Ghost ping @everyone or @here (sends then deletes instantly).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addStringOption(o =>
      o
        .setName("mention")
        .setDescription("@everyone or @here")
        .setRequired(true)
        .addChoices(
          { name: "@everyone", value: "everyone" },
          { name: "@here", value: "here" }
        )
    ),

  new SlashCommandBuilder()
    .setName("pingwarn")
    .setDescription(
      "When a role pings @everyone/@here, temporarily remove their ping permission."
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles.toString())
    .addStringOption(o =>
      o
        .setName("mode")
        .setDescription("ON or OFF")
        .setRequired(true)
        .addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" })
    )
    .addRoleOption(o =>
      o
        .setName("role")
        .setDescription("Role that gets punished when it mass pings.")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("duration")
        .setDescription("e.g. 1h, 30m, 1h 30m — leave blank = permanent (no auto restore).")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("spylist")
    .setDescription("List spies/alts and new accounts (last 20 days).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString()),

  new SlashCommandBuilder()
    .setName("antinuke")
    .setDescription("Turn Anti-Nuke ON/OFF. Optional ignore role.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .addStringOption(o =>
      o
        .setName("mode")
        .setDescription("ON or OFF")
        .setRequired(true)
        .addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" })
    )
    .addRoleOption(o =>
      o
        .setName("role")
        .setDescription("Role to ignore (leave blank = none).")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("antiraid")
    .setDescription(
      "Turn Anti-Raid ON/OFF (external emojis off + delete spam webhooks)."
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .addStringOption(o =>
      o
        .setName("mode")
        .setDescription("ON or OFF")
        .setRequired(true)
        .addChoices({ name: "ON", value: "on" }, { name: "OFF", value: "off" })
    ),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Add a role to a user or to everyone.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles.toString())
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Add a role to one user (optional duration).")
        .addUserOption(o =>
          o.setName("user").setDescription("User").setRequired(true)
        )
        .addRoleOption(o =>
          o.setName("role").setDescription("Role").setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName("duration")
            .setDescription("e.g. 1h, 30m — blank = permanent.")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("all")
        .setDescription("Add a role to everyone (panel with Start/Stop).")
        .addRoleOption(o =>
          o.setName("role").setDescription("Role for everyone.").setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("serverlist")
    .setDescription("Show all servers. (Owner only)"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave a server. (Owner only)")
    .addStringOption(o =>
      o.setName("server-id").setDescription("Server ID").setRequired(true)
    )
].map(c => c.toJSON());

// =========================
// Register (global + clear guild)
// =========================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: []
      });
      console.log("🗑️ Cleared old guild commands (GUILD_ID).");
    }
    for (const guild of client.guilds.cache.values()) {
      try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guild.id), {
          body: []
        });
      } catch {}
    }
    console.log("🗑️ Cleared guild commands in all servers.");

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Global slash commands registered (persist across redeploy).");
  } catch (error) {
    console.error("❌ Command registration error:", error);
  }
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 ${client.guilds.cache.size} server(s).`);
  await registerCommands();
});

// =========================
// Interactions
// =========================

client.on("interactionCreate", async interaction => {
  try {
    // Owner
    if (
      interaction.isChatInputCommand() &&
      (interaction.commandName === "serverlist" ||
        interaction.commandName === "leave")
    ) {
      if (interaction.user.id !== OWNER_ID) {
        await interaction.reply({
          content: "❌ Owner only.",
          ephemeral: true
        });
        return;
      }
    }

    // Permission checks by command
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      const perms = interaction.memberPermissions;

      const need = {
        guessnumber: PermissionFlagsBits.ManageMessages,
        embed: PermissionFlagsBits.ManageMessages,
        status: PermissionFlagsBits.ManageMessages,
        ghostping: PermissionFlagsBits.ManageMessages,
        pingwarn: PermissionFlagsBits.ManageRoles,
        role: PermissionFlagsBits.ManageRoles,
        spylist: PermissionFlagsBits.Administrator,
        antinuke: PermissionFlagsBits.Administrator,
        antiraid: PermissionFlagsBits.Administrator
      };

      if (need[name] && (!perms || !perms.has(need[name]))) {
        const labels = {
          [PermissionFlagsBits.ManageMessages]: "Manage Messages",
          [PermissionFlagsBits.ManageRoles]: "Manage Roles",
          [PermissionFlagsBits.Administrator]: "Administrator"
        };
        await interaction.reply({
          content: `❌ You need **${labels[need[name]]}**.`,
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
      for (let i = 0; i < guilds.length; i++) {
        const guild = guilds[i];
        let inviteLink = "Unavailable";
        try {
          const ch = guild.channels.cache.find(
            c =>
              c.isTextBased() &&
              c.permissionsFor(guild.members.me)?.has(
                PermissionFlagsBits.CreateInstantInvite
              )
          );
          if (ch) {
            const inv = await ch.createInvite({
              maxAge: 0,
              maxUses: 0,
              unique: false
            });
            inviteLink = inv.url;
          }
        } catch {}
        description += `**${i + 1}. ${guild.name}**\n> **ID:** \`${guild.id}\`\n> **Invite:** ${inviteLink}\n\n`;
      }
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("SERVER LIST 📋")
            .setDescription(description.slice(0, 4000) || "None")
            .setColor(0x808080)
            .setFooter({ text: `Today at ${getTodayTime()}` })
        ]
      });
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
          content: `❌ Not in \`${serverId}\`.`,
          ephemeral: true
        });
        return;
      }
      const name = guild.name;
      try {
        await guild.leave();
        await interaction.reply({
          content: `✅ Left **${name}**.`,
          ephemeral: true
        });
      } catch {
        await interaction.reply({
          content: `❌ Failed to leave **${name}**.`,
          ephemeral: true
        });
      }
      return;
    }

    // /status
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "status"
    ) {
      const gid = interaction.guildId;
      const nukeOn = !!antiNukeEnabled.get(gid);
      const raidOn = !!antiRaidEnabled.get(gid);

      // Any pingwarn role for this guild?
      let pingOn = false;
      for (const [, v] of pingWarnRoles) {
        if (v.enabled && v.guildId === gid) {
          pingOn = true;
          break;
        }
      }

      const embed = new EmbedBuilder()
        .setTitle("COMMAND STATUS")
        .setDescription(
          `**Anti Nuke**\n${nukeOn ? "✅ ON" : "❌ OFF"}\n\n` +
            `**Anti Raid**\n${raidOn ? "✅ ON" : "❌ OFF"}\n\n` +
            `**Ping Warn**\n${pingOn ? "✅ ON" : "❌ OFF"}`
        )
        .setColor(0x808080)
        .setFooter({ text: `Today at ${getTodayTime()}` });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // /ghostping
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "ghostping"
    ) {
      const mention = interaction.options.getString("mention");
      const content =
        mention === "everyone" ? "@everyone" : "@here";

      await interaction.reply({
        content: "✅ Ghost ping sent.",
        ephemeral: true
      });

      try {
        const msg = await interaction.channel.send({
          content,
          allowedMentions: {
            parse: mention === "everyone" ? ["everyone"] : ["everyone"]
          }
        });
        // Delete instantly (ghost)
        await msg.delete().catch(() => {});
      } catch (err) {
        console.error("❌ Ghostping failed:", err.message);
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
          content: "⚠️ Game already in this channel.",
          ephemeral: true
        });
        return;
      }
      games.set(interaction.channelId, {
        answer,
        hostId: interaction.user.id,
        active: false
      });
      try {
        await interaction.user.send({
          embeds: [
            new EmbedBuilder()
              .setDescription(`🔢 **Answer:** \`${answer}\``)
              .setColor(0x808080)
          ]
        });
      } catch {
        games.delete(interaction.channelId);
        await interaction.reply({
          content: "❌ Enable DMs.",
          ephemeral: true
        });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply();
      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("GAME EVENT 🧧")
            .setDescription(
              `> **Host by:** <@${interaction.user.id}>\n> **Click Start** to begin Guess Game.`
            )
            .setColor(0x808080)
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("guess_start")
              .setLabel("Start")
              .setStyle(ButtonStyle.Success)
          )
        ]
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
      const durationStr = interaction.options.getString("duration");
      const durationMs = parseDuration(durationStr);

      if (!role) {
        await interaction.reply({
          content: "❌ Role not found.",
          ephemeral: true
        });
        return;
      }

      const botMember = interaction.guild.members.me;
      if (!botMember || role.position >= botMember.roles.highest.position) {
        await interaction.reply({
          content: "❌ Move my role above that role.",
          ephemeral: true
        });
        return;
      }

      if (mode === "on") {
        const existing = pingWarnRoles.get(role.id);
        if (existing?.timeout) clearTimeout(existing.timeout);

        pingWarnRoles.set(role.id, {
          enabled: true,
          timeout: null,
          guildId: interaction.guildId,
          durationMs // null = permanent
        });
        saveData();

        await interaction.reply({
          content:
            `✅ Ping Warn **ON** for **${role.name}**.\n` +
            `Duration after mass ping: **${formatDuration(durationMs)}**.`,
          ephemeral: true
        });
      } else {
        const existing = pingWarnRoles.get(role.id);
        if (existing?.timeout) clearTimeout(existing.timeout);
        pingWarnRoles.delete(role.id);
        saveData();
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

    // /spylist — newest accounts first; spy/alt + new in embeds
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
          if (name.includes("alt") || name.includes("spy")) spyAlt.push(member);
          if (member.user.createdTimestamp >= twentyDaysAgo) {
            newAccounts.push(member);
          }
        }

        // Newest account first (highest createdTimestamp)
        newAccounts.sort(
          (a, b) => b.user.createdTimestamp - a.user.createdTimestamp
        );

        const embeds = [];

        // SPY / ALT embed (includes note if also new)
        if (spyAlt.length === 0) {
          embeds.push(
            new EmbedBuilder()
              .setTitle("SPY / ALT (LIST OF SPY AND ALT)")
              .setDescription("No members with **alt** or **spy** in name.")
              .setColor(0x808080)
              .setFooter({ text: `Today at ${getTodayTime()}` })
          );
        } else {
          const list = spyAlt
            .map((m, i) => {
              const daysOld = Math.floor(
                (Date.now() - m.user.createdTimestamp) / 86400000
              );
              const newTag =
                m.user.createdTimestamp >= twentyDaysAgo
                  ? ` \`NEW ${daysOld}d\``
                  : "";
              return `**${i + 1}.** <@${m.id}> \`${m.user.tag}\`${newTag}`;
            })
            .join("\n");
          embeds.push(
            new EmbedBuilder()
              .setTitle(`SPY / ALT (LIST OF SPY AND ALT) — ${spyAlt.length}`)
              .setDescription(list.slice(0, 4000))
              .setColor(0x808080)
              .setFooter({ text: `Today at ${getTodayTime()}` })
          );
        }

        // NEW ACCOUNT LIST — newest at top
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
                (Date.now() - m.user.createdTimestamp) / 86400000
              );
              return `**${i + 1}.** <@${m.id}> \`${m.user.tag}\` \`NEW ${daysOld}d\``;
            })
            .join("\n");
          embeds.push(
            new EmbedBuilder()
              .setTitle(`NEW ACCOUNT LIST — ${newAccounts.length}`)
              .setDescription(list.slice(0, 4000))
              .setColor(0x808080)
              .setFooter({
                text: `Newest at top · Today at ${getTodayTime()}`
              })
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
        console.error("❌ /spylist:", error);
        await interaction
          .editReply({
            content: "❌ Failed. Enable **Server Members Intent**."
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
        saveData();
        await interaction.reply({
          content:
            `✅ **Anti-Nuke ON**\n2 creates in ~1s → ban.\n` +
            (ignoreRole
              ? `Ignore: **${ignoreRole.name}**`
              : `No ignore role.`),
          ephemeral: true
        });
      } else {
        antiNukeEnabled.set(interaction.guildId, false);
        antiNukeIgnoreRole.delete(interaction.guildId);
        saveData();
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
        saveData();
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
          content:
            `✅ **Anti-Raid ON**\nExternal emojis/stickers off in **${updated}** channels.\n` +
            `Webhook spam: **2 messages in 1.5s** → webhook deleted.`
        });
      } else {
        antiRaidEnabled.set(guild.id, false);
        saveData();
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
          content: "❌ Cannot manage that role.",
          ephemeral: true
        });
        return;
      }
      try {
        await member.roles.add(role, `By ${interaction.user.tag}`);
        let msg = `✅ Added **${role.name}** to <@${user.id}>.`;
        if (durationMs) {
          msg += ` Removes in **${formatDuration(durationMs)}**.`;
          setTimeout(async () => {
            try {
              await member.roles.remove(role, "Temp role expired");
            } catch {}
          }, durationMs);
        } else msg += " (permanent)";
        await interaction.reply({ content: msg, ephemeral: true });
      } catch {
        await interaction.reply({
          content: "❌ Failed.",
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
          content: "❌ Cannot manage that role.",
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
            `> **Members:** \`${total}\`\n` +
            `> **Estimated:** \`${timeStr}\`\n\n` +
            `**Start** to begin · **Stop** deletes panel & cancels.`
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

    // Buttons
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id.startsWith("roleall_start_")) {
        if (
          !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)
        ) {
          await interaction.reply({
            content: "❌ Manage Roles required.",
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
            content: "⚠️ Already running.",
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
                `> **Role:** ${role}\n> **Progress:** \`0 / ${targets.length}\``
              )
              .setColor(0x808080)
          ]
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
                      `> **Role:** ${role}\n> **Progress:** \`${job.added} / ${job.total}\``
                    )
                    .setColor(0x808080)
                ]
              })
              .catch(() => {});
          }
          await new Promise(r => setTimeout(r, 1200));
        }
        const finalJob = roleJobs.get(interaction.guildId);
        if (finalJob && !finalJob.stopped) {
          await interaction.message
            .edit({
              embeds: [
                new EmbedBuilder()
                  .setTitle("ROLE ALL — DONE")
                  .setDescription(
                    `> **Role:** ${role}\n> **Added:** \`${finalJob.added} / ${finalJob.total}\``
                  )
                  .setColor(0x808080)
              ],
              components: []
            })
            .catch(() => {});
        }
        roleJobs.delete(interaction.guildId);
        return;
      }

      if (id.startsWith("roleall_stop_")) {
        if (
          !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)
        ) {
          await interaction.reply({
            content: "❌ Manage Roles required.",
            ephemeral: true
          });
          return;
        }
        const job = roleJobs.get(interaction.guildId);
        if (job && job.running) job.stopped = true;
        await interaction.message.delete().catch(() => {});
        await interaction.reply({
          content: "🛑 Stopped — panel deleted.",
          ephemeral: true
        });
        return;
      }

      if (id === "guess_start") {
        const game = games.get(interaction.channelId);
        if (!game) {
          await interaction.reply({
            content: "❌ No game.",
            ephemeral: true
          });
          return;
        }
        const isHost = interaction.user.id === game.hostId;
        const can =
          interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageMessages
          );
        if (!isHost && !can) {
          await interaction.reply({
            content: "❌ Host or Manage Messages only.",
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
        try {
          await interaction.channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            { SendMessages: true }
          );
        } catch {}
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
    }
  } catch (error) {
    console.error("❌ Interaction error:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "❌ Error.", ephemeral: true })
        .catch(() => {});
    }
  }
});

// =========================
// Anti-Nuke
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
    )
      return;

    const ignoreRoleId = antiNukeIgnoreRole.get(guild.id);
    if (ignoreRoleId) {
      const member = await guild.members.fetch(executor.id).catch(() => null);
      if (member?.roles.cache.has(ignoreRoleId)) return;
    }

    if (!recentNukeCreates.has(guild.id)) {
      recentNukeCreates.set(guild.id, new Map());
    }
    const guildMap = recentNukeCreates.get(guild.id);
    const now = Date.now();
    let data = guildMap.get(executor.id) || { count: 0, first: now };
    if (now - data.first > 1000) data = { count: 0, first: now };
    data.count++;
    guildMap.set(executor.id, data);

    if (data.count >= 2) {
      const member = await guild.members.fetch(executor.id).catch(() => null);
      // Confidence: 2 actions in 1s from audit log = high
      const confidence = Math.min(99, 70 + data.count * 10);

      if (member?.bannable) {
        await member.ban({
          reason: "Anti-Nuke: 2 creates in 1s"
        });
      }

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
            content:
              `🛡️ **Anti-Nuke** — mass create stopped.\n` +
              `**Nuke by:** <@${executor.id}> (**${confidence}%**)` +
              (member?.bannable ? `\nBanned.` : `\nCould not ban (role hierarchy).`),
            allowedMentions: { users: [executor.id] }
          })
          .catch(() => {});
      }
      guildMap.delete(executor.id);
    }
  } catch (err) {
    console.error("❌ Anti-Nuke:", err.message);
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
    // Anti-Raid: webhook spam — 2 messages in 1.5s → delete spam msgs + webhook
    if (
      message.webhookId &&
      message.guild &&
      antiRaidEnabled.get(message.guildId)
    ) {
      const wid = message.webhookId;
      const now = Date.now();
      let data = webhookSpamTracker.get(wid);
      if (!data || now - data.first > 1500) {
        data = { count: 0, first: now, msgIds: [] };
      }
      data.count++;
      data.msgIds.push(message.id);
      webhookSpamTracker.set(wid, data);

      if (data.count >= 2) {
        webhookSpamTracker.delete(wid);
        try {
          // Delete spam messages (webhook chat)
          if (message.channel.bulkDelete) {
            await message.channel
              .bulkDelete(data.msgIds, true)
              .catch(async () => {
                for (const id of data.msgIds) {
                  await message.channel.messages
                    .delete(id)
                    .catch(() => {});
                }
              });
          }

          const webhooks = await message.channel.fetchWebhooks();
          const hook = webhooks.get(wid);

          // Predict raider: webhook owner, or audit log WebhookCreate
          let raiderId = hook?.owner?.id || null;
          let confidence = raiderId ? 85 : 40;

          if (!raiderId) {
            try {
              const logs = await message.guild.fetchAuditLogs({
                limit: 5,
                type: AuditLogEvent.WebhookCreate
              });
              const entry = logs.entries.find(
                e => e.target?.id === wid || e.targetId === wid
              );
              if (entry?.executor) {
                raiderId = entry.executor.id;
                confidence = 90;
              }
            } catch {}
          }

          if (hook) {
            await hook.delete(
              "Anti-Raid: webhook spam (2 msgs in 1.5s)"
            );
          }

          const notice = await message.channel
            .send({
              content:
                `🛡️ **Anti-Raid** — spam webhook removed` +
                (hook ? ` (\`${hook.name}\`)` : "") +
                `.\n` +
                (raiderId
                  ? `**Raid by:** <@${raiderId}> (**${confidence}%**)`
                  : `**Raid by:** Unknown (**${confidence}%**)`),
              allowedMentions: raiderId
                ? { users: [raiderId] }
                : { parse: [] }
            })
            .catch(() => null);

          // Delete bot notice after 8s so chat stays clean
          if (notice) {
            setTimeout(() => {
              notice.delete().catch(() => {});
            }, 8000);
          }
        } catch (err) {
          console.error("❌ Webhook anti-raid:", err.message);
        }
      }
    }

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
          if (!role.permissions.has(PermissionFlagsBits.MentionEveryone))
            continue;

          try {
            await role.setPermissions(
              role.permissions.remove(PermissionFlagsBits.MentionEveryone),
              `PingWarn: ${message.author.tag}`
            );

            if (data.timeout) clearTimeout(data.timeout);

            // Only auto-restore if duration was set
            if (data.durationMs) {
              data.timeout = setTimeout(async () => {
                try {
                  const r = message.guild.roles.cache.get(roleId);
                  if (r) {
                    await r.setPermissions(
                      r.permissions.add(PermissionFlagsBits.MentionEveryone),
                      "PingWarn duration ended"
                    );
                  }
                } catch {}
                const cur = pingWarnRoles.get(roleId);
                if (cur) cur.timeout = null;
              }, data.durationMs);
            } else {
              data.timeout = null;
            }
            pingWarnRoles.set(roleId, data);

            await message.channel
              .send({
                content:
                  `⚠️ **Ping Warn** — **${role.name}** lost @everyone/@here` +
                  (data.durationMs
                    ? ` for **${formatDuration(data.durationMs)}**.`
                    : ` **permanently** (until /pingwarn OFF).`) +
                  `\nTriggered by <@${message.author.id}>.`,
                allowedMentions: { users: [message.author.id] }
              })
              .catch(() => {});
          } catch {}
          break;
        }
      }
    }

    // Guess game
    const game = games.get(message.channelId);
    if (game?.active) {
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
          try {
            await message.channel.permissionOverwrites.edit(
              message.guild.roles.everyone,
              { SendMessages: false }
            );
          } catch {}
          games.delete(message.channelId);
        }
      }
    }
  } catch (error) {
    console.error("❌ Message error:", error);
  }
});

// =========================
// Errors + Login
// =========================

client.on("error", e => console.error("❌ Client:", e));
client.on("warn", w => console.warn("⚠️", w));
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));
process.on("uncaughtException", e => console.error("❌ Exception:", e));

console.log("🔑 Logging into Discord...");
client.login(TOKEN).catch(e => {
  console.error("❌ Login failed:", e);
  process.exit(1);
});
