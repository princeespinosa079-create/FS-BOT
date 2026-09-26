const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  MessageFlags,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const os = require("os");
// ============================================================
// ENV
// ============================================================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = "1302080645987569694";
const BUYER_ROLE_ID = "1545669026020069466";
const PRINCE_ROLE_ID = "1547849774676316181";
const BUYER_COLOR = 0xFFFFFF;
const REGULAR_COLOR = 0x2B2D31;
const PORT = Number(process.env.PORT) || 10000;
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID.");
  process.exit(1);
}
// ============================================================
// STORAGE
// ============================================================
const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const LIBRARY_FILE = path.join(DATA_DIR, "file-library.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
function readJSON(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch (e) {
    console.error(`❌ ${path.basename(file)}:`, e.message);
    return fallback;
  }
}
function writeJSON(file, data) {
  const tmp = `${file}.tmp`;
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, jsonStr, "utf8");
    // Force flush to disk
    try {
      const fd = fs.openSync(tmp, "r+");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch {}
    fs
  .renameSync(tmp, file);
    // Verify file was written correctly
    const verify = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(data?.files) && Array.isArray(verify?.files)) {
      console.log(`💾 Saved ${path.basename(file)}: ${verify.files.length} files`);
    }
  } catch (e) {
    console.error(`❌ Saving ${path.basename(file)}:`, e.message);
    // Emergency: try direct write
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); } catch {}
  }
}
let config = readJSON(CONFIG_FILE, { allowedChannelId: null });
if (!config || typeof config !== "object") config = { allowedChannelId: null };
let library = readJSON(LIBRARY_FILE, { files: [] });
if (Array.isArray(library)) library = { files: library };
if (!Array.isArray(library.files)) library.files = [];
// ============================================================
// COOLDOWN TRACKER
// ============================================================
const rnCooldown = new Map();
const RN_COOLDOWN_SEC = 10;
// Unified command cooldowns (regular users only, buyers bypass)
const commandCooldowns = new Map(); // key: "cmd:userId" → expiry timestamp
const COOLDOWNS = {
  upload: 60 * 60,      // 1 hour
  find: 15,             // 15 seconds
  get: 15,              // 15 seconds
  rename: 5 * 60,       // 5 minutes
  dl: 10 * 60,          // 10 minutes
  et: 30 * 60,          // 30 minutes
  obf: 60 * 60,         // 1 hour
  fetch: 15,            // 15 seconds
  delwh: 10 * 60        // 10 minutes
};
function formatCooldown(remainingSec) {
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
function checkCommandCooldown(userId, cmd, isBuyerUser) {
  if (isBuyerUser) return { onCooldown: false };
  const cdSec = COOLDOWNS[cmd];
  if (!cdSec) return { onCooldown: false };
  const key = `${cmd}:${userId}`;
  const now = Date.now();
  const expiry = commandCooldowns.get(key);
  if (expiry && now < expiry) {
    const remaining = Math.ceil((expiry - now) / 1000);
    return { onCooldown: true, message: `you're on ${formatCooldown(remaining)} cooldown.` };
  }
  commandCooldowns.set(key, now + cdSec * 1000);
  return { onCooldown: false };
}
// ============================================================
// DISCORD CLIENT
// ============================================================

// === PROMETHEUS DEOBFUSCATOR BUNDLE ===
// Prometheus Deobfuscator — bundled
const __modules = {};
const __cache = {};
function __require(name) {
  if (__cache[name]) return __cache[name].exports;
  const mod = { exports: {} };
  __cache[name] = mod;
  __modules[name](mod, mod.exports, __require);
  return mod.exports;
}

__modules["src/beautify/callbacks.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { walk, transform } = require("src/lua/walk.js");
const { isLocalBinding } = require("src/lua/scope.js");
const { bare } = require("src/util/flow.js");
const copies = require("src/beautify/copies.js");
const M = require("src/beautify/moves.js");

function closureOf(statement) {
  const declared = copies.declaredFunction(statement);
  if (declared) return declared;
  const plain = M.plainDeclaration(statement);
  if (!plain) return null;
  const value = bare(plain.value);
  if (!value || value.kind !== Kind.Function) return null;
  return { binding: plain.binding, name: plain.name, value };
}

function declaredIn(root) {
  const own = new Set();
  const note = (binding) => { if (binding) own.add(binding); };
  walk(root, {
    enter(node) {
      for (const binding of node.bindings || []) note(binding);
      if (node.kind === Kind.LocalFunction || node.kind === Kind.NumericFor) note(node.binding);
      return undefined;
    },
  });
  return own;
}

function capturesSafe(value, counts) {
  const own = declaredIn(value);
  for (const binding of M.readsWithin(value)) {
    if (own.has(binding)) continue;
    const text = binding.name;
    if (!text) return false;
    if (isLocalBinding(binding) ? !M.unshadowed(counts, text) : counts.has(text)) return false;
  }
  return true;
}

function mentionsOf(block) {
  const index = new Map();
  block.statements.forEach((statement, at) => {
    let depth = 0;
    walk(statement, {
      enter(node) {
        if (node.kind === Kind.Block) depth += 1;
        else if (node.kind === Kind.Name && node.binding) {
          const row = index.get(node.binding);
          if (row) row.count += 1;
          else index.set(node.binding, { count: 1, node, at, direct: depth === 0 });
        }
        return undefined;
      },
      leave(node) {
        if (node.kind === Kind.Block) depth -= 1;
      },
    });
  });
  return index;
}

function inlineAt(block, at, declared, index, counts) {
  const statements = block.statements;
  const row = index.get(declared.binding);
  if (!row || row.count !== 1 || !row.direct || row.at <= at) return false;
  const read = row.node;

  if (statements.some((statement) => statement.kind === Kind.Label)) return false;

  const host = statements[row.at];
  if (host.kind === Kind.While || host.kind === Kind.Repeat) return false;
  if (copies.readsInto(host, read)) return false;
  if (!capturesSafe(declared.value, counts)) return false;

  transform(host, (node) => (node === read ? declared.value : node));
  statements[at] = { kind: Kind.Do, body: { kind: Kind.Block, statements: [] } };
  return true;
}

function inlineClosures(chunk) {
  let moved = 0;
  const counts = M.nameCounts(chunk);
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      let index = null;
      for (let at = 0; at < node.statements.length; at += 1) {
        const declared = closureOf(node.statements[at]);
        if (!declared || !isLocalBinding(declared.binding)) continue;
        if (!index) index = mentionsOf(node);
        if (inlineAt(node, at, declared, index, counts)) moved += 1;
      }
      return undefined;
    },
  });
  return moved;
}

module.exports = {
  inlineClosures,
};

};

__modules["src/beautify/copies.js"] = function(module, exports, require) {
'use strict';

const { Kind, isMultiValue } = require("src/lua/ast.js");
const { walk, transform, collect, children } = require("src/lua/walk.js");
const { Positions } = require("src/util/order.js");
const { isLocalBinding } = require("src/lua/scope.js");
const { bare } = require("src/util/flow.js");
const services = require("src/beautify/services.js");
const M = require("src/beautify/moves.js");

function reachOf(binding) {
  if (!binding) return null;
  const declaration = binding.declaration;
  if (!declaration) return null;
  if (declaration.kind === Kind.LocalDeclaration) return 'after';
  if (declaration.kind === Kind.LocalFunction) return 'from';
  return 'inside';
}

function visibleAt(positions, binding, node) {
  const reach = reachOf(binding);
  if (!reach) return false;
  const declared = positions.path(binding.declaration);
  const wanted = positions.path(node);
  if (!declared || !wanted || wanted.depth < declared.depth) return false;
  let here = wanted;
  while (here.depth > declared.depth) here = here.up;
  if (here.up !== declared.up || here.block !== declared.block) return false;
  if (reach === 'after') return here.at > declared.at;
  if (reach === 'from') return here.at >= declared.at;
  return here.at === declared.at && wanted.depth > declared.depth;
}

function writeTable(chunk) {
  const table = new Map();
  const entry = (binding) => {
    let found = table.get(binding);
    if (!found) {
      found = { valued: 0, opaque: 0, empty: 0, value: null, at: null };
      table.set(binding, found);
    }
    return found;
  };
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.LocalDeclaration) {
        const expressions = node.expressions || [];
        const aligned = expressions.length === (node.names || []).length;
        (node.bindings || []).forEach((binding, at) => {
          if (!isLocalBinding(binding)) return;
          const found = entry(binding);
          if (!expressions.length) found.empty += 1;
          else if (aligned) {
            found.valued += 1;
            found.value = expressions[at];
            found.at = node;
          } else found.opaque += 1;
        });
      } else if (node.kind === Kind.Assignment) {
        const targets = node.targets || [];
        const expressions = node.expressions || [];
        const aligned = targets.length === expressions.length;
        targets.forEach((target, at) => {
          const named = bare(target);
          if (!named || named.kind !== Kind.Name || !isLocalBinding(named.binding)) return;
          const found = entry(named.binding);
          if (aligned) {
            found.valued += 1;
            found.value = expressions[at];
            found.at = node;
          } else found.opaque += 1;
        });
      } else if (node.kind === Kind.LocalFunction) {
        const found = entry(node.binding);
        found.valued += 1;
        found.value = null;
        found.at = node;
      } else if (node.kind === Kind.FunctionDeclaration) {
        const named = bare(node.target);
        if (named && named.kind === Kind.Name && isLocalBinding(named.binding)) {
          const found = entry(named.binding);
          found.valued += 1;
          found.value = null;
          found.at = node;
        }
      } else if (node.kind === Kind.NumericFor || node.kind === Kind.GenericFor
        || node.kind === Kind.Function) {
        for (const binding of node.bindings || []) {
          if (isLocalBinding(binding)) entry(binding).opaque += 1;
        }
      }
      return undefined;
    },
  });
  return table;
}

function readsOf(binding) {
  return (binding && binding.reads) || [];
}

function parentTable(chunk) {
  const parents = new Map();
  walk(chunk, {
    enter(node) {
      for (const child of children(node)) parents.set(child.node, node);
      return undefined;
    },
  });
  return parents;
}

function statementOf(parents, node) {
  let current = node;
  let above = parents.get(current);
  while (above && above.kind !== Kind.Block) {
    current = above;
    above = parents.get(current);
  }
  return above ? current : null;
}

function functionNamed(statement, value) {
  if (!statement) return null;
  if (statement.kind === Kind.LocalFunction) {
    return statement.body === value ? statement.binding : null;
  }
  const expressions = statement.expressions || [];
  if (expressions.length !== 1 || bare(expressions[0]) !== value) return null;
  if (statement.kind === Kind.LocalDeclaration) {
    return (statement.names || []).length === 1 ? (statement.bindings || [])[0] : null;
  }
  if (statement.kind !== Kind.Assignment) return null;
  const targets = statement.targets || [];
  if (targets.length !== 1) return null;
  const target = bare(targets[0]);
  return target && target.kind === Kind.Name ? target.binding : null;
}

function handedOver(write, named) {
  const harmless = new Set();
  for (const expression of (write && write.expressions) || []) {
    const value = bare(expression);
    if (value && value.kind === Kind.Name && value.binding === named) harmless.add(value);
  }
  return harmless;
}

function sealed(positions, named, made, write) {
  if (!isLocalBinding(named) || named.declaration !== made) return false;
  const madeAt = positions.path(made);
  const writeAt = positions.path(write);
  if (!madeAt || !writeAt || madeAt.depth !== writeAt.depth) return false;
  if (madeAt.up !== writeAt.up) return false;
  const block = madeAt.block;
  if (block !== writeAt.block) return false;
  const from = madeAt.at;
  const to = writeAt.at;
  if (from >= to) return false;
  const statements = block.statements || [];

  if (statements.some((statement) => statement.kind === Kind.Label)) return false;
  const harmless = handedOver(write, named);
  for (let i = from + 1; i <= to; i += 1) {
    const said = collect(statements[i],
      (node) => node.kind === Kind.Name && node.binding === named);
    if (i === to ? said.some((node) => !harmless.has(node)) : said.length) return false;
  }
  return true;
}

function filledBefore(parents, positions, read, write) {
  const writeAt = positions.path(write);
  if (!writeAt) return false;
  const home = writeAt.block;
  let current = parents.get(read);
  while (current) {
    if (current.kind === Kind.Function) {
      const made = statementOf(parents, current);
      const spot = made ? positions.path(made) : null;
      if (spot && spot.depth === writeAt.depth && spot.block === home) {
        const named = functionNamed(made, current);
        return !!named && sealed(positions, named, made, write);
      }
    }
    current = parents.get(current);
  }
  return false;
}

function settledOnce(positions, binding, info, parents) {
  if (!info || info.valued !== 1 || info.opaque) return false;
  const reads = readsOf(binding);
  if (!reads.length) return false;
  if (!info.empty) return true;
  return reads.every((read) => read === info.at || positions.precedes(info.at, read)
    || (parents && filledBefore(parents, positions, read, info.at)));
}

function heldBy(parents, node) {
  let current = parents.get(node);
  while (current) {
    if (current.kind === Kind.Function) return current;
    current = parents.get(current);
  }
  return null;
}

function loopsOver(parents, node) {
  const found = new Set();
  let current = node;
  while (current) {
    if (current.kind === Kind.While || current.kind === Kind.Repeat
      || current.kind === Kind.NumericFor || current.kind === Kind.GenericFor) found.add(current);
    current = parents.get(current);
  }
  return found;
}

function rewritten(parents, positions, from, copy) {
  const around = loopsOver(parents, copy);
  const nodes = (from.writes || []).slice();
  const made = from.declaration;
  if (made && (made.kind === Kind.NumericFor || made.kind === Kind.GenericFor)) nodes.push(made);
  for (const node of nodes) {
    for (const loop of loopsOver(parents, node)) if (around.has(loop)) return true;
    if (node !== copy && !positions.precedes(node, copy)) return true;
  }
  return false;
}

function propagate(chunk) {
  const positions = new Positions(chunk);
  const parents = parentTable(chunk);
  const writes = writeTable(chunk);
  const names = M.nameCounts(chunk);
  const replacements = new Map();

  for (const [binding, info] of writes) {
    if (!settledOnce(positions, binding, info, parents)) continue;
    const source = bare(info.value);
    if (!source || source.kind !== Kind.Name) continue;
    const from = source.binding;
    if (!isLocalBinding(from) || from === binding) continue;
    if (!M.unshadowed(names, from.name)) continue;
    const above = writes.get(from);

    if (above && above.valued > 1) continue;
    if (above && above.opaque > 1) continue;
    if (above && above.valued === 1 && above.at !== info.at
      && !positions.precedes(above.at, info.at)) continue;
    const reads = readsOf(binding);
    if (!reads.every((read) => visibleAt(positions, from, read))) continue;
    if (reads.some((read) => heldBy(parents, read) !== heldBy(parents, info.at))
      && rewritten(parents, positions, from, info.at)) continue;
    replacements.set(binding, from);
  }
  if (!replacements.size) return 0;

  const finalOf = (binding) => {
    let current = binding;
    for (let guard = 0; guard < 1000 && replacements.has(current); guard += 1) {
      current = replacements.get(current);
    }
    return current;
  };

  let moved = 0;
  const stored = new Set();
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Assignment) return undefined;
      for (const target of node.targets || []) {
        const named = bare(target);
        if (named && named.kind === Kind.Name) stored.add(named);
      }
      return undefined;
    },
  });
  transform(chunk, (node) => {
    if (node.kind !== Kind.Name || !node.binding || stored.has(node)) return node;
    if (!replacements.has(node.binding)) return node;
    const from = finalOf(node.binding);
    if (from === node.binding) return node;
    moved += 1;
    return { kind: Kind.Name, name: from.name, binding: from };
  });
  return moved;
}

function nextOf(statements, at) {
  for (let i = at + 1; i < statements.length; i += 1) {
    if (!M.isEmptyDo(statements[i])) return i;
  }
  return -1;
}

function holderOf(root, wanted) {
  let found = null;
  walk(root, {
    enter(node, info) {
      if (node === wanted && info) found = info.parent;
      return undefined;
    },
  });
  return found;
}

function readsInto(host, read) {
  const holder = holderOf(host, read);
  if (!holder || !holder.kind) return false;
  if (holder.kind === Kind.Unary || holder.kind === Kind.Binary) return true;
  if (holder.kind === Kind.Index) return true;
  if (holder.kind === Kind.Call || holder.kind === Kind.MethodCall) {
    return bare(holder.base) === read || holder.base === read;
  }
  return false;
}

function declaredFunction(statement) {
  if (!statement || statement.kind !== Kind.LocalFunction) return null;
  const binding = statement.binding;
  if (!binding || !statement.body) return null;
  if (collect(statement.body, (node) => node.kind === Kind.Name
    && node.name === statement.name).length) return null;
  return { binding, name: statement.name, value: statement.body };
}

function holdsRead(host, read) {
  let found = false;
  const visit = (node) => {
    if (found || !node || !node.kind || node.kind === Kind.Block) return;
    if (node === read) {
      found = true;
      return;
    }
    for (const child of children(node)) visit(child.node);
  };
  visit(host);
  return found;
}

function inlineBelow(block, at) {
  const statements = block.statements;
  const written = M.plainWrite(statements[at]) || M.plainDeclaration(statements[at])
    || declaredFunction(statements[at]);
  if (!written) return false;
  const binding = written.binding || written.target.binding;
  if (!isLocalBinding(binding)) return false;

  if (services.isLookup(written.value)) return false;
  const reads = readsOf(binding);
  if (reads.length !== 1) return false;
  const below = nextOf(statements, at);
  if (below < 0) return false;
  const read = reads[0];
  const host = statements[below];
  if (host.kind === Kind.While || host.kind === Kind.Repeat) return false;

  if (host.kind === Kind.Assignment
    && (host.targets || []).some((target) => collect(target, (node) => node === read).length)) {
    return false;
  }

  if (!holdsRead(host, read)) return false;
  if (!M.reachesQuietly(host, read)) return false;
  const held = bare(written.value);
  if (held && (held.kind === Kind.Table || held.kind === Kind.Function)
    && readsInto(host, read)) return false;

  const value = isMultiValue(bare(written.value))
    ? { kind: Kind.Paren, expression: written.value }
    : written.value;
  transform(host, (node) => (node === read ? value : node));
  statements[at] = { kind: Kind.Do, body: { kind: Kind.Block, statements: [] } };
  return true;
}

function inlineTemps(chunk) {
  let moved = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      for (let at = 0; at < node.statements.length; at += 1) {
        if (inlineBelow(node, at)) moved += 1;
      }
      return undefined;
    },
  });
  return moved;
}

module.exports = {
  reachOf,
  visibleAt,
  parentTable,
  sealed,
  rewritten,
  propagate,
  declaredFunction,
  holderOf,
  readsInto,
  inlineTemps,
};

};

__modules["src/beautify/declare.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { walk, collect } = require("src/lua/walk.js");
const { isIdentifier } = require("src/lua/format.js");
const { isLocalBinding } = require("src/lua/scope.js");
const { bare } = require("src/util/flow.js");
const { Positions } = require("src/util/order.js");
const { visibleAt } = require("src/beautify/copies.js");
const M = require("src/beautify/moves.js");

function hasLabel(block) {
  return (block.statements || []).some((statement) => statement.kind === Kind.Label);
}

function mentions(root, binding) {
  return collect(root, (node) => node.kind === Kind.Name && node.binding === binding);
}

function mentionSpots(block, own) {
  const spots = new Map();
  (block.statements || []).forEach((statement, at) => {
    walk(statement, {
      enter(node) {
        if (own && node.kind === Kind.Function) return false;
        if (node.kind !== Kind.Name || !node.binding) return undefined;
        const rows = spots.get(node.binding);
        if (!rows) spots.set(node.binding, [{ at, nodes: [node] }]);
        else if (rows[rows.length - 1].at === at) rows[rows.length - 1].nodes.push(node);
        else rows.push({ at, nodes: [node] });
        return undefined;
      },
    });
  });
  return spots;
}

function spotsOf(cache, block) {
  const kept = cache && cache.get(block);
  if (kept) return kept;
  const spots = mentionSpots(block, true);
  if (cache) cache.set(block, spots);
  return spots;
}

function firstMention(spots, binding, after) {
  for (const row of spots.get(binding) || []) {
    if (row.at > after) return row;
  }
  return null;
}

function sinkable(block) {
  const statements = block.statements || [];
  const wanted = new Map();
  if (hasLabel(block)) return wanted;
  let spots = null;
  statements.forEach((statement, at) => {
    if (statement.kind !== Kind.LocalDeclaration) return;
    if ((statement.expressions || []).length) return;
    (statement.bindings || []).forEach((binding, slot) => {
      if (!isLocalBinding(binding)) return;
      if (!spots) spots = mentionSpots(block);
      const first = firstMention(spots, binding, at);
      if (!first) return;
      const host = statements[first.at];
      if (host.kind !== Kind.Assignment) return;
      const targets = (host.targets || []).map((target) => bare(target));
      const stores = first.nodes.filter((node) => targets.indexOf(node) >= 0);
      if (stores.length !== first.nodes.length || stores.length !== 1) return;
      let list = wanted.get(first.at);
      if (!list) {
        list = [];
        wanted.set(first.at, list);
      }
      list.push({ binding, declaration: statement, slot, target: stores[0] });
    });
  });
  return wanted;
}

function rebind(binding, declaration, dropped) {
  binding.declaration = declaration;
  binding.initializer = declaration;
  const at = binding.writes.indexOf(dropped);
  if (at >= 0) binding.writes.splice(at, 1);
}

function sink(chunk) {
  let sunk = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      const wanted = sinkable(node);
      for (const [at, list] of wanted) {
        const host = node.statements[at];
        const targets = (host.targets || []).map((target) => bare(target));
        if (targets.length !== list.length) continue;
        const order = targets.map((target) => list.find((one) => one.target === target));
        if (order.some((one) => !one)) continue;
        const declaration = {
          kind: Kind.LocalDeclaration,
          names: order.map((one) => one.binding.name),
          expressions: host.expressions || [],
          bindings: order.map((one) => one.binding),
        };
        node.statements[at] = declaration;
        for (const one of order) {
          const names = one.declaration.names || [];
          const slot = names.indexOf(one.binding.name);
          if (slot >= 0) {
            names.splice(slot, 1);
            (one.declaration.bindings || []).splice(slot, 1);
          }
          rebind(one.binding, declaration, one.target);
          sunk += 1;
        }
      }
      return undefined;
    },
  });
  return sunk;
}

function slidable(block) {
  const statements = block.statements || [];
  const wanted = new Map();
  if (hasLabel(block)) return wanted;
  let spots = null;
  statements.forEach((statement, at) => {
    if (statement.kind !== Kind.LocalDeclaration) return;
    if ((statement.expressions || []).length) return;
    (statement.bindings || []).forEach((binding) => {
      if (!isLocalBinding(binding)) return;
      if (!spots) spots = mentionSpots(block);
      const first = firstMention(spots, binding, at);

      if (!first || first.at === at + 1) return;
      for (let i = at + 1; i < first.at; i += 1) {
        if (!silentAbout(statements[i], binding.name)) return;
      }
      let list = wanted.get(first.at);
      if (!list) {
        list = [];
        wanted.set(first.at, list);
      }
      list.push({ binding, declaration: statement });
    });
  });
  return wanted;
}

function slide(chunk) {
  let slid = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      const wanted = slidable(node);
      if (!wanted.size) return undefined;
      const out = [];
      node.statements.forEach((statement, at) => {
        const list = wanted.get(at);
        if (list && list.length) {
          const declaration = {
            kind: Kind.LocalDeclaration,
            names: list.map((one) => one.binding.name),
            expressions: [],
            bindings: list.map((one) => one.binding),
          };
          for (const one of list) {
            const names = one.declaration.names || [];
            const slot = names.indexOf(one.binding.name);
            if (slot >= 0) {
              names.splice(slot, 1);
              (one.declaration.bindings || []).splice(slot, 1);
            }
            one.binding.declaration = declaration;
            one.binding.initializer = declaration;
            slid += 1;
          }
          out.push(declaration);
        }
        out.push(statement);
      });
      node.statements = out;
      return undefined;
    },
  });
  return slid;
}

function innerBlock(root, nodes) {
  const wanted = new Set(nodes);
  const stack = [];
  let common = null;
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Block) stack.push(node);
      if (!wanted.has(node)) return undefined;
      if (!common) common = [...stack];
      else {
        let depth = 0;
        while (depth < common.length && common[depth] === stack[depth]) depth += 1;
        common.length = depth;
      }
      return undefined;
    },
    leave(node) {
      if (node.kind === Kind.Block) stack.pop();
    },
  });
  return common && common.length ? common[common.length - 1] : null;
}

function ownBlocks(root) {
  const found = new Set();
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Function) return false;
      if (node.kind === Kind.Block) found.add(node);
      return undefined;
    },
  });
  return found;
}

function mentionsIn(root) {
  const index = new Map();
  const stack = [];
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Block) {
        stack.push(node);
      } else if (node.kind === Kind.Name && node.binding) {
        const row = index.get(node.binding);
        if (!row) {
          index.set(node.binding, { nodes: [node], path: stack.slice() });
        } else {
          row.nodes.push(node);
          let depth = 0;
          while (depth < row.path.length && row.path[depth] === stack[depth]) depth += 1;
          row.path.length = depth;
        }
      }
      return undefined;
    },
    leave(node) {
      if (node.kind === Kind.Block) stack.pop();
    },
  });
  return index;
}

function pushable(home, index, cache) {
  const statements = home.statements || [];
  const plans = [];
  if (hasLabel(home)) return plans;
  if (!statements.some((statement) => statement.kind === Kind.LocalDeclaration
    && !(statement.expressions || []).length)) return plans;
  let inside = null;
  statements.forEach((statement) => {
    if (statement.kind !== Kind.LocalDeclaration) return;
    if ((statement.expressions || []).length) return;
    (statement.bindings || []).forEach((binding) => {
      if (!isLocalBinding(binding)) return;
      const row = index ? index.get(binding) : null;
      const found = row ? row.nodes : mentions(home, binding);
      if (!found.length) return;
      const target = row ? row.path[row.path.length - 1] : innerBlock(home, found);
      if (!inside) inside = ownBlocks(home);
      if (!target || target === home || !inside.has(target)) return;
      if (hasLabel(target)) return;
      const rows = spotsOf(cache, target).get(binding) || [];
      let own = 0;
      for (const row of rows) own += row.nodes.length;
      if (own !== found.length) return;
      const first = rows[0];
      if (!first) return;
      const host = (target.statements || [])[first.at];
      if (!host || host.kind !== Kind.Assignment) return;
      const targets = (host.targets || []).map((one) => bare(one));
      const stores = first.nodes.filter((node) => targets.indexOf(node) >= 0);
      if (stores.length !== 1 || stores.length !== first.nodes.length) return;
      plans.push({
        binding, declaration: statement, target, at: first.at,
      });
    });
  });
  return plans;
}

function pushIn(chunk) {
  const plans = [];
  const index = mentionsIn(chunk);
  const cache = new Map();
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Block) plans.push(...pushable(node, index, cache));
      return undefined;
    },
  });
  if (!plans.length) return 0;
  const rows = new Map();
  for (const plan of plans) {
    let list = rows.get(plan.target);
    if (!list) {
      list = new Map();
      rows.set(plan.target, list);
    }
    let row = list.get(plan.at);
    if (!row) {
      row = [];
      list.set(plan.at, row);
    }
    row.push(plan);
  }
  let pushed = 0;
  for (const [target, list] of rows) {
    for (const at of [...list.keys()].sort((a, b) => b - a)) {
      const row = list.get(at);
      const declaration = {
        kind: Kind.LocalDeclaration,
        names: row.map((one) => one.binding.name),
        expressions: [],
        bindings: row.map((one) => one.binding),
      };
      for (const one of row) {
        const names = one.declaration.names || [];
        const slot = names.indexOf(one.binding.name);
        if (slot >= 0) {
          names.splice(slot, 1);
          (one.declaration.bindings || []).splice(slot, 1);
        }
        one.binding.declaration = declaration;
        one.binding.initializer = declaration;
        pushed += 1;
      }
      target.statements.splice(at, 0, declaration);
    }
  }
  return pushed;
}

function harmless(statement) {
  if (statement.kind === Kind.LocalFunction) return true;
  if (statement.kind === Kind.LocalDeclaration) {
    return (statement.expressions || []).every((one) => M.quiet(one));
  }
  if (statement.kind !== Kind.Assignment) return false;
  return (statement.targets || []).every((one) => {
    const named = bare(one);
    return named && named.kind === Kind.Name && isLocalBinding(named.binding);
  }) && (statement.expressions || []).every((one) => M.quiet(one));
}

function writesAny(statement, wanted) {
  return collect(statement, (node) => node.kind === Kind.Assignment
    && (node.targets || []).some((one) => {
      const named = bare(one);
      return named && named.kind === Kind.Name && wanted.has(named.binding);
    })).length > 0;
}

function fillable(block, positions) {
  const statements = block.statements || [];
  const plans = [];
  if (hasLabel(block)) return plans;
  let spots = null;
  statements.forEach((statement, at) => {
    if (statement.kind !== Kind.LocalDeclaration) return;
    if ((statement.expressions || []).length) return;
    (statement.bindings || []).forEach((binding) => {
      if (!isLocalBinding(binding)) return;
      if (!spots) spots = mentionSpots(block, true);
      const first = firstMention(spots, binding, at);
      if (!first) return;
      const to = first.at;
      const store = statements[to];
      if (store.kind !== Kind.Assignment) return;
      if ((store.targets || []).length !== 1 || (store.expressions || []).length !== 1) return;
      const stored = bare(store.targets[0]);
      if (!stored || stored.kind !== Kind.Name || stored.binding !== binding) return;
      if (first.nodes.length !== 1) return;
      const value = store.expressions[0];
      if (!M.quiet(value)) return;
      const read = collect(value, (node) => node.kind === Kind.Name);
      if (!read.every((node) => isLocalBinding(node.binding)
        && visibleAt(positions, node.binding, statement))) return;
      const wanted = new Set(read.map((node) => node.binding));
      for (let i = at + 1; i < to; i += 1) {
        if (!harmless(statements[i]) || writesAny(statements[i], wanted)) return;
      }
      plans.push({ binding, declaration: statement, store, value, block });
    });
  });
  return plans;
}

function fill(chunk) {
  const positions = new Positions(chunk);
  const plans = [];
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Block) plans.push(...fillable(node, positions));
      return undefined;
    },
  });
  if (!plans.length) return 0;
  const rows = new Map();
  for (const plan of plans) {
    if (!rows.has(plan.block)) rows.set(plan.block, []);
    rows.get(plan.block).push(plan);
  }
  let filled = 0;
  for (const [block, list] of rows) {
    const dropped = new Set(list.map((one) => one.store));
    const above = new Map();
    for (const plan of list) {
      const declaration = {
        kind: Kind.LocalDeclaration,
        names: [plan.binding.name],
        expressions: [plan.value],
        bindings: [plan.binding],
      };
      const names = plan.declaration.names || [];
      const slot = names.indexOf(plan.binding.name);
      if (slot >= 0) {
        names.splice(slot, 1);
        (plan.declaration.bindings || []).splice(slot, 1);
      }
      rebind(plan.binding, declaration, bare(plan.store.targets[0]));
      if (!above.has(plan.declaration)) above.set(plan.declaration, []);
      above.get(plan.declaration).push(declaration);
      filled += 1;
    }
    const kept = [];
    for (const statement of block.statements || []) {
      const added = above.get(statement);
      if (added) kept.push(...added);
      if (!dropped.has(statement)) kept.push(statement);
    }
    block.statements = kept;
  }
  return filled;
}

function dropEmpty(chunk) {
  let dropped = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      const kept = node.statements.filter((statement) => {
        const empty = statement.kind === Kind.LocalDeclaration
          && !(statement.names || []).length;
        if (empty) dropped += 1;
        return !empty;
      });
      node.statements = kept;
      return undefined;
    },
  });
  return dropped;
}

function silentAbout(root, text) {
  return !collect(root, (node) => node.kind === Kind.Name && node.name === text).length;
}

function recursiveForm(chunk) {
  let restored = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block || hasLabel(node)) return undefined;
      const statements = node.statements;
      let spots = null;
      statements.forEach((statement, at) => {
        if (statement.kind !== Kind.LocalDeclaration) return;
        if ((statement.expressions || []).length) return;
        for (const binding of [...(statement.bindings || [])]) {
          if (!isLocalBinding(binding) || !isIdentifier(binding.name)) continue;
          if (!spots) spots = mentionSpots(node);
          const first = firstMention(spots, binding, at);
          if (!first) continue;
          const host = statements[first.at];
          if (host.kind !== Kind.Assignment) continue;
          if ((host.targets || []).length !== 1 || (host.expressions || []).length !== 1) continue;
          if (bare(host.targets[0]) !== first.nodes[0]) continue;
          const value = bare(host.expressions[0]);
          if (!value || value.kind !== Kind.Function) continue;

          if (mentions(value.body, binding).length !== first.nodes.length - 1) continue;
          let clear = true;
          for (let i = at + 1; i < first.at; i += 1) {
            if (!silentAbout(statements[i], binding.name)) clear = false;
          }
          if (!clear) continue;
          const declaration = {
            kind: Kind.LocalFunction,
            name: binding.name,
            body: value,
            binding,
          };
          statements[first.at] = declaration;
          const names = statement.names || [];
          const slot = names.indexOf(binding.name);
          if (slot >= 0) {
            names.splice(slot, 1);
            (statement.bindings || []).splice(slot, 1);
          }
          rebind(binding, declaration, first.nodes[0]);
          restored += 1;
        }
      });
      return undefined;
    },
  });
  return restored;
}

function localForm(chunk) {
  let restored = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      node.statements.forEach((statement, at) => {
        const declared = M.plainDeclaration(statement);
        if (!declared) return;
        const value = bare(declared.value);
        if (!value || value.kind !== Kind.Function) return;
        if (!isIdentifier(declared.name)) return;
        if (!silentAbout(value.body, declared.name)) return;
        const declaration = {
          kind: Kind.LocalFunction,
          name: declared.name,
          body: value,
          binding: declared.binding,
        };
        declared.binding.declaration = declaration;
        declared.binding.initializer = declaration;
        node.statements[at] = declaration;
        restored += 1;
      });
      return undefined;
    },
  });
  return restored;
}

function assignedForm(chunk) {
  let restored = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      node.statements.forEach((statement, at) => {
        if (statement.kind !== Kind.Assignment) return;
        const targets = statement.targets || [];
        const expressions = statement.expressions || [];
        if (targets.length !== 1 || expressions.length !== 1) return;
        const target = bare(targets[0]);
        const value = bare(expressions[0]);
        if (!target || target.kind !== Kind.Name) return;
        if (!value || value.kind !== Kind.Function) return;
        if (!isIdentifier(target.name)) return;
        node.statements[at] = {
          kind: Kind.FunctionDeclaration,
          target,
          isMethod: false,
          body: value,
        };
        restored += 1;
      });
      return undefined;
    },
  });
  return restored;
}

function methodNames(chunk) {
  const found = new Set();
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.MethodCall) found.add(node.method);
      return undefined;
    },
  });
  return found;
}

function fieldName(node) {
  if (!node || node.kind !== Kind.Index) return null;
  const key = bare(node.index);
  if (!key || key.kind !== Kind.String || !isIdentifier(key.value)) return null;
  return key.value;
}

function isFieldPath(node) {
  let current = node;
  while (current && current.kind === Kind.Index) {
    if (!fieldName(current)) return false;
    current = bare(current.base);
  }
  return !!current && current.kind === Kind.Name;
}

function methodForm(chunk) {
  const called = methodNames(chunk);
  let restored = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      node.statements.forEach((statement, at) => {
        if (statement.kind !== Kind.Assignment) return;
        const targets = statement.targets || [];
        const expressions = statement.expressions || [];
        if (targets.length !== 1 || expressions.length !== 1) return;
        const target = bare(targets[0]);
        const value = bare(expressions[0]);
        if (!value || value.kind !== Kind.Function) return;
        const field = fieldName(target);
        if (!field || !isFieldPath(target)) return;
        const params = value.params || [];
        const wantsSelf = called.has(field) && params.length > 0
          && silentAbout(value.body, 'self');
        if (wantsSelf) {
          const binding = (value.bindings || [])[0];
          if (binding) {
            for (const mention of mentions(value.body, binding)) mention.name = 'self';
            binding.name = 'self';
          }
          params[0] = 'self';
        }
        node.statements[at] = {
          kind: Kind.FunctionDeclaration,
          target,
          isMethod: wantsSelf,
          body: value,
        };
        restored += 1;
      });
      return undefined;
    },
  });
  return restored;
}

module.exports = {
  hasLabel,
  mentions,
  sink,
  slide,
  pushIn,
  harmless,
  fill,
  dropEmpty,
  recursiveForm,
  localForm,
  assignedForm,
  methodForm,
};

};

__modules["src/beautify/hoist.js"] = function(module, exports, require) {
'use strict';

const { Kind, unparen } = require("src/lua/ast.js");
const { walk, collect } = require("src/lua/walk.js");
const { isLocalBinding } = require("src/lua/scope.js");
const { Positions } = require("src/util/order.js");
const { visibleAt } = require("src/beautify/copies.js");
const { hasLabel } = require("src/beautify/declare.js");

function spoken(chunk) {
  const taken = new Set();
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Name) taken.add(node.name);
      else if (node.kind === Kind.LocalFunction) taken.add(node.name);
      else if (node.kind === Kind.NumericFor) taken.add(node.variable);
      else if (node.kind === Kind.LocalDeclaration) {
        for (const one of node.names || []) taken.add(one);
      } else if (node.kind === Kind.GenericFor) {
        for (const one of node.variables || []) taken.add(one);
      } else if (node.kind === Kind.Function) {
        for (const one of node.params || []) taken.add(one);
      }
      return undefined;
    },
  });
  return taken;
}

function fresh(taken, stem = 'f') {
  for (let n = 1; ; n += 1) {
    const name = `${stem}${n}`;
    if (taken.has(name)) continue;
    taken.add(name);
    return name;
  }
}

function carries(fn, positions, host) {
  const inside = new Set(collect(fn, () => true));
  for (const node of collect(fn, (one) => one.kind === Kind.Name)) {
    const binding = node.binding;
    if (!isLocalBinding(binding)) continue;
    if (!binding.declaration || inside.has(binding.declaration)) continue;
    if (!visibleAt(positions, binding, host)) return false;
  }
  return true;
}

function calledWhereBuilt(chunk, positions) {
  const found = [];
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Call) return undefined;
      const base = unparen(node.base);
      if (!base || base.kind !== Kind.Function) return undefined;
      const spot = positions.path(node);
      if (!spot) return undefined;
      const { block, at } = spot;
      const host = (block.statements || [])[at];

      if (!host || hasLabel(block)) return undefined;
      if (!carries(base, positions, host)) return undefined;
      found.push({ block, host, call: node, fn: base });
      return undefined;
    },
  });
  return found;
}

function nameCalled(chunk) {
  const positions = new Positions(chunk);
  const plans = calledWhereBuilt(chunk, positions);
  if (!plans.length) return 0;
  const taken = spoken(chunk);
  const rows = new Map();
  for (const plan of plans) {
    if (!rows.has(plan.block)) rows.set(plan.block, new Map());
    const above = rows.get(plan.block);
    if (!above.has(plan.host)) above.set(plan.host, []);
    const name = fresh(taken);
    above.get(plan.host).push({ kind: Kind.LocalFunction, name, body: plan.fn });
    plan.call.base = { kind: Kind.Name, name };
  }
  let named = 0;
  for (const [block, above] of rows) {
    const kept = [];
    for (const statement of block.statements || []) {
      const added = above.get(statement);
      if (added) {
        kept.push(...added);
        named += added.length;
      }
      kept.push(statement);
    }
    block.statements = kept;
  }
  return named;
}

module.exports = { spoken, fresh, carries, nameCalled };

};

__modules["src/beautify/jumps.js"] = function(module, exports, require) {
'use strict';

const A = require("src/lua/ast.js");
const { Kind } = require("src/lua/ast.js");
const { walk, collect } = require("src/lua/walk.js");
const { diverges, divergesBlock } = require("src/util/flow.js");

const TAILS = 8;

const LOOPS = new Set([Kind.While, Kind.Repeat, Kind.NumericFor, Kind.GenericFor]);

const EXITS = new Set([Kind.Return, Kind.Break, Kind.Continue]);

function rootsOf(chunk) {
  const roots = [];
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Chunk) roots.push(node.body);
      else if (node.kind === Kind.Function) roots.push(node.body);
      return undefined;
    },
  });
  return roots;
}

function survey(root) {
  const after = new Map();
  const holder = new Map();
  const labels = new Map();
  const gotos = [];
  const leave = { kind: 'leave' };

  const visitBlock = (block, exit) => {
    const statements = (block && block.statements) || [];
    for (let at = 0; at < statements.length; at += 1) {
      const statement = statements[at];
      let ahead = at + 1;
      while (ahead < statements.length && statements[ahead].kind === Kind.Label) ahead += 1;
      const next = ahead < statements.length
        ? { kind: 'statement', node: statements[ahead] }
        : exit;
      after.set(statement, next);
      holder.set(statement, statements);
      if (statement.kind === Kind.Label) labels.set(statement.name, statement);
      else if (statement.kind === Kind.Goto) gotos.push(statement);
      if (statement.kind === Kind.If) {
        visitBlock(statement.body, next);
        for (const clause of statement.elseIfs || []) visitBlock(clause.body, next);
        if (statement.elseBody) visitBlock(statement.elseBody, next);
      } else if (statement.kind === Kind.Do) {
        visitBlock(statement.body, next);
      } else if (LOOP_KINDS.has(statement.kind)) {
        visitBlock(statement.body, { kind: 'loop', node: statement });
      }
    }
  };

  visitBlock(root, leave);
  return { after, holder, labels, gotos };
}

function same(one, other) {
  if (!one || !other) return false;
  if (one === other) return true;
  if (one.kind !== other.kind) return false;
  return one.node === other.node;
}

function drop(statements, statement) {
  const at = statements.indexOf(statement);
  if (at < 0) return false;
  statements.splice(at, 1);
  return true;
}

function replace(statements, statement, replacement) {
  const at = statements.indexOf(statement);
  if (at < 0) return false;
  statements[at] = replacement;
  return true;
}

function unreachable(statements, statement) {
  const at = statements.indexOf(statement);
  if (at <= 0) return false;
  const before = statements[at - 1];
  if (before.kind === Kind.Label) return false;
  if (before.kind === Kind.Goto) return true;
  return LEAVING_KINDS.has(before.kind) || diverges(before);
}


function copyOf(node) {
  if (Array.isArray(node)) return node.map(copyOf);
  if (!node || typeof node !== 'object') return node;
  const copy = {};
  for (const key of Object.keys(node)) {
    if (key === 'binding' || key === 'bindings') continue;
    copy[key] = copyOf(node[key]);
  }
  return copy;
}

function holds(node, target) {
  let found = false;
  walk(node, {
    enter(one) {
      if (one === target) found = true;
      return undefined;
    },
  });
  return found;
}

function sibling(statement, into) {
  if (statement.kind === Kind.LocalDeclaration) {
    for (const binding of statement.bindings || []) if (binding) into.add(binding);
  } else if (statement.kind === Kind.LocalFunction && statement.binding) {
    into.add(statement.binding);
  }
}

function entering(statement, into) {
  if (statement.kind === Kind.NumericFor && statement.binding) into.add(statement.binding);
  else if (statement.kind === Kind.GenericFor) {
    for (const binding of statement.bindings || []) if (binding) into.add(binding);
  }
}

function bodiesOf(statement) {
  if (statement.kind === Kind.If) {
    const found = [statement.body];
    for (const clause of statement.elseIfs || []) found.push(clause.body);
    if (statement.elseBody) found.push(statement.elseBody);
    return found;
  }
  if (statement.kind === Kind.Do || LOOP_KINDS.has(statement.kind)) return [statement.body];
  return [];
}

function visibleAt(root, jump) {
  const live = new Set();
  const scan = (block) => {
    for (const statement of block.statements || []) {
      if (statement === jump) return true;
      if (holds(statement, jump)) {
        entering(statement, live);
        for (const body of bodiesOf(statement)) {
          if (body && holds(body, jump)) return scan(body);
        }
        return false;
      }
      sibling(statement, live);
    }
    return false;
  };
  return scan(root) ? live : null;
}

function declaredIn(statements) {
  const found = new Set();
  for (const statement of statements) {
    walk(statement, {
      enter(one) {
        sibling(one, found);
        entering(one, found);
        if (one.kind === Kind.Function) {
          for (const binding of one.bindings || []) if (binding) found.add(binding);
        }
        return undefined;
      },
    });
  }
  return found;
}

function leaves(block, depth = 0) {
  const statements = (block && block.statements) || [];
  if (!statements.length || depth > 48) return false;
  const last = statements[statements.length - 1];
  if (last.kind === Kind.Return) return true;
  if (last.kind === Kind.Do) return leaves(last.body, depth + 1);
  if (last.kind === Kind.If) {
    if (!last.elseBody || !leaves(last.body, depth + 1)) return false;
    for (const clause of last.elseIfs || []) {
      if (!leaves(clause.body, depth + 1)) return false;
    }
    return leaves(last.elseBody, depth + 1);
  }
  return divergesBlock(block, depth + 1);
}

function tailOf(statements, label) {
  const at = statements.indexOf(label);
  if (at < 0) return null;
  const tail = statements.slice(at + 1);
  if (!tail.length || tail.length > TAIL_STATEMENTS) return null;
  if (!leaves({ kind: Kind.Block, statements: tail })) return null;
  let nodes = 0;
  for (const statement of tail) {
    for (const one of collect(statement, () => true)) {
      if (one.kind === Kind.Goto || one.kind === Kind.Label) return null;
      if (one.kind === Kind.Break || one.kind === Kind.Continue) return null;
      nodes += 1;
    }
  }
  return nodes > TAIL_NODES ? null : tail;
}

function movable(root, jump, tail) {
  const visible = visibleAt(root, jump);
  if (!visible) return false;
  const inside = declaredIn(tail);
  const used = new Set();
  for (const statement of tail) {
    walk(statement, {
      enter(one) {
        if (one.kind === Kind.Name && one.binding) used.add(one.binding);
        return undefined;
      },
    });
  }
  const local = new Set();
  for (const statement of root.statements || []) {
    walk(statement, {
      enter(one) {
        sibling(one, local);
        entering(one, local);
        return undefined;
      },
    });
  }
  for (const binding of used) {
    if (inside.has(binding) || visible.has(binding)) continue;
    if (local.has(binding)) return false;
  }
  return true;
}

function copyableReturn(statement) {
  if (!statement || statement.kind !== Kind.Return) return null;
  const expressions = statement.expressions || [];
  const plain = expressions.every((value) => {
    const bare = A.unparen(value);
    return bare.kind === Kind.Name || A.LITERALS.has(bare.kind);
  });
  if (!plain) return null;
  return A.returnStatement(expressions.map((value) => copyOf(value)));
}
function lastOf(block) {
  const statements = (block && block.statements) || [];
  return statements.length ? statements[statements.length - 1] : null;
}

function stops(block) {
  const last = lastOf(block);
  if (last && (LEAVING_KINDS.has(last.kind) || last.kind === Kind.Goto)) return true;
  return leaves(block);
}

function jumpsTo(block, name) {
  const last = lastOf(block);
  return last && last.kind === Kind.Goto && last.label === name ? last : null;
}

function namesIn(statements) {
  const found = new Set();
  for (const statement of statements) {
    if (statement.kind === Kind.LocalDeclaration) {
      for (const name of statement.names || []) found.add(name);
    } else if (statement.kind === Kind.LocalFunction && statement.name) {
      found.add(statement.name);
    }
  }
  return found;
}

function readsIn(statements) {
  const found = new Set();
  for (const statement of statements) {
    walk(statement, {
      enter(one) {
        if (one.kind === Kind.Name && one.binding) found.add(one.binding);
        return undefined;
      },
    });
  }
  return found;
}

function ownersOf(root) {
  const owners = new Map();
  const blocks = new Map();
  const note = (block) => {
    for (const one of (block && block.statements) || []) blocks.set(one, block);
  };
  note(root);
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Function) return false;
      for (const body of bodiesOf(node)) {
        if (!body) continue;
        owners.set(body, node);
        note(body);
      }
      return undefined;
    },
  });
  return { owners, blocks };
}

function climb(label, wanted, owners, blocks) {
  const dropping = new Set();
  let block = blocks.get(label);
  let mark = label;
  for (let level = 0; level < 64; level += 1) {
    const owner = owners.get(block);
    if (!owner) return null;
    const above = blocks.get(owner);
    if (!above) return null;
    const list = above.statements || [];
    if (list[list.length - 1] !== owner) return null;
    if (owner.kind === Kind.If) {
      if (!owner.elseBody) return null;
      for (const other of bodiesOf(owner)) {
        if (other === block) continue;
        const jump = jumpsTo(other, label.name);
        if (jump) {
          dropping.add(jump);
          continue;
        }
        if (!stops(other)) return null;
      }
    } else if (owner.kind !== Kind.Do) return null;
    mark = owner;
    block = above;
    if (dropping.size === wanted) return { seat: owner, list, dropping };
  }
  return null;
}

function spill(label, gotos, owners, blocks) {
  const statements = (blocks.get(label) || {}).statements || [];
  const at = statements.indexOf(label);
  if (at < 0) return false;
  const tail = statements.slice(at + 1);
  if (!tail.length) return false;
  const wanted = gotos.filter((jump) => jump.label === label.name);
  if (!wanted.length) return false;
  const reached = climb(label, wanted.length, owners, blocks);
  if (!reached) return false;
  for (const jump of wanted) if (!reached.dropping.has(jump)) return false;
  const held = new Set();
  const inner = new Set();
  for (const one of tail) {
    for (const node of collect(one, (found) => found.kind === Kind.Label)) {
      held.add(node.name);
      inner.add(node);
    }
    for (const node of collect(one, (found) => found.kind === Kind.Goto)) inner.add(node);
  }
  for (const jump of gotos) {
    if (inner.has(jump) || reached.dropping.has(jump)) continue;
    if (held.has(jump.label)) return false;
  }
  const outside = collect(reached.seat, (found) => found.kind === Kind.Label)
    .filter((found) => !inner.has(found) && found !== label);
  for (const node of inner) {
    if (node.kind !== Kind.Goto) continue;
    if (outside.some((found) => found.name === node.label)) return false;
  }
  const inside = declaredIn(tail);
  const blocked = declaredIn([reached.seat]);
  for (const binding of inside) blocked.delete(binding);
  for (const binding of readsIn(tail)) {
    if (!inside.has(binding) && blocked.has(binding)) return false;
  }
  const seat = reached.list.indexOf(reached.seat);
  if (seat < 0) return false;
  const shadowing = namesIn(tail);
  if (shadowing.size) {
    for (let index = seat + 1; index < reached.list.length; index += 1) {
      for (const node of collect(reached.list[index], (found) => found.kind === Kind.Name)) {
        if (shadowing.has(node.name)) return false;
      }
    }
  }
  statements.splice(at, tail.length + 1);
  for (const jump of reached.dropping) {
    const list = (blocks.get(jump) || {}).statements;
    if (list) list.splice(list.indexOf(jump), 1);
  }
  reached.list.splice(seat + 1, 0, ...tail);
  return true;
}

function pull(chunk) {
  let pulled = 0;
  for (const root of rootsOf(chunk)) {
    for (let round = 0; round < 64; round += 1) {
      const { gotos } = survey(root);
      if (!gotos.length) break;
      const { owners, blocks } = ownersOf(root);
      let moved = false;
      for (const label of collect(root, (node) => node.kind === Kind.Label)) {
        if (!blocks.has(label)) continue;
        if (!spill(label, gotos, owners, blocks)) continue;
        moved = true;
        break;
      }
      if (!moved) break;
      pulled += 1;
    }
  }
  return pulled;
}

function clean(chunk) {
  let cleaned = 0;
  for (const root of rootsOf(chunk)) {
    const { after, holder, labels, gotos } = survey(root);
    if (!gotos.length && !labels.size) continue;
    for (const jump of gotos) {
      const statements = holder.get(jump);
      if (!statements) continue;
      if (unreachable(statements, jump)) {
        if (drop(statements, jump)) cleaned += 1;
        continue;
      }
      const label = labels.get(jump.label);
      if (!label) continue;
      const target = after.get(label);
      if (same(target, after.get(jump))) {
        if (drop(statements, jump)) cleaned += 1;
        continue;
      }
      if (target && target.kind === 'leave') {
        if (replace(statements, jump, A.returnStatement([]))) cleaned += 1;
        continue;
      }
      if (target && target.kind === 'statement') {
        const returned = copyableReturn(target.node);
        if (returned && movable(root, jump, [target.node])
          && replace(statements, jump, returned)) {
          cleaned += 1;
          continue;
        }
        const tail = tailOf(holder.get(label) || [], label);
        if (!tail || !movable(root, jump, tail)) continue;
        const at = statements.indexOf(jump);
        if (at < 0) continue;
        statements.splice(at, 1, ...tail.map(copyOf));
        cleaned += 1;
      }
    }

    const named = new Set();
    walk(root, {
      enter(node) {
        if (node.kind === Kind.Function) return false;
        if (node.kind === Kind.Goto) named.add(node.label);
        return undefined;
      },
    });
    for (const [name, label] of labels) {
      if (named.has(name)) continue;
      const statements = holder.get(label);
      if (statements && drop(statements, label)) cleaned += 1;
    }
  }
  return cleaned;
}

module.exports = {
  copyOf,
  leaves,
  visibleAt,
  movable,
  survey,
  same,
  unreachable,
  stops,
  pull,
  clean,
};

};

__modules["src/beautify/loops.js"] = function(module, exports, require) {
'use strict';

const { Kind, unparen, isMultiValue } = require("src/lua/ast.js");
const { walk } = require("src/lua/walk.js");
const { isLocalBinding } = require("src/lua/scope.js");
const { TABLES } = require("src/util/purity.js");
const { isAlwaysTrue } = require("src/util/flow.js");

const RETURNS = {
  ipairs: [null, null, { kind: Kind.Number, value: 0 }],
  pairs: [null, null, { kind: Kind.Nil }],
  gmatch: [null],
  gfind: [null],
  lines: [null],
};

const CONTROLS = 3;

function isLibrary(node) {
  if (!node || node.kind !== Kind.Name) return false;
  return !node.binding || !isLocalBinding(node.binding);
}

function libraryIterator(call) {
  if (!call || call.kind !== Kind.Call) return null;
  const base = unparen(call.base);
  if (!base) return null;
  if (isLibrary(base)) return base.name;
  if (base.kind !== Kind.Index) return null;
  const owner = unparen(base.base);
  if (!isLibrary(owner) || !TABLES.has(owner.name)) return null;
  const key = base.index;
  if (!key || key.kind !== Kind.String) return null;
  return key.value;
}

function spells(node, wanted) {
  const inner = unparen(node);
  if (!inner || !wanted || inner.kind !== wanted.kind) return false;
  if (inner.kind !== Kind.Number) return true;
  return inner.value === wanted.value;
}

function headerFits(loop, call, taken) {
  const spelled = loop.expressions || [];
  if (spelled.length < taken) return false;
  if (spelled.length > CONTROLS) return false;
  if (spelled.length === CONTROLS && taken === CONTROLS) return true;
  const returns = RETURNS[libraryIterator(call)];
  if (!returns) return false;
  for (let at = taken; at < CONTROLS; at += 1) {
    const wanted = at < returns.length ? returns[at] : { kind: Kind.Nil };
    if (!wanted) return false;
    if (at < spelled.length) {
      if (!spells(spelled[at], wanted)) return false;
    } else if (wanted.kind !== Kind.Nil) return false;
  }
  return true;
}

function headerOnly(declaration, loop) {
  const bindings = declaration.bindings || [];
  const names = declaration.names || [];
  if (!bindings.length || bindings.length !== names.length) return false;
  const spelled = loop.expressions || [];
  if (spelled.length < bindings.length) return false;
  return bindings.every((binding, at) => {
    if (!binding || !isLocalBinding(binding)) return false;
    if ((binding.writes || []).length) return false;
    const reads = binding.reads || [];
    if (reads.length !== 1) return false;
    return unparen(spelled[at]) === reads[0];
  });
}

function hoistedCall(statement) {
  if (!statement || statement.kind !== Kind.LocalDeclaration) return null;
  const expressions = statement.expressions || [];
  if (expressions.length !== 1) return null;
  const call = unparen(expressions[0]);
  return isMultiValue(call) ? call : null;
}

function foldable(chunk) {
  const plans = [];
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      const statements = node.statements || [];
      statements.forEach((statement, at) => {
        const loop = statements[at + 1];
        if (!loop || loop.kind !== Kind.GenericFor) return;
        const call = hoistedCall(statement);
        if (!call) return;
        if (!headerOnly(statement, loop)) return;
        if (!headerFits(loop, call, (statement.bindings || []).length)) return;
        plans.push({ block: node, declaration: statement, loop, call });
      });
      return undefined;
    },
  });
  return plans;
}

function foldIterators(chunk) {
  const plans = foldable(chunk);
  if (!plans.length) return 0;
  const dropped = new Set();
  for (const plan of plans) {
    plan.loop.expressions = [plan.call];
    dropped.add(plan.declaration);
  }
  for (const plan of plans) {
    plan.block.statements = plan.block.statements.filter((one) => !dropped.has(one));
  }
  return plans.length;
}

function negated(test) {
  if (test && test.kind === Kind.Unary && test.operator === 'not') return test.argument;
  return { kind: Kind.Unary, operator: 'not', argument: test };
}

function breakArm(branch) {
  if ((branch.elseIfs || []).length) return null;
  const lone = (block) => {
    const statements = (block && block.statements) || [];
    return statements.length === 1 && statements[0].kind === Kind.Break;
  };
  if (!branch.elseBody) return null;
  if (lone(branch.elseBody) && !lone(branch.body)) {
    return { condition: branch.condition, body: branch.body };
  }
  if (lone(branch.body) && !lone(branch.elseBody)) {
    return { condition: negated(branch.condition), body: branch.elseBody };
  }
  return null;
}

function raiseTest(chunk) {
  let raised = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.While) return undefined;
      if (!isAlwaysTrue(node.condition)) return undefined;
      const statements = (node.body && node.body.statements) || [];
      if (statements.length !== 1 || statements[0].kind !== Kind.If) return undefined;
      const arm = breakArm(statements[0]);
      if (!arm) return undefined;
      node.condition = arm.condition;
      node.body = arm.body;
      raised += 1;
      return undefined;
    },
  });
  return raised;
}

module.exports = { foldIterators, negated, raiseTest };

};

__modules["src/beautify/moves.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { walk, collect } = require("src/lua/walk.js");
const { bare } = require("src/util/flow.js");

function quiet(node) {
  if (!node) return true;
  switch (node.kind) {
    case Kind.Nil:
    case Kind.True:
    case Kind.False:
    case Kind.Number:
    case Kind.String:
    case Kind.Vararg:
    case Kind.Name:
    case Kind.Function:
      return true;
    case Kind.Paren:
      return quiet(node.expression);
    case Kind.Table:
      return (node.entries || []).every((entry) => (entry.type !== 'key' || quiet(entry.key))
        && quiet(entry.value));
    default:
      return false;
  }
}

function holds(root, wanted) {
  return collect(root, (node) => node === wanted).length > 0;
}

function storeSites(root) {
  const stores = new Set();
  walk(root, {
    enter(node) {
      if (node.kind !== Kind.Assignment) return undefined;
      for (const target of node.targets || []) {
        const site = bare(target);
        if (site && site.kind === Kind.Index) stores.add(site);
      }
      return undefined;
    },
  });
  return stores;
}

function evaluatedBefore(statement, target) {
  const stores = storeSites(statement);
  const before = [];
  const ancestors = [];
  let reached = false;
  walk(statement, {
    enter(node) {
      if (reached) return false;
      if (node === target) {
        reached = true;
        for (const ancestor of ancestors) {
          const at = before.indexOf(ancestor);
          if (at >= 0) before.splice(at, 1);
        }
        return false;
      }
      if (!stores.has(node)) before.push(node);
      if (node.kind === Kind.Function && !holds(node, target)) return false;
      ancestors.push(node);
      return undefined;
    },
    leave(node) {
      if (!reached && ancestors[ancestors.length - 1] === node) ancestors.pop();
    },
  });
  return reached ? before : null;
}

function reachesQuietly(statement, target) {
  const before = evaluatedBefore(statement, target);
  if (!before) return false;
  return before.every((node) => quiet(node));
}

function readsWithin(root) {
  const found = new Set();
  const stored = new Set();
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Assignment) {
        for (const target of node.targets || []) {
          const named = bare(target);
          if (named && named.kind === Kind.Name) stored.add(named);
        }
      }
      if (node.kind === Kind.Name && node.binding && !stored.has(node)) found.add(node.binding);
      return undefined;
    },
  });
  return found;
}

function nameCounts(root) {
  const counts = new Map();
  const seen = new Set();
  const note = (binding, text) => {
    if (!binding || seen.has(binding)) return;
    seen.add(binding);
    counts.set(text, (counts.get(text) || 0) + 1);
  };
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Function) {
        (node.bindings || []).forEach((binding, at) => note(binding, (node.params || [])[at]));
      } else if (node.kind === Kind.LocalDeclaration) {
        (node.bindings || []).forEach((binding, at) => note(binding, (node.names || [])[at]));
      } else if (node.kind === Kind.LocalFunction) {
        note(node.binding, node.name);
      } else if (node.kind === Kind.NumericFor) {
        note(node.binding, node.variable);
      } else if (node.kind === Kind.GenericFor) {
        (node.bindings || []).forEach((binding, at) => note(binding, (node.variables || [])[at]));
      }
      return undefined;
    },
  });
  return counts;
}

function unshadowed(counts, text) {
  return counts.get(text) === 1;
}

function plainWrite(statement) {
  if (!statement || statement.kind !== Kind.Assignment) return null;
  const targets = statement.targets || [];
  const expressions = statement.expressions || [];
  if (targets.length !== 1 || expressions.length !== 1) return null;
  const target = bare(targets[0]);
  if (!target || target.kind !== Kind.Name || !target.binding) return null;
  return { target, value: expressions[0] };
}

function plainDeclaration(statement) {
  if (!statement || statement.kind !== Kind.LocalDeclaration) return null;
  const names = statement.names || [];
  const expressions = statement.expressions || [];
  if (names.length !== 1 || expressions.length !== 1) return null;
  const binding = (statement.bindings || [])[0];
  if (!binding) return null;
  return { binding, name: names[0], value: expressions[0] };
}

function isEmptyDo(statement) {
  if (!statement || statement.kind !== Kind.Do) return false;
  return !((statement.body && statement.body.statements) || []).length;
}

module.exports = {
  quiet,
  reachesQuietly,
  readsWithin,
  nameCounts,
  unshadowed,
  plainWrite,
  plainDeclaration,
  isEmptyDo,
};

};

__modules["src/beautify/names.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { walk, collect } = require("src/lua/walk.js");
const { isIdentifier } = require("src/lua/format.js");
const { isLocalBinding } = require("src/lua/scope.js");
const { isDigit, isLower, isUpper } = require("src/lua/chars.js");
const { bare } = require("src/util/flow.js");

function words(text) {
  const found = [];
  let at = 0;
  while (at < text.length) {
    const character = text[at];
    if (!isUpper(character) && !isLower(character) && !isDigit(character)) {
      at += 1;
      continue;
    }
    let end = at;
    if (isUpper(character)) {
      while (end < text.length && isUpper(text[end])) end += 1;
      const run = end - at;
      if (run >= 3 && end < text.length && isLower(text[end])) end -= 1;
      else if (run === 1) {
        while (end < text.length && (isLower(text[end]) || isDigit(text[end]))) end += 1;
      } else if (end < text.length && isLower(text[end])) {
        while (end < text.length && (isLower(text[end]) || isDigit(text[end]))) end += 1;
      }
    } else {
      while (end < text.length && (isLower(text[end]) || isDigit(text[end]))) end += 1;
    }
    found.push(text.slice(at, end));
    at = end;
  }
  return found;
}

function camel(text) {
  const parts = words(String(text || ''));
  if (!parts.length) return null;
  const head = parts[0].toLowerCase();
  const tail = parts.slice(1).map((part) => (part === part.toUpperCase() && part.length > 1
    ? part
    : part[0].toUpperCase() + part.slice(1)));
  const candidate = head + tail.join('');
  return isIdentifier(candidate) ? candidate : null;
}

function typeWord(text) {
  let end = text.length;
  while (end > 1 && isDigit(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

function spelled(node) {
  const value = bare(node);
  if (!value || value.kind !== Kind.String) return null;
  return camel(value.value);
}

function keyOf(node) {
  if (!node || node.kind !== Kind.Index) return null;
  const key = bare(node.index);
  if (!key || key.kind !== Kind.String) return null;
  return key.value;
}

const CTORS = ['Create', 'New', 'Make', 'Build'];

function constructed(method) {
  const text = String(method || '');
  for (const verb of CTORS) {
    if (text.length <= verb.length) continue;
    if (text.slice(0, verb.length) !== verb) continue;
    if (!isUpper(text[verb.length])) continue;
    return text.slice(verb.length);
  }
  return null;
}

function optionName(node) {
  const table = bare(node);
  if (!table || table.kind !== Kind.Table) return null;
  for (const wanted of ['Title', 'Name']) {
    for (const entry of table.entries || []) {
      if (entry.type !== 'key') continue;
      const key = bare(entry.key);
      if (!key || key.kind !== Kind.String || key.value !== wanted) continue;
      const value = bare(entry.value);
      if (value && value.kind === Kind.String) return value.value;
    }
  }
  return null;
}

const QUALIFIERS = 2;

function qualifierOf(args) {
  const first = (args || [])[0];
  if (!first) return null;
  const said = bare(first);
  const text = said && said.kind === Kind.String ? said.value : optionName(first);
  if (!text) return null;
  const parts = words(String(text));
  if (!parts.length || parts.length > QUALIFIERS) return null;
  return parts.join(' ');
}

function entryKey(entry) {
  if (!entry || entry.type !== 'key') return null;
  const key = bare(entry.key);
  return key && key.kind === Kind.String ? key.value : null;
}

const CALLBACKS = new Set(['Callback', 'OnCallback', 'OnChanged', 'OnChange',
  'OnClick', 'OnToggle', 'OnFocusLost']);

const LABELS = ['Title', 'Name', 'Flag'];

function controlWord(table) {
  for (const wanted of LABELS) {
    for (const entry of table.entries || []) {
      if (entryKey(entry) !== wanted) continue;
      const said = bare(entry.value);
      if (!said || said.kind !== Kind.String) continue;
      const parts = words(said.value);
      if (!parts.length || parts.length > QUALIFIERS) continue;
      return parts.join(' ');
    }
  }
  return null;
}

function optionCallbacks(root) {
  const found = [];
  walk(root, {
    enter(node) {
      if (node.kind !== Kind.Table) return undefined;
      for (const entry of node.entries || []) {
        if (!CALLBACKS.has(entryKey(entry))) continue;
        const fn = bare(entry.value);
        if (!fn || fn.kind !== Kind.Function) continue;
        found.push({ word: controlWord(node), fn });
      }
      return undefined;
    },
  });
  return found;
}

function writtenBy(fn) {
  const own = new Set();
  walk(fn, {
    enter(node) {
      for (const binding of node.bindings || []) own.add(binding);
      if (node.kind === Kind.LocalFunction || node.kind === Kind.NumericFor) {
        own.add(node.binding);
      }
      return undefined;
    },
  });
  const inside = new Set(collect(fn, (node) => node.kind === Kind.Name));
  const held = new Set();
  for (const said of inside) {
    const binding = said.binding;
    if (!binding || !isLocalBinding(binding) || own.has(binding)) continue;
    const writes = binding.writes || [];
    if (!writes.length || !writes.every((write) => inside.has(write))) continue;
    held.add(binding);
  }
  return held.size === 1 ? [...held][0] : null;
}

const LOADERS = new Set(['loadstring', 'load']);

const PLUMBING = new Set(['raw', 'main', 'master', 'latest', 'download', 'releases',
  'release', 'blob', 'refs', 'heads', 'tags', 'archive', 'files', 'file', 'lua',
  'init', 'source', 'dl', 'api', 'v1', 'v2']);

function fromUrl(text) {
  const shown = String(text).split('?')[0].split('#')[0];
  const scheme = shown.indexOf('://');
  const path = scheme < 0 ? shown : shown.slice(scheme + 3);
  const parts = path.split('/').filter((part) => part.length > 0);

  for (let at = parts.length - 1; at >= 1; at -= 1) {
    const segment = parts[at].split('.')[0];
    if (!segment || PLUMBING.has(segment.toLowerCase())) continue;
    const named = camel(segment);
    if (named) return named;
  }
  return null;
}

function loadedLibrary(node) {
  if (node.kind !== Kind.Call || (node.args || []).length) return null;
  const inner = bare(node.base);
  if (!inner || inner.kind !== Kind.Call) return null;
  const loader = bare(inner.base);
  if (!loader || loader.kind !== Kind.Name || isLocalBinding(loader.binding)) return null;
  if (!LOADERS.has(loader.name)) return null;
  let url = null;
  walk(inner, {
    enter(one) {
      if (url === null && one.kind === Kind.String && one.value.indexOf('://') >= 0) {
        url = one.value;
      }
      return undefined;
    },
  });
  return url === null ? null : fromUrl(url);
}

const CHOICE = { and: ['rhs', 'lhs'], or: ['lhs', 'rhs'] };

function hintOf(node) {
  const value = bare(node);
  if (!value) return null;
  if (value.kind === Kind.Binary) {
    const sides = CHOICE[value.operator];
    if (!sides) return null;
    for (const side of sides) {
      const found = hintOf(value[side]);
      if (found) return found;
    }
    return null;
  }
  if (value.kind === Kind.Call || value.kind === Kind.MethodCall) {
    const args = value.args || [];
    const fetched = loadedLibrary(value);
    if (fetched) return fetched;
    const made = value.kind === Kind.MethodCall ? constructed(value.method) : null;
    const qualifier = qualifierOf(args);
    if (made) {
      const named = camel(qualifier === null ? made : `${qualifier} ${made}`);
      if (named) return named;
    }
    if (args.length === 1) {
      const named = spelled(args[0]);
      if (named) return named;
    }
    if (value.kind === Kind.MethodCall) {
      if (qualifier !== null && optionName(args[0]) !== null) {
        const named = camel(`${qualifier} ${value.method}`);
        if (named) return named;
      }
      return camel(value.method);
    }
    const base = bare(value.base);
    const library = base && base.kind === Kind.Index ? bare(base.base) : null;
    if (library && library.kind === Kind.Name && !isLocalBinding(library.binding)) {
      return camel(typeWord(library.name));
    }
    return null;
  }
  if (value.kind === Kind.Index) {
    const key = keyOf(value);
    return key ? camel(key) : null;
  }
  if (value.kind === Kind.Name && !isLocalBinding(value.binding)) return camel(value.name);
  return null;
}

const LISTENERS = {
  InputBegan: 'input',
  InputChanged: 'input',
  InputEnded: 'input',
  PlayerAdded: 'player',
  PlayerRemoving: 'player',
  CharacterAdded: 'character',
  CharacterRemoving: 'character',
  ChildAdded: 'child',
  ChildRemoved: 'child',
  DescendantAdded: 'descendant',
  DescendantRemoving: 'descendant',
  Touched: 'part',
  TouchEnded: 'part',
  Chatted: 'message',
  Heartbeat: 'delta',
  Stepped: 'delta',
  RenderStepped: 'delta',
  PromptButtonHoldBegan: 'player',
};

function connectedEvent(node) {
  if (!node || node.kind !== Kind.MethodCall || node.method !== 'Connect') return null;
  return keyOf(bare(node.base));
}

const ITERS = {
  ipairs: ['index', 'value'],
  pairs: ['key', 'value'],
  next: ['key', 'value'],
  gmatch: ['match'],
  gfind: ['match'],
  lines: ['line'],
};

function iteratorName(expressions) {
  const first = bare((expressions || [])[0]);
  if (!first) return null;
  if (first.kind === Kind.MethodCall) return first.method;
  if (first.kind === Kind.Call) {
    const base = bare(first.base);
    if (!base) return null;
    if (base.kind === Kind.Name) return isLocalBinding(base.binding) ? null : base.name;
    return keyOf(base);
  }
  if (first.kind === Kind.Name && !isLocalBinding(first.binding)) return first.name;
  return null;
}

const METAS = {
  __index: ['object', 'key'],
  __newindex: ['object', 'key', 'value'],
  __call: ['object'],
  __tostring: ['object'],
  __len: ['object'],
  __unm: ['object'],
  __gc: ['object'],
  __close: ['object'],
  __add: ['lhs', 'rhs'],
  __sub: ['lhs', 'rhs'],
  __mul: ['lhs', 'rhs'],
  __div: ['lhs', 'rhs'],
  __idiv: ['lhs', 'rhs'],
  __mod: ['lhs', 'rhs'],
  __pow: ['lhs', 'rhs'],
  __concat: ['lhs', 'rhs'],
  __eq: ['lhs', 'rhs'],
  __lt: ['lhs', 'rhs'],
  __le: ['lhs', 'rhs'],
};

function keyedFunctions(chunk) {
  const found = [];
  const note = (key, value) => {
    const spelling = bare(key);
    const held = bare(value);
    if (!spelling || spelling.kind !== Kind.String) return;
    if (!held || held.kind !== Kind.Function) return;
    found.push([spelling.value, held]);
  };
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Table) {
        for (const entry of node.entries || []) {
          if (entry.type === 'key') note(entry.key, entry.value);
        }
      } else if (node.kind === Kind.Assignment) {
        const expressions = node.expressions || [];
        if (expressions.length !== (node.targets || []).length) return undefined;
        node.targets.forEach((target, at) => {
          const stored = bare(target);
          if (stored && stored.kind === Kind.Index) note(stored.index, expressions[at]);
        });
      } else if (node.kind === Kind.FunctionDeclaration && !node.isMethod) {
        const target = bare(node.target);
        if (target && target.kind === Kind.Index) note(target.index, node.body);
      }
      return undefined;
    },
  });
  return found;
}

function roleFacts(chunk) {
  const fields = new Map();
  const called = new Set();
  const steps = new Map();
  const note = (list, binding, value) => {
    const kept = list.get(binding);
    if (kept) kept.push(value);
    else list.set(binding, [value]);
  };
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Table) {
        for (const entry of node.entries || []) {
          if (entry.type === 'key') fields.set(bare(entry.value), bare(entry.key));
        }
      } else if (node.kind === Kind.Call) {
        const base = bare(node.base);
        if (base) called.add(base);
      } else if (node.kind === Kind.Assignment) {
        const expressions = node.expressions || [];
        const targets = node.targets || [];
        const aligned = expressions.length === targets.length;
        targets.forEach((target, at) => {
          const value = aligned ? bare(expressions[at]) : null;
          if (target.kind === Kind.Name && target.binding) {
            note(steps, target.binding, value);
          }
          if (!aligned) return;
          const stored = bare(target);
          if (stored && stored.kind === Kind.Index) fields.set(value, bare(stored.index));
        });
      }
      return undefined;
    },
  });
  return { fields, called, steps };
}

function storedField(chunk, binding, facts) {
  const reads = (binding && binding.reads) || [];
  if (!reads.length) return null;
  const { fields } = facts || roleFacts(chunk);
  const keys = new Set();
  let stored = 0;
  for (const read of reads) {
    const spelling = fields.get(read);
    if (spelling === undefined) continue;
    if (spelling && spelling.kind === Kind.String) keys.add(spelling.value);
    stored += 1;
  }
  if (stored !== reads.length || keys.size !== 1) return null;
  return camel([...keys][0]);
}

function onlyCalled(chunk, binding, facts) {
  const reads = (binding && binding.reads) || [];
  if (!reads.length) return false;
  const { called } = facts || roleFacts(chunk);
  let seen = 0;
  for (const read of reads) if (called.has(read)) seen += 1;
  return seen === reads.length;
}

const ACCUMS = { '+': ['count', 'total'], '..': [null, 'text'] };

function seedOperator(node) {
  const seed = bare(node);
  if (!seed) return null;
  if (seed.kind === Kind.Number && seed.value === 0) return '+';
  if (seed.kind === Kind.String && seed.value === '') return '..';
  return null;
}

function accumulated(chunk, binding, operator, facts) {
  const [ones, many] = ACCUMS[operator];
  const written = (facts || roleFacts(chunk)).steps.get(binding) || [];
  let steps = 0;
  let byOne = 0;
  let other = 0;
  for (const value of written) {
    if (!value || value.kind !== Kind.Binary || value.operator !== operator) {
      other += 1;
      continue;
    }
    const lhs = bare(value.lhs);
    const rhs = bare(value.rhs);
    const added = lhs && lhs.kind === Kind.Name && lhs.binding === binding ? rhs
      : (rhs && rhs.kind === Kind.Name && rhs.binding === binding ? lhs : null);
    if (!added) {
      other += 1;
      continue;
    }
    steps += 1;
    if (added.kind === Kind.Number && added.value === 1) byOne += 1;
  }
  if (!steps || other) return null;
  return byOne === steps ? ones : many;
}

function suggest(chunk) {
  const hints = new Map();
  const offer = (binding, hint) => {
    if (!hint || !binding || !isLocalBinding(binding) || hints.has(binding)) return;
    hints.set(binding, hint);
  };
  const named = new Map();
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Assignment) return undefined;
      const targets = node.targets || [];
      const expressions = node.expressions || [];
      if (targets.length !== expressions.length) return undefined;
      targets.forEach((target, at) => {
        const field = bare(target);
        if (keyOf(field) !== 'Name') return;
        const owner = bare(field.base);
        if (!owner || owner.kind !== Kind.Name || !isLocalBinding(owner.binding)) return;
        const hint = spelled(expressions[at]);
        if (hint && !named.has(owner.binding)) named.set(owner.binding, hint);
      });
      return undefined;
    },
  });
  for (const [binding, hint] of named) offer(binding, hint);

  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.LocalDeclaration) {
        const expressions = node.expressions || [];
        if (expressions.length !== (node.names || []).length) return undefined;
        (node.bindings || []).forEach((binding, at) => {
          offer(binding, hintOf(expressions[at]));
        });
      } else if (node.kind === Kind.Assignment) {
        const targets = node.targets || [];
        const expressions = node.expressions || [];
        if (targets.length !== expressions.length) return undefined;
        targets.forEach((target, at) => {
          const stored = bare(target);
          if (!stored || stored.kind !== Kind.Name) return;
          offer(stored.binding, hintOf(expressions[at]));
        });
      } else if (node.kind === Kind.GenericFor) {
        const wanted = ITERS[iteratorName(node.expressions)] || [];
        (node.bindings || []).forEach((binding, at) => offer(binding, wanted[at]));
      } else if (node.kind === Kind.MethodCall) {
        const event = connectedEvent(node);
        const wanted = event && LISTENERS[event];
        if (!wanted) return undefined;
        for (const argument of node.args || []) {
          const listener = bare(argument);
          if (!listener || listener.kind !== Kind.Function) continue;
          if ((listener.params || [])[0] === 'self') continue;
          offer((listener.bindings || [])[0], wanted);
        }
      }
      return undefined;
    },
  });

  for (const { word, fn } of optionCallbacks(chunk)) {
    if ((fn.params || [])[0] !== 'self') offer((fn.bindings || [])[0], 'value');
    const hint = word === null ? null : camel(word);
    if (hint) offer(writtenBy(fn), hint);
  }

  for (const [key, fn] of keyedFunctions(chunk)) {
    const wanted = METAS[key];
    if (!wanted) continue;
    (fn.bindings || []).forEach((binding, at) => offer(binding, wanted[at]));
  }

  const seeds = new Map();
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.LocalDeclaration) {
        const expressions = node.expressions || [];
        if (expressions.length !== (node.names || []).length) return undefined;
        (node.bindings || []).forEach((binding, at) => {
          const operator = seedOperator(expressions[at]);
          if (operator && isLocalBinding(binding)) seeds.set(binding, operator);
        });
      }
      return undefined;
    },
  });

  const roles = [];
  walk(chunk, {
    enter(node) {
      const parameter = node.kind === Kind.Function;
      if (!parameter && node.kind !== Kind.LocalDeclaration) return undefined;
      for (const binding of node.bindings || []) {
        if (binding && isLocalBinding(binding) && !hints.has(binding)) {
          roles.push([binding, parameter]);
        }
      }
      return undefined;
    },
  });
  const facts = roles.length ? roleFacts(chunk) : null;
  for (const [binding, parameter] of roles) {
    const field = storedField(chunk, binding, facts);
    if (field) {
      offer(binding, field);
      continue;
    }

    if (parameter && onlyCalled(chunk, binding, facts)) {
      offer(binding, 'fn');
      continue;
    }
    const operator = seeds.get(binding);
    if (operator) offer(binding, accumulated(chunk, binding, operator, facts));
  }
  return hints;
}

function allocator(taken) {
  return (wanted) => {
    if (!taken.has(wanted) && isIdentifier(wanted)) {
      taken.add(wanted);
      return wanted;
    }
    for (let n = 2; n < 100000; n += 1) {
      const candidate = `${wanted}${n}`;
      if (!taken.has(candidate) && isIdentifier(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    throw new Error('names: candidate pool exhausted');
  };
}

module.exports = {
  spelled,
  keyOf,
  entryKey,
  suggest,
  allocator,
};

};

__modules["src/beautify/scopes.js"] = function(module, exports, require) {
'use strict';

const {
  Kind, block: makeBlock, doStatement, localDecl, assignment, name: makeName,
} = require("src/lua/ast.js");
const { walk } = require("src/lua/walk.js");

const LIMIT = 180;
const WINDOW = 24;
const RUN = 12;

function declaredCount(statement) {
  if (statement.kind === Kind.LocalDeclaration) return statement.names.length;
  if (statement.kind === Kind.LocalFunction) return 1;
  return 0;
}

function declaredBindings(statement) {
  if (statement.kind === Kind.LocalDeclaration) return statement.bindings || [];
  if (statement.kind === Kind.LocalFunction && statement.binding) return [statement.binding];
  return [];
}

function openedBy(statement) {
  switch (statement.kind) {
    case Kind.Do:
    case Kind.While:
      return [{ body: statement.body, extra: 0 }];
    case Kind.Repeat:
      return [{ body: statement.body, extra: 0, sealed: true }];
    case Kind.NumericFor:
      return [{ body: statement.body, extra: 4 }];
    case Kind.GenericFor:
      return [{ body: statement.body, extra: statement.variables.length + 3 }];
    case Kind.If: {
      const bodies = [{ body: statement.body, extra: 0 }];
      for (const clause of statement.elseIfs || []) bodies.push({ body: clause.body, extra: 0 });
      if (statement.elseBody) bodies.push({ body: statement.elseBody, extra: 0 });
      return bodies;
    }
    default:
      return [];
  }
}

function survey(body, base) {
  const blocks = [];
  let peak = base;
  const visit = (current, active, sealed) => {
    let live = active;
    let direct = 0;
    for (const statement of current.statements) {
      live += declaredCount(statement);
      direct += declaredCount(statement);
      if (live > peak) peak = live;
      for (const opened of openedBy(statement)) visit(opened.body, live + opened.extra, opened.sealed);
    }
    blocks.push({ block: current, base: active, direct, sealed });
  };
  visit(body, base, false);
  return { peak, blocks };
}

function jumps(block) {
  const stack = [block];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (node.kind === Kind.Function) continue;
    if (node.kind === Kind.Label || node.kind === Kind.Goto) return true;
    for (const key of Object.keys(node)) {
      if (key === 'binding' || key === 'bindings') continue;
      stack.push(node[key]);
    }
  }
  return false;
}

function sites(block) {
  const holder = new Map();
  block.statements.forEach((statement, at) => {
    walk(statement, {
      enter(node) {
        if (!holder.has(node)) holder.set(node, at);
        return undefined;
      },
    });
  });
  return holder;
}

function reachOf(block, holder) {
  const last = block.statements.length - 1;
  const reach = new Map();
  block.statements.forEach((statement, at) => {
    const bindings = declaredBindings(statement);
    if (!bindings.length) return;
    let to = at;
    for (const binding of bindings) {
      for (const use of binding.reads.concat(binding.writes)) {
        const site = holder.get(use);
        if (site === undefined) to = last;
        else if (site > to) to = site;
      }
    }
    reach.set(at, to);
  });
  return reach;
}

function ambiguous(block) {
  const owners = new Map();
  const note = (label, id) => {
    let seen = owners.get(label);
    if (!seen) {
      seen = new Set();
      owners.set(label, seen);
    }
    seen.add(id);
  };
  for (const statement of block.statements) {
    for (const binding of declaredBindings(statement)) note(binding.name, binding.id);
  }
  walk(block, {
    enter(node) {
      if (node.kind === Kind.Name && node.binding) note(node.name, node.binding.id);
      if (node.kind === Kind.LocalDeclaration) {
        for (const binding of node.bindings || []) note(binding.name, binding.id);
      }
      if (node.kind === Kind.LocalFunction && node.binding) note(node.binding.name, node.binding.id);
      if (node.kind === Kind.Function) {
        for (const binding of node.bindings || []) note(binding.name, binding.id);
      }
      if (node.kind === Kind.GenericFor) {
        for (const binding of node.bindings || []) note(binding.name, binding.id);
      }
      if (node.kind === Kind.NumericFor && node.binding) note(node.binding.name, node.binding.id);
      return undefined;
    },
  });
  const shared = new Set();
  for (const [label, seen] of owners) if (seen.size > 1) shared.add(label);
  return shared;
}

function boundaries(fixed, reach, lifted, count) {
  const kept = new Set(fixed);
  for (let round = 0; round < count; round += 1) {
    let added = false;
    let next = count;
    for (let at = count - 1; at >= 0; at -= 1) {
      if (kept.has(at)) {
        next = at;
        continue;
      }
      if (lifted.has(at)) continue;
      const to = reach.get(at);
      if (to !== undefined && to >= next) {
        kept.add(at);
        next = at;
        added = true;
      }
    }
    if (!added) break;
  }
  return kept;
}

function runsOf(block, reach, kept, lifted) {
  const count = block.statements.length;
  const runs = [];
  let start = 0;
  let end = -1;
  let held = 0;
  const close = (at) => {
    if (held && at > start) runs.push([start, at]);
    start = at + 1;
    end = at;
    held = 0;
  };
  for (let at = 0; at < count; at += 1) {
    if (kept.has(at)) {
      close(at - 1);
      start = at + 1;
      end = at;
      held = 0;
      continue;
    }
    if (!lifted.has(at)) {
      const to = reach.get(at);
      if (to !== undefined) {
        if (to > end) end = to;
        held += declaredCount(block.statements[at]);
      }
    }
    if (at >= end && at - start + 1 >= RUN) close(at);
  }
  close(count - 1);
  return runs;
}

function narrow(block, done) {
  if (done.has(block)) return 0;
  done.add(block);
  if (block.statements.length < RUN * 2) return 0;
  if (jumps(block)) return 0;
  const holder = sites(block);
  const reach = reachOf(block, holder);
  if (!reach.size) return 0;
  const shared = ambiguous(block);
  const lifted = new Set();
  const fixed = new Set();
  for (const [at, to] of reach) {
    if (to - at <= WINDOW) continue;
    const statement = block.statements[at];
    if (statement.kind !== Kind.LocalDeclaration
      || statement.names.some((label) => shared.has(label))) {
      fixed.add(at);
      continue;
    }
    lifted.add(at);
  }
  const kept = boundaries(fixed, reach, lifted, block.statements.length);
  for (const at of kept) lifted.delete(at);
  const runs = runsOf(block, reach, kept, lifted);
  if (!runs.length) return 0;
  const names = [];
  const rewritten = new Map();
  for (const at of lifted) {
    const statement = block.statements[at];
    for (const label of statement.names) names.push(label);
    rewritten.set(at, statement.expressions.length
      ? assignment(statement.names.map((label) => makeName(label)), statement.expressions)
      : null);
  }
  const out = [];
  if (names.length) out.push(localDecl(names));
  const put = (list, at) => {
    const statement = rewritten.has(at) ? rewritten.get(at) : block.statements[at];
    if (statement) list.push(statement);
  };
  let cursor = 0;
  for (const [from, to] of runs) {
    while (cursor < from) {
      put(out, cursor);
      cursor += 1;
    }
    const inner = [];
    while (cursor <= to) {
      put(inner, cursor);
      cursor += 1;
    }
    if (inner.length) out.push(doStatement(makeBlock(inner)));
  }
  while (cursor < block.statements.length) {
    put(out, cursor);
    cursor += 1;
  }
  block.statements = out;
  return runs.length;
}

function fit(chunk, resolve, limit = LIMIT) {
  let wrapped = 0;
  const bodies = [{ body: chunk.body, base: 0 }];
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Function) {
        bodies.push({ body: node.body, base: (node.params || []).length });
      }
      return undefined;
    },
  });
  const done = new Set();
  for (const holder of bodies) {
    for (let round = 0; round < 16; round += 1) {
      const seen = survey(holder.body, holder.base);
      if (seen.peak <= limit) break;
      const heavy = seen.blocks
        .filter((one) => !one.sealed && one.direct > 0 && !done.has(one.block))
        .sort((one, other) => other.direct - one.direct)[0];
      if (!heavy) break;
      const moved = narrow(heavy.block, done);
      if (!moved) continue;
      wrapped += moved;
      resolve();
    }
  }
  return wrapped;
}

module.exports = { fit, survey, LIMIT };

};

__modules["src/beautify/services.js"] = function(module, exports, require) {
'use strict';

const A = require("src/lua/ast.js");
const { Kind } = A;
const { walk, transform, collect } = require("src/lua/walk.js");
const { isLocalBinding } = require("src/lua/scope.js");
const { bare } = require("src/util/flow.js");

const METHOD = 'GetService';

function serviceOf(node) {
  if (!node || node.kind !== Kind.MethodCall || node.method !== METHOD) return null;
  const args = node.args || [];
  if (args.length !== 1) return null;
  const argument = bare(args[0]);
  if (!argument || argument.kind !== Kind.String) return null;
  const host = bare(node.base);
  if (!host || host.kind !== Kind.Name || isLocalBinding(host.binding)) return null;
  return argument.value;
}

const isLookup = (node) => serviceOf(bare(node)) !== null;

function declared(statement) {
  if (!statement || statement.kind !== Kind.LocalDeclaration) return null;
  if ((statement.names || []).length !== 1) return null;
  if ((statement.expressions || []).length !== 1) return null;
  const service = serviceOf(bare(statement.expressions[0]));
  if (service === null) return null;
  return { service, name: statement.names[0], initializer: bare(statement.expressions[0]) };
}

function preludeEnd(statements) {
  let at = 0;
  while (at < statements.length && declared(statements[at])) at += 1;
  return at;
}

function allNames(chunk) {
  const taken = new Set();
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Name) taken.add(node.name);
      for (const key of ['names', 'params', 'variables']) {
        for (const one of node[key] || []) taken.add(one);
      }
      if (node.kind === Kind.LocalFunction || node.kind === Kind.NumericFor) {
        taken.add(node.name || node.variable);
      }
    },
  });
  return taken;
}

function gather(chunk) {
  const statements = chunk.body ? chunk.body.statements : null;
  if (!statements) return 0;

  const lookups = collect(chunk, (node) => serviceOf(node) !== null);
  if (!lookups.length) return 0;

  const groups = new Map();
  for (const node of lookups) {
    const service = serviceOf(node);
    let group = groups.get(service);
    if (!group) groups.set(service, group = []);
    group.push(node);
  }

  const prelude = preludeEnd(statements);
  const settled = new Map();
  for (let at = 0; at < prelude; at += 1) {
    const found = declared(statements[at]);
    if (!settled.has(found.service)) settled.set(found.service, found);
  }
  const done = (service) => {
    const found = settled.get(service);
    const group = groups.get(service);
    return !!found && group.length === 1 && group[0] === found.initializer;
  };
  if ([...groups.keys()].every(done)) return 0;

  const taken = allNames(chunk);
  const fresh = () => {
    let number = 0;
    for (;;) {
      number += 1;
      const candidate = `service${number}`;
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
  };

  const written = [];
  const replacement = new Map();
  for (const [service, group] of groups) {
    let holder = settled.get(service);
    if (!holder) {
      const spelling = bare(group[0].base).name;
      holder = { service, name: fresh(), initializer: null };
      written.push(A.localDecl([holder.name], [
        A.methodCall(A.name(spelling), METHOD, [A.string(service)]),
      ]));
      settled.set(service, holder);
    }
    for (const node of group) {
      if (node === holder.initializer) continue;
      replacement.set(node, A.name(holder.name));
    }
  }

  const dropped = new Set();
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return;
      for (const statement of node.statements) {
        if (statement.kind !== Kind.CallStatement) continue;
        const call = bare(statement.expression);
        if (!replacement.has(call)) continue;
        replacement.delete(call);
        dropped.add(statement);
      }
    },
  });

  const moved = replacement.size + written.length + dropped.size;
  if (!moved) return 0;

  transform(chunk, (node) => replacement.get(node) || node);
  if (dropped.size) {
    walk(chunk, {
      enter(node) {
        if (node.kind !== Kind.Block) return;

        for (let at = node.statements.length - 1; at >= 0; at -= 1) {
          if (dropped.has(node.statements[at])) node.statements.splice(at, 1);
        }
      },
    });
  }
  if (written.length) {
    const body = chunk.body.statements;
    body.splice(preludeEnd(body), 0, ...written);
  }
  return moved;
}

module.exports = { gather, isLookup };

};

__modules["src/beautify/shapes.js"] = function(module, exports, require) {
'use strict';

const { Kind, isMultiValue } = require("src/lua/ast.js");
const { walk } = require("src/lua/walk.js");

function endsBare(block) {
  const statements = (block && block.statements) || [];
  const last = statements[statements.length - 1];
  return !!last && last.kind === Kind.Return && !(last.expressions || []).length;
}

function dropReturns(chunk) {
  let dropped = 0;
  const trim = (block) => {
    if (!endsBare(block)) return;
    block.statements.pop();
    dropped += 1;
  };
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Chunk) trim(node.body);
      else if (node.kind === Kind.Function) trim(node.body);
      return undefined;
    },
  });
  return dropped;
}

function loneIf(block) {
  const statements = (block && block.statements) || [];
  if (statements.length !== 1) return null;
  const only = statements[0];
  return only && only.kind === Kind.If ? only : null;
}

function collapseElseIf(chunk) {
  let collapsed = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.If) return undefined;
      for (let guard = 0; guard < 1000; guard += 1) {
        const inner = loneIf(node.elseBody);
        if (!inner) break;
        node.elseIfs = (node.elseIfs || []).concat(
          [{ condition: inner.condition, body: inner.body }],
          inner.elseIfs || [],
        );
        node.elseBody = inner.elseBody || null;
        collapsed += 1;
      }
      return undefined;
    },
  });
  return collapsed;
}

function isTruncated(node) {
  return node && node.kind === Kind.Paren && isMultiValue(node.expression);
}

function unwrapAt(node, key) {
  if (!isTruncated(node[key])) return 0;
  node[key] = node[key].expression;
  return 1;
}

function unwrapList(list, upTo) {
  let dropped = 0;
  for (let at = 0; at < upTo && at < (list || []).length; at += 1) {
    if (!isTruncated(list[at])) continue;
    list[at] = list[at].expression;
    dropped += 1;
  }
  return dropped;
}

function truncatedCount(list, slots) {
  const count = (list || []).length;
  if (!count) return 0;
  if (slots !== null && slots - count + 1 <= 1) return count;
  return count - 1;
}

function dropParens(chunk) {
  let dropped = 0;
  walk(chunk, {
    enter(node) {
      switch (node.kind) {
        case Kind.Index:
          dropped += unwrapAt(node, 'base') + unwrapAt(node, 'index');
          break;
        case Kind.Call:
        case Kind.MethodCall:
          dropped += unwrapAt(node, 'base');
          dropped += unwrapList(node.args, truncatedCount(node.args, null));
          break;
        case Kind.Binary:
          dropped += unwrapAt(node, 'lhs') + unwrapAt(node, 'rhs');
          break;
        case Kind.Unary:
          dropped += unwrapAt(node, 'argument');
          break;
        case Kind.Paren:
          dropped += unwrapAt(node, 'expression');
          break;
        case Kind.Table:
          (node.entries || []).forEach((entry, at) => {
            if (entry.type === 'key') dropped += unwrapAt(entry, 'key');
            const last = at === node.entries.length - 1;
            if (!last || entry.type === 'key') dropped += unwrapAt(entry, 'value');
          });
          break;
        case Kind.If:
          dropped += unwrapAt(node, 'condition');
          for (const clause of node.elseIfs || []) dropped += unwrapAt(clause, 'condition');
          break;
        case Kind.While:
        case Kind.Repeat:
          dropped += unwrapAt(node, 'condition');
          break;
        case Kind.NumericFor:
          dropped += unwrapAt(node, 'start') + unwrapAt(node, 'limit')
            + unwrapAt(node, 'step');
          break;
        case Kind.Return:
          dropped += unwrapList(node.expressions, truncatedCount(node.expressions, null));
          break;
        case Kind.GenericFor:
          dropped += unwrapList(node.expressions, truncatedCount(node.expressions, 3));
          break;
        case Kind.LocalDeclaration:
          dropped += unwrapList(
            node.expressions,
            truncatedCount(node.expressions, (node.names || []).length),
          );
          break;
        case Kind.Assignment:
          dropped += unwrapList(
            node.expressions,
            truncatedCount(node.expressions, (node.targets || []).length),
          );
          break;
        default:
          break;
      }
      return undefined;
    },
  });
  return dropped;
}

function opensNothing(block) {
  return ((block && block.statements) || []).every((statement) => statement.kind !== Kind.Label
    && statement.kind !== Kind.LocalDeclaration && statement.kind !== Kind.LocalFunction);
}

function flatten(chunk) {
  let flattened = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      const kept = [];
      for (const statement of node.statements) {
        const inner = statement.kind === Kind.Do ? statement.body : null;
        if (inner && opensNothing(inner)) {
          for (const one of inner.statements || []) kept.push(one);
          flattened += 1;
        } else kept.push(statement);
      }
      node.statements = kept;
      return undefined;
    },
  });
  return flattened;
}

const EXITS = new Set([Kind.Return, Kind.Break, Kind.Continue]);

function alwaysLeaves(block) {
  const statements = (block && block.statements) || [];
  const last = statements[statements.length - 1];
  return !!last && EXITS.has(last.kind);
}

function liftElse(chunk) {
  let lifted = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      const statements = node.statements;
      for (let at = 0; at < statements.length; at += 1) {
        const branch = statements[at];
        if (!branch || branch.kind !== Kind.If) continue;
        if (!alwaysLeaves(branch.body)) continue;
        if ((branch.elseIfs || []).length) continue;
        const otherwise = branch.elseBody;
        if (!otherwise || !opensNothing(otherwise) || loneIf(otherwise)) continue;
        branch.elseBody = null;
        statements.splice(at + 1, 0, ...(otherwise.statements || []));
        lifted += 1;
      }
      return undefined;
    },
  });
  return lifted;
}

function dropElse(chunk) {
  let dropped = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.If || !node.elseBody) return undefined;
      if ((node.elseBody.statements || []).length) return undefined;
      node.elseBody = null;
      dropped += 1;
      return undefined;
    },
  });
  return dropped;
}

module.exports = {
  EXITS,
  liftElse,
  dropReturns,
  dropElse,
  collapseElseIf,
  dropParens,
  flatten,
};

};

__modules["src/beautify/tuples.js"] = function(module, exports, require) {
'use strict';

const { Kind, isMultiValue } = require("src/lua/ast.js");
const { walk, transform } = require("src/lua/walk.js");
const { isLocalBinding } = require("src/lua/scope.js");
const { parentTable } = require("src/beautify/copies.js");
const { spoken, fresh } = require("src/beautify/hoist.js");

const SLOTS = 8;

function slotOf(node) {
  if (!node || node.kind !== Kind.Number) return 0;
  const value = node.value;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return 0;
  return value;
}

function packedCall(expression) {
  if (!expression || expression.kind !== Kind.Table) return null;
  const entries = expression.entries || [];
  if (entries.length !== 1 || entries[0].type !== 'item') return null;
  const value = entries[0].value;
  return isMultiValue(value) ? value : null;
}

function slotsRead(parents, binding) {
  const found = new Map();
  for (const read of binding.reads || []) {
    const index = parents.get(read);
    if (!index || index.kind !== Kind.Index || index.base !== read) return null;
    const slot = slotOf(index.index);
    if (!slot || slot > SLOTS) return null;
    const holder = parents.get(index);
    if (holder && holder.kind === Kind.Assignment
      && (holder.targets || []).indexOf(index) >= 0) return null;
    found.set(index, slot);
  }
  return found.size ? found : null;
}

function packed(chunk, parents) {
  const plans = [];
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.LocalDeclaration) return undefined;
      if ((node.names || []).length !== 1 || (node.expressions || []).length !== 1) return undefined;
      const call = packedCall(node.expressions[0]);
      if (!call) return undefined;
      const binding = (node.bindings || [])[0];
      if (!isLocalBinding(binding) || (binding.writes || []).length) return undefined;
      const reads = slotsRead(parents, binding);
      if (!reads) return undefined;
      const wanted = new Set(reads.values());
      const highest = Math.max(...wanted);
      if (wanted.size !== highest) return undefined;
      plans.push({ declaration: node, call, reads, highest });
      return undefined;
    },
  });
  return plans;
}

function nameResults(chunk) {
  const parents = parentTable(chunk);
  const plans = packed(chunk, parents);
  if (!plans.length) return 0;
  const taken = spoken(chunk);
  const swaps = new Map();
  let named = 0;
  for (const plan of plans) {
    const names = [plan.declaration.names[0]];
    for (let slot = 2; slot <= plan.highest; slot += 1) names.push(fresh(taken, 'v'));
    for (const [index, slot] of plan.reads) {
      swaps.set(index, { kind: Kind.Name, name: names[slot - 1] });
    }
    plan.declaration.names = names;
    plan.declaration.bindings = [];
    plan.declaration.expressions = [plan.call];
    named += 1;
  }
  transform(chunk, (node) => swaps.get(node) || node);
  return named;
}

module.exports = { packed, nameResults };

};

__modules["src/detect/prometheus.js"] = function(module, exports, require) {
'use strict';

const { Lexer, TokenKind, LuaSyntaxError } = require("src/lua/lexer.js");
const { Kind } = require("src/lua/ast.js");
const { walk, collect } = require("src/lua/walk.js");

const isIdentChar = (ch) => ch !== undefined && ch !== ''
  && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
    || (ch >= '0' && ch <= '9') || ch === '_');

const isDigit = (ch) => ch >= '0' && ch <= '9';

const ESC = String.fromCharCode(92);

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const HT = String.fromCharCode(9);

const ESCAPES = new Set(['n', 'r', 't', 'a', 'b', 'v', '"', "'"]);

const NON_NUM = new Set([7, 8, 9, 10, 11, 13, 32, 34, 39, 45, 126]);

const LITERALS = new Set([' ', '-', '~']);

const RAW_ESCAPES = new Set([ESC, 'n', 'r', '"', "'"]);

const RAW_KEPT = new Set([ESC, '"', "'"]);

const STYLES = [
  {
    literal: (ch) => LITERALS.has(ch),
    named: ESCAPES,
    numeric: (value) => !NON_NUM.has(value),
  },
  {
    literal: (ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 126 && !RAW_KEPT.has(ch);
    },
    named: RAW_ESCAPES,
    numeric: (value) => (value < 32 ? value !== 10 && value !== 13 : value > 126),
  },
];

function readString(raw, style, tally) {
  const end = raw.length - 1;
  let at = 1;
  while (at < end) {
    const ch = raw[at];
    if (ch !== ESC) {
      if (!style.literal(ch)) {
        return { at, message: `unescaped ${describeChar(ch)} in string` };
      }
      tally.literalExempt += 1;
      at += 1;
      continue;
    }
    const next = raw[at + 1];
    if (style.named.has(next)) {
      tally.namedEscapes += 1;
      at += 2;
      continue;
    }
    if (!isDigit(next)) return { at, message: `invalid escape \\${next}` };
    if (!isDigit(raw[at + 2]) || !isDigit(raw[at + 3])) {
      return { at, message: 'short decimal escape' };
    }
    const value = Number(raw.slice(at + 1, at + 4));
    if (value > 255) {
      return { at, message: `decimal escape > 255 (\\${raw.slice(at + 1, at + 4)})` };
    }
    if (!style.numeric(value)) {
      return {
        at,
        message: `redundant byte escape \\${raw.slice(at + 1, at + 4)}`,
      };
    }
    tally.numericEscapes += 1;
    at += 4;
  }
  return null;
}

function checkStringLiteral(raw, report, counts) {
  if (raw[0] !== '"') {
    report(raw.startsWith('[') ? 'bracket string' : 'single-quoted string');
    return;
  }
  let furthest = null;
  for (const style of STYLES) {
    const tally = { literalExempt: 0, namedEscapes: 0, numericEscapes: 0 };
    const failure = readString(raw, style, tally);
    if (failure) {
      if (!furthest || failure.at > furthest.at) furthest = failure;
      continue;
    }
    counts.literalExempt += tally.literalExempt;
    counts.namedEscapes += tally.namedEscapes;
    counts.numericEscapes += tally.numericEscapes;
    if (tally.numericEscapes > 0) counts.escapedText += 1;
    return;
  }
  report(furthest.message);
}

function describeChar(ch) {
  if (ch === undefined) return 'EOF';
  const code = ch.charCodeAt(0);
  if (code < 0x20 || code > 0x7e) return `byte ${code}`;
  return `'${ch}'`;
}

function checkNumberLiteral(text, previous, report, counts) {
  const lower = text.toLowerCase();
  if (lower.startsWith('0x')) {
    if (text !== lower && text !== text.toUpperCase()) counts.mixedHex += 1;
    return;
  }
  if (lower.startsWith('0b')) {
    report('binary literal');
    return;
  }
  if (text !== lower) {
    report(`uppercase in number ${text}`);
    return;
  }
  if (text.endsWith('.')) {
    report(`trailing decimal point in ${text}`);
    return;
  }
  if (text.length > 1 && text[0] === '0' && isDigit(text[1])) {
    report(`zero-padded number ${text}`);
    return;
  }

  if (text.startsWith('0.') && !(previous && previous.kind === TokenKind.Symbol && previous.value === '-')) {
    report(`leading zero in ${text}`);
  }
}

const MAX_ERRORS = 12;

function checkGap(gap, before, token, raw, report) {
  if (gap === '') return;
  if (gap !== ' ') {
    if (gap.includes('--')) report('comment');
    else if (gap.includes(LF) || gap.includes(CR)) report('newline');
    else if (gap.includes(HT)) report('tab character');
    else report('excess whitespace');
    return;
  }

  const left = before[before.length - 1];
  const right = raw[0];
  if (isIdentChar(left) || isIdentChar(right)) return;
  report(`unexpected space between ${describeChar(left)} and ${describeChar(right)}`);
}

function scanTokens(source) {
  const violations = [];
  const report = (message) => {
    if (violations.length < MAX_ERRORS) violations.push(message);
  };
  const counts = {
    tokens: 0,
    strings: 0,
    numbers: 0,
    tableSeparators: 0,
    mixedSeparators: 0,
    escapedText: 0,
    mixedHex: 0,
    namedEscapes: 0,
    numericEscapes: 0,
    literalExempt: 0,
    banner: 0,
  };
  const lexer = new Lexer(source);
  const brackets = [];
  let previous = null;
  let previousRaw = '';
  let previousEnd = 0;
  let semicolon = null;
  for (;;) {
    let token;
    try {
      token = lexer.next();
    } catch (error) {
      if (!(error instanceof LuaSyntaxError)) throw error;
      report(`lexer error: ${error.message}`);
      return { violations, counts, truncated: true };
    }
    const raw = token.kind === TokenKind.Eof ? '' : source.slice(token.offset, lexer.pos);
    const gap = source.slice(previousEnd, token.offset);
    if (previous === null || token.kind === TokenKind.Eof) {
      counts.banner += gap.length;
    } else {
      checkGap(gap, previousRaw, token, raw, report);
    }
    if (semicolon) {
      if (!(token.kind === TokenKind.Symbol && token.value === '(')) {
        const frame = semicolon.frame;
        if (frame && frame.ch === '{') {
          counts.tableSeparators += 1;
          frame.semi = true;
          if (frame.comma && !frame.mixed) {
            frame.mixed = true;
            counts.mixedSeparators += 1;
          }
        } else {
          report("unexpected ';'");
        }
      }
      semicolon = null;
    }
    if (token.kind === TokenKind.Eof) break;
    counts.tokens += 1;
    if (token.kind === TokenKind.String) {
      counts.strings += 1;
      checkStringLiteral(raw, report, counts);
    } else if (token.kind === TokenKind.Number) {
      counts.numbers += 1;
      checkNumberLiteral(token.text, previous, report, counts);
    } else if (token.kind === TokenKind.Symbol) {
      if (token.value === '(' || token.value === '[' || token.value === '{') {
        brackets.push({ ch: token.value, comma: false, semi: false, mixed: false });
      } else if (token.value === ')' || token.value === ']' || token.value === '}') {
        brackets.pop();
      } else if (token.value === ';') {
        semicolon = { frame: brackets[brackets.length - 1] || null };
      } else if (token.value === ',') {
        const frame = brackets[brackets.length - 1];
        if (frame && frame.ch === '{') {
          frame.comma = true;
          if (frame.semi && !frame.mixed) {
            frame.mixed = true;
            counts.mixedSeparators += 1;
          }
        }
      }
    }
    if (violations.length >= MAX_ERRORS) return { violations, counts, truncated: true };
    previous = token;
    previousRaw = raw;
    previousEnd = lexer.pos;
  }
  return { violations, counts, truncated: false };
}

function nameSignal(chunk) {
  const stack = [new Set()];
  const letters = new Set();
  let declared = 0;
  let letterStart = 0;
  let short = 0;
  let shadowed = 0;
  const isLetter = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
  const add = (name) => {
    if (typeof name !== 'string' || name.length === 0) return;
    declared += 1;
    if (isLetter(name[0])) letterStart += 1;
    if (name.length <= 2) short += 1;
    if (name.length === 1) letters.add(name);
    for (let i = 0; i < stack.length; i += 1) {
      if (stack[i].has(name)) { shadowed += 1; break; }
    }
    stack[stack.length - 1].add(name);
  };
  const SCOPED = new Set([
    Kind.Function, Kind.Block, Kind.NumericFor, Kind.GenericFor, Kind.Repeat,
  ]);
  walk(chunk, {
    enter: (node) => {
      if (SCOPED.has(node.kind)) stack.push(new Set());
      switch (node.kind) {
        case Kind.Function:
          for (const param of node.params || []) add(param);
          break;
        case Kind.LocalDeclaration:
          for (const name of node.names || []) add(name);
          break;
        case Kind.LocalFunction: add(node.name); break;
        case Kind.NumericFor: add(node.variable); break;
        case Kind.GenericFor:
          for (const name of node.variables || []) add(name);
          break;
        default: break;
      }
      return undefined;
    },
    leave: (node) => {
      if (SCOPED.has(node.kind)) stack.pop();
    },
  });
  return {
    declared,
    letterStart,
    short,
    shadowed,
    breadth: letters.size,
  };
}

const bare = (node) => {
  let at = node;
  while (at && at.kind === Kind.Paren) at = at.expression;
  return at;
};

const isNumber = (node, value) => !!node && node.kind === Kind.Number && node.value === value;

function wrapperSignal(node) {
  if (node.kind !== Kind.Return || node.expressions.length !== 1) return false;
  const call = bare(node.expressions[0]);
  if (!call || call.kind !== Kind.Call || call.args.length !== 1) return false;
  if (bare(call.args[0]).kind !== Kind.Vararg) return false;
  const target = bare(call.base);
  if (!target || target.kind !== Kind.Function) return false;
  return target.isVararg === true && (target.params || []).length === 0;
}

function rotateSignal(node) {
  if (node.kind !== Kind.GenericFor || node.expressions.length !== 1) return false;
  if ((node.variables || []).length !== 2) return false;
  const call = bare(node.expressions[0]);
  if (!call || call.kind !== Kind.Call || call.args.length !== 1) return false;
  const base = bare(call.base);
  if (!base || base.kind !== Kind.Name || base.name !== 'ipairs') return false;
  const table = bare(call.args[0]);
  if (!table || table.kind !== Kind.Table || table.entries.length !== 3) return false;
  for (const entry of table.entries) {
    if (entry.key) return false;
    const pair = bare(entry.value);
    if (!pair || pair.kind !== Kind.Table || pair.entries.length !== 2) return false;
    if (pair.entries[0].key || pair.entries[1].key) return false;
  }
  const body = node.body ? node.body.statements : [];
  if (body.length !== 1 || body[0].kind !== Kind.While) return false;
  const inner = body[0].body ? body[0].body.statements : [];
  if (inner.length !== 1 || inner[0].kind !== Kind.Assignment) return false;
  return inner[0].targets.length === 4 && inner[0].expressions.length === 4;
}

const PROXY_METAMETHODS = new Set(['__add', '__sub', '__index', '__mul', '__div', '__pow', '__concat']);

function proxySignal(node) {
  if (node.kind !== Kind.Table || node.entries.length !== 3) return false;
  for (const entry of node.entries) {
    const key = entry.key;
    if (!key || key.kind !== Kind.String || !PROXY_METAMETHODS.has(key.value)) return false;
  }
  return true;
}

const STREAM_MODULUS = 35184372088832;
const STREAM_PRIME = 257;

const ORDERING = new Set(['<', '>', '<=', '>=']);

function dispatchFrame(node) {
  const condition = bare(node.condition);
  if (!condition || condition.kind !== Kind.Name) return null;
  return { name: condition.name, ifs: 0, assigns: false, compares: false };
}

const isDispatch = (frame) => frame.ifs >= 2 && frame.assigns && frame.compares;

function shapeSignals(chunk) {
  const found = {
    wrapper: false,
    rotate: false,
    proxy: false,
    dispatcher: false,
    streamModulus: false,
    streamPrime: false,
    forStep: false,
    stepless: false,
  };

  const open = [];
  walk(chunk, {
    enter: (node) => {
      switch (node.kind) {
        case Kind.While:
          open.push(dispatchFrame(node));
          break;
        case Kind.If:
          for (const frame of open) if (frame) frame.ifs += 1;
          break;
        case Kind.Assignment:
          for (const frame of open) {
            if (!frame || frame.assigns) continue;
            for (const target of node.targets) {
              const at = bare(target);
              if (at && at.kind === Kind.Name && at.name === frame.name) frame.assigns = true;
            }
          }
          break;
        case Kind.Binary:
          if (ORDERING.has(node.operator)) {
            const lhs = bare(node.lhs);
            const rhs = bare(node.rhs);
            for (const frame of open) {
              if (!frame || frame.compares) continue;
              if ((lhs && lhs.kind === Kind.Name && lhs.name === frame.name)
                || (rhs && rhs.kind === Kind.Name && rhs.name === frame.name)) {
                frame.compares = true;
              }
            }
          }
          break;
        case Kind.Return:
          if (!found.wrapper && wrapperSignal(node)) found.wrapper = true;
          break;
        case Kind.Number:
          if (node.value === STREAM_MODULUS) found.streamModulus = true;
          else if (node.value === STREAM_PRIME) found.streamPrime = true;
          break;
        case Kind.Table:
          if (!found.proxy && proxySignal(node)) found.proxy = true;
          break;
        case Kind.GenericFor:
          if (!found.rotate && rotateSignal(node)) found.rotate = true;
          break;
        case Kind.NumericFor:
          if (!node.step) found.stepless = true;
          else if (isNumber(bare(node.step), 1)) found.forStep = true;
          break;
        default: break;
      }
      return undefined;
    },
    leave: (node) => {
      if (node.kind !== Kind.While) return;
      const frame = open.pop();
      if (frame && isDispatch(frame)) found.dispatcher = true;
    },
  });
  return found;
}

const NO_NAMES = { declared: 0, letterStart: 0, short: 0, shadowed: 0, breadth: 0 };
const NO_SHAPES = {
  wrapper: false,
  rotate: false,
  proxy: false,
  dispatcher: false,
  streamModulus: false,
  streamPrime: false,
  forStep: false,
  stepless: false,
};

function weigh(scan, names, shapes) {
  const evidence = [];
  const add = (weight, label) => evidence.push({ weight, label });
  const counts = scan.counts;
  if (shapes.dispatcher) add(2, 'a register machine dispatch loop');
  if (shapes.streamModulus && shapes.streamPrime) {
    add(2, "the string cipher's 2^45 modulus and 257 prime");
  }
  if (shapes.rotate) add(2, "the constant table's rotation loop");
  if (counts.escapedText > 0) {
    add(2, `${counts.escapedText} string(s) carrying numeric escapes for printable text`);
  }
  if (counts.mixedHex > 0) {
    add(counts.mixedHex > 1 ? 2 : 1, `${counts.mixedHex} hexadecimal number(s) in mixed case`);
  }
  if (shapes.wrapper) add(1, 'the vararg wrapper around the whole program');
  if (counts.mixedSeparators > 0) {
    add(1, `${counts.mixedSeparators} table(s) separated by both ',' and ';'`);
  } else if (counts.tableSeparators > 0) {
    add(1, `${counts.tableSeparators} table entries separated by ';'`);
  }
  if (shapes.proxy) add(1, 'a three metamethod proxy metatable');
  if (shapes.forStep) add(1, "a numeric for loop with its default step written out");
  if (names.breadth >= 12) {
    add(1, `${names.breadth} distinct single letter local names`);
  }
  if (names.shadowed > 0) {
    add(1, `${names.shadowed} local name(s) shadowing a name already in scope`);
  }
  if (names.declared >= 2 && names.short === names.declared
    && names.letterStart === names.declared) {
    add(1, `${names.declared} local names, all one or two letters`);
  }
  return evidence;
}

function requiredWeight(tokens) {
  if (tokens >= 2000) return 4;
  if (tokens >= 300) return 2;
  return 1;
}

function identify(source, chunk) {
  const body = source.trim();
  const scan = scanTokens(body);
  const names = chunk ? nameSignal(chunk) : NO_NAMES;
  const shapes = chunk ? shapeSignals(chunk) : NO_SHAPES;
  const evidence = weigh(scan, names, shapes);
  const weight = evidence.reduce((sum, item) => sum + item.weight, 0);
  const required = requiredWeight(scan.counts.tokens);
  const reasons = scan.violations.slice();
  if (!reasons.length && shapes.stepless) {
    reasons.push('for loop without step');
  }
  if (!reasons.length && weight < required) {
    reasons.push('insufficient Prometheus signatures'
      + (evidence.length ? ` (${evidence.map((item) => item.label).join(', ')})` : ''));
  }
  return {
    prometheus: reasons.length === 0,
    reasons,
    evidence,
    weight,
    required,
    names,
    shapes,
    counts: scan.counts,
  };
}

module.exports = { identify };

};

__modules["src/index.js"] = function(module, exports, require) {
'use strict';

const { parse } = require("src/lua/parser.js");
const { unparse } = require("src/lua/unparse.js");
const { Context, STEPS, run } = require("src/pipeline.js");
const { identify } = require("src/detect/prometheus.js");

class NotPrometheusError extends Error {
  constructor(report) {
    super(`unsupported Prometheus payload: ${report.reasons.join('; ')}`);
    this.name = 'NotPrometheusError';
    this.report = report;
  }
}

function deobfuscate(source, options = {}) {
  const name = options.name || 'chunk';
  let chunk = null;
  let unparsable = null;
  try {
    chunk = parse(source, { name });
  } catch (error) {
    unparsable = error;
  }
  let report = null;
  if (options.detect !== false) {
    report = identify(source, chunk);
    if (!report.prometheus) throw new NotPrometheusError(report);
  }
  if (unparsable) throw unparsable;
  const context = run(chunk, options);
  return {
    code: context.source(),
    chunk,
    notes: context.notes,
    warnings: context.warnings,
    stats: context.stats,
    context,
    detected: report,
  };
}

module.exports = {
  deobfuscate,
  NotPrometheusError,
  identify,
  parse,
  unparse,
  run,
  Context,
  STEPS,
  ast: require("src/lua/ast.js"),
  detect: require("src/vm/detect.js").detect,
  liftVm: require("src/vm/lift.js").liftVm,
};

};

__modules["src/interp/effects.js"] = function(module, exports, require) {
'use strict';

let clock = 0;
const witnesses = [];
const META = { meta: true };

function fresh() {
  clock += 1;
  return clock;
}

function touch(stamp, owner, key) {
  for (let i = 0; i < witnesses.length; i += 1) {
    const witness = witnesses[i];
    if (witness.writes) witness.writes.add(owner);
    if (stamp <= witness.since) {
      witness.escaped = true;
      if (witness.older && witness.last !== owner) {
        witness.last = owner;
        witness.older.add(owner);
      }
    }
    if (witness.slots && key !== undefined) {
      let slots = witness.slots.get(owner);
      if (!slots) {
        slots = new Map();
        witness.slots.set(owner, slots);
      }
      if (!slots.has(key)) {
        slots.set(key, key === META ? owner.metatable : owner.map.get(key));
      }
    }
    if (!witness.saved || witness.saved.has(owner)) continue;
    if (owner && owner.map) witness.tables.add(owner);
    else if (owner) witness.saved.set(owner, owner.value);
  }
}

function undo(entry) {
  for (const [owner, value] of entry.saved) owner.value = value;
  for (const [owner, slots] of entry.slots) {
    for (const [key, value] of slots) {
      if (key === META) owner.metatable = value;
      else if (value === undefined) owner.map.delete(key);
      else owner.map.set(key, value);
    }
  }
  entry.saved.clear();
  entry.slots.clear();
}

function commit(entry) {
  for (const [owner, value] of entry.saved) owner.value = value;
  entry.saved.clear();
  entry.slots.clear();
}

function attempt(body) {
  const entry = {
    since: clock,
    escaped: false,
    value: undefined,
    saved: new Map(),
    tables: new Set(),
    slots: new Map(),
  };
  witnesses.push(entry);
  try {
    entry.value = body();
  } catch (error) {
    witnesses.pop();
    undo(entry);
    throw error;
  }
  witnesses.pop();
  return entry;
}

function witness(body) {
  const entry = {
    since: clock, escaped: false, older: new Set(), last: null,
  };
  witnesses.push(entry);
  try {
    return { value: body(), escaped: entry.escaped, older: entry.older };
  } finally {
    witnesses.pop();
  }
}

function record(body) {
  const entry = { since: -1, escaped: false, writes: new Set() };
  witnesses.push(entry);
  try {
    return { value: body(), writes: entry.writes };
  } finally {
    witnesses.pop();
  }
}

module.exports = {
  META, fresh, touch, attempt, undo, commit, record, witness,
};

};

__modules["src/interp/interpreter.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const V = require("src/interp/values.js");
const ops = require("src/interp/ops.js");
const effects = require("src/interp/effects.js");

const { LuaError, LuaTable, LuaFunction, luaType, truthy } = V;

const BREAK = { signal: 'break' };
const CONTINUE = { signal: 'continue' };

class LuaLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LuaLimitError';
  }
}

class Scope {
  constructor(parent) {
    this.parent = parent;
    this.cells = new Map();
  }

  declare(name, value) {
    const cell = { value, stamp: effects.fresh() };
    this.cells.set(name, cell);
    return cell;
  }

  lookup(name) {
    let scope = this;
    while (scope) {
      const cell = scope.cells.get(name);
      if (cell) return cell;
      scope = scope.parent;
    }
    return null;
  }
}

class Interpreter {
  constructor(options = {}) {
    this.stepLimit = options.stepLimit === undefined ? 20e6 : options.stepLimit;
    this.callDepth = 0;
    this.lenient = options.lenient === true;
    this.maxCallDepth = options.maxCallDepth || 200;
    this.steps = 0;
    this.addresses = new WeakMap();
    this.nextAddress = 0x1000;
    this.stringMeta = undefined;
    this.globals = new LuaTable();
    this.output = [];
    require("src/interp/stdlib.js").install(this);
  }

  addressOf(value) {
    let address = this.addresses.get(value);
    if (address === undefined) {
      this.nextAddress += 0x30;
      address = this.nextAddress.toString(16);
      this.addresses.set(value, address);
    }
    return address;
  }

  metamethod(value, event) {
    let metatable;
    if (value instanceof LuaTable) metatable = value.metatable;
    else if (typeof value === 'string') metatable = this.stringMeta;
    else if (value && value.__metatable) metatable = value.__metatable;
    if (!metatable) return undefined;
    return metatable.get(event);
  }

  tick(count = 1) {
    this.steps += count;
    if (this.stepLimit && this.steps > this.stepLimit) {
      throw new LuaLimitError(`step limit exceeded (${this.stepLimit})`);
    }
  }

  call(fn, args) {
    if (typeof fn === 'function') {
      this.tick();
      return fn(this, args) || [];
    }
    if (!(fn instanceof LuaFunction)) {
      const handler = this.metamethod(fn, '__call');
      if (handler) return this.call(handler, [fn, ...args]);
      if (this.lenient && (fn === undefined || fn === null)) return [];
      throw new LuaError(`cannot call ${luaType(fn)}`);
    }
    if (this.callDepth >= this.maxCallDepth) throw new LuaError('stack overflow');
    this.callDepth += 1;
    try {
      return this.invoke(fn, args);
    } finally {
      this.callDepth -= 1;
    }
  }

  invoke(fn, args) {
    const node = fn.node;
    const scope = new Scope(fn.closure);
    const params = node.params || [];
    for (let i = 0; i < params.length; i += 1) scope.declare(params[i], args[i]);
    const frame = { varargs: node.isVararg ? args.slice(params.length) : [] };
    scope.frame = frame;
    const result = this.execBlock(node.body, scope);
    if (result && result.signal === 'return') return result.values;
    return [];
  }

  runChunk(chunk, args = []) {
    const fn = new LuaFunction(
      { kind: Kind.Function, params: [], body: chunk.kind === Kind.Chunk ? chunk.body : chunk, isVararg: true },
      this.rootScope(),
      'main chunk',
    );
    return this.call(fn, args);
  }

  rootScope() {
    if (!this.root) {
      this.root = new Scope(null);
      this.root.frame = { varargs: [] };
    }
    return this.root;
  }

  execBlock(block, parentScope) {
    const scope = new Scope(parentScope);
    scope.frame = parentScope.frame;
    return this.execStatements(block.statements, scope);
  }

  execStatements(statements, scope) {
    let index = 0;
    while (index < statements.length) {
      const signal = this.execStatement(statements[index], scope);
      if (signal) {
        if (signal.signal === 'goto') {
          const target = statements.findIndex(
            (s) => s.kind === Kind.Label && s.name === signal.label,
          );
          if (target !== -1) {
            index = target + 1;
            continue;
          }
        }
        return signal;
      }
      index += 1;
    }
    return undefined;
  }

  execStatement(node, scope) {
    this.tick();
    switch (node.kind) {
      case Kind.LocalDeclaration: {
        const values = this.evalExpressionList(node.expressions, scope, node.names.length);
        for (let i = 0; i < node.names.length; i += 1) scope.declare(node.names[i], values[i]);
        return undefined;
      }
      case Kind.LocalFunction: {
        const cell = scope.declare(node.name, undefined);
        cell.value = new LuaFunction(node.body, scope, node.name);
        return undefined;
      }
      case Kind.FunctionDeclaration: {
        const fn = new LuaFunction(node.body, scope, 'declared');
        this.assign(node.target, fn, scope);
        return undefined;
      }
      case Kind.Assignment: {
        const values = this.evalExpressionList(node.expressions, scope, node.targets.length);
        const slots = node.targets.map((target) => this.slotFor(target, scope));
        for (let i = slots.length - 1; i >= 0; i -= 1) this.store(slots[i], values[i]);
        return undefined;
      }
      case Kind.CallStatement:
        this.evalMulti(node.expression, scope);
        return undefined;
      case Kind.Return:
        return { signal: 'return', values: this.evalExpressionList(node.expressions, scope, -1) };
      case Kind.Break:
        return BREAK;
      case Kind.Continue:
        return CONTINUE;
      case Kind.Goto:
        return { signal: 'goto', label: node.label };
      case Kind.Label:
        return undefined;
      case Kind.Do:
        return this.execBlock(node.body, scope);
      case Kind.If:
        return this.execIf(node, scope);
      case Kind.While:
        return this.execWhile(node, scope);
      case Kind.Repeat:
        return this.execRepeat(node, scope);
      case Kind.NumericFor:
        return this.execNumericFor(node, scope);
      case Kind.GenericFor:
        return this.execGenericFor(node, scope);
      default:
        throw new LuaError(`unsupported statement: ${node.kind}`);
    }
  }

  execIf(node, scope) {
    if (truthy(this.eval(node.condition, scope))) return this.execBlock(node.body, scope);
    for (const clause of node.elseIfs || []) {
      if (truthy(this.eval(clause.condition, scope))) return this.execBlock(clause.body, scope);
    }
    if (node.elseBody) return this.execBlock(node.elseBody, scope);
    return undefined;
  }

  static loopSignal(signal) {
    if (!signal) return null;
    if (signal === BREAK) return 'stop';
    if (signal === CONTINUE) return null;
    return signal;
  }

  execWhile(node, scope) {
    for (;;) {
      this.tick();
      if (!truthy(this.eval(node.condition, scope))) return undefined;
      const result = Interpreter.loopSignal(this.execBlock(node.body, scope));
      if (result === 'stop') return undefined;
      if (result) return result;
    }
  }

  execRepeat(node, scope) {
    for (;;) {
      this.tick();

      const bodyScope = new Scope(scope);
      bodyScope.frame = scope.frame;
      const raw = this.execStatements(node.body.statements, bodyScope);
      const result = Interpreter.loopSignal(raw);
      if (result === 'stop') return undefined;
      if (result) return result;
      if (truthy(this.eval(node.condition, bodyScope))) return undefined;
    }
  }

  execNumericFor(node, scope) {
    const start = V.toNumber(this.eval(node.start, scope));
    const limit = V.toNumber(this.eval(node.limit, scope));
    const step = node.step ? V.toNumber(this.eval(node.step, scope)) : 1;
    if (start === undefined || limit === undefined || step === undefined) {
      throw new LuaError("'for' bounds must be numbers");
    }
    for (let i = start; step > 0 ? i <= limit : i >= limit; i += step) {
      this.tick();
      const bodyScope = new Scope(scope);
      bodyScope.frame = scope.frame;
      bodyScope.declare(node.variable, i);
      const result = Interpreter.loopSignal(this.execStatements(node.body.statements, bodyScope));
      if (result === 'stop') return undefined;
      if (result) return result;
    }
    return undefined;
  }

  execGenericFor(node, scope) {
    const values = this.evalExpressionList(node.expressions, scope, 3);
    let [iterator, state, control] = values;
    for (;;) {
      this.tick();
      const results = this.call(iterator, [state, control]);
      if (results[0] === undefined || results[0] === null) return undefined;
      control = results[0];
      const bodyScope = new Scope(scope);
      bodyScope.frame = scope.frame;
      for (let i = 0; i < node.variables.length; i += 1) {
        bodyScope.declare(node.variables[i], results[i]);
      }
      const result = Interpreter.loopSignal(this.execStatements(node.body.statements, bodyScope));
      if (result === 'stop') return undefined;
      if (result) return result;
    }
  }

  slotFor(target, scope) {
    if (target.kind === Kind.Name) {
      const cell = scope.lookup(target.name);
      if (cell) return { cell };
      return { base: this.globals, key: target.name };
    }
    if (target.kind === Kind.Index) {
      return { base: this.eval(target.base, scope), key: this.eval(target.index, scope) };
    }
    throw new LuaError('invalid assignment target');
  }

  store(slot, value) {
    if (slot.cell) {
      effects.touch(slot.cell.stamp, slot.cell);
      slot.cell.value = value;
      return;
    }
    ops.setIndex(this, slot.base, slot.key, value);
  }

  assign(target, value, scope) {
    if (target.kind === Kind.Name) {
      const cell = scope.lookup(target.name);
      if (cell) {
        effects.touch(cell.stamp, cell);
        cell.value = value;
        return;
      }
      ops.setIndex(this, this.globals, target.name, value);
      return;
    }
    if (target.kind === Kind.Index) {
      const base = this.eval(target.base, scope);
      ops.setIndex(this, base, this.eval(target.index, scope), value);
      return;
    }
    throw new LuaError('invalid assignment target');
  }

  evalExpressionList(expressions, scope, want) {
    const values = [];
    if (expressions) {
      for (let i = 0; i < expressions.length; i += 1) {
        if (i === expressions.length - 1) {
          const tail = this.evalMulti(expressions[i], scope);
          for (const value of tail) values.push(value);
        } else {
          values.push(this.eval(expressions[i], scope));
        }
      }
    }
    if (want >= 0) {
      while (values.length < want) values.push(undefined);
      values.length = want;
    }
    return values;
  }

  evalMulti(node, scope) {
    switch (node.kind) {
      case Kind.Call: {
        const fn = this.eval(node.base, scope);
        return this.call(fn, this.evalExpressionList(node.args, scope, -1));
      }
      case Kind.MethodCall: {
        const self = this.eval(node.base, scope);
        const fn = ops.index(this, self, node.method);
        return this.call(fn, [self, ...this.evalExpressionList(node.args, scope, -1)]);
      }
      case Kind.Vararg:
        return (scope.frame ? scope.frame.varargs : []).slice();
      default:
        return [this.eval(node, scope)];
    }
  }

  eval(node, scope) {
    this.tick();
    switch (node.kind) {
      case Kind.Nil: return undefined;
      case Kind.True: return true;
      case Kind.False: return false;
      case Kind.Number: return node.value;
      case Kind.String: return node.value;
      case Kind.Vararg: return this.evalMulti(node, scope)[0];
      case Kind.Name: {
        const cell = scope.lookup(node.name);
        if (cell) return cell.value;
        return ops.index(this, this.globals, node.name);
      }
      case Kind.Paren: return this.eval(node.expression, scope);
      case Kind.Function: return new LuaFunction(node, scope, null);
      case Kind.Index:
        return ops.index(this, this.eval(node.base, scope), this.eval(node.index, scope));
      case Kind.Call:
      case Kind.MethodCall:
        return this.evalMulti(node, scope)[0];
      case Kind.Table: return this.evalTable(node, scope);
      case Kind.Unary: return this.evalUnary(node, scope);
      case Kind.Binary: return this.evalBinary(node, scope);
      default:
        throw new LuaError(`unsupported expression: ${node.kind}`);
    }
  }

  evalTable(node, scope) {
    const table = new LuaTable();
    let arrayIndex = 1;
    const entries = node.entries || [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry.type === 'key') {
        table.set(this.eval(entry.key, scope), this.eval(entry.value, scope));
        continue;
      }
      if (i === entries.length - 1) {
        for (const value of this.evalMulti(entry.value, scope)) {
          table.set(arrayIndex, value);
          arrayIndex += 1;
        }
      } else {
        table.set(arrayIndex, this.eval(entry.value, scope));
        arrayIndex += 1;
      }
    }
    return table;
  }

  evalUnary(node, scope) {
    const value = this.eval(node.argument, scope);
    switch (node.operator) {
      case '-': return ops.unaryMinus(this, value);
      case 'not': return !truthy(value);
      case '#': return ops.length(this, value);
      default: throw new LuaError(`unknown unary operator '${node.operator}'`);
    }
  }

  evalBinary(node, scope) {
    const op = node.operator;
    if (op === 'and') {
      const lhs = this.eval(node.lhs, scope);
      return truthy(lhs) ? this.eval(node.rhs, scope) : lhs;
    }
    if (op === 'or') {
      const lhs = this.eval(node.lhs, scope);
      return truthy(lhs) ? lhs : this.eval(node.rhs, scope);
    }
    const a = this.eval(node.lhs, scope);
    const b = this.eval(node.rhs, scope);
    switch (op) {
      case '..': return ops.concat(this, a, b);
      case '==': return ops.equals(this, a, b);
      case '~=': return !ops.equals(this, a, b);
      case '<': return ops.lessThan(this, a, b);
      case '>': return ops.lessThan(this, b, a);
      case '<=': return ops.lessOrEqual(this, a, b);
      case '>=': return ops.lessOrEqual(this, b, a);
      default: return ops.arith(this, op, a, b);
    }
  }
}

module.exports = { Interpreter, Scope, LuaLimitError };

};

__modules["src/interp/ops.js"] = function(module, exports, require) {
'use strict';

const V = require("src/interp/values.js");

const { LuaError, LuaTable, luaType, truthy, toNumber } = V;

const EVENTS = {
  '+': '__add', '-': '__sub', '*': '__mul', '/': '__div',
  '%': '__mod', '^': '__pow', '..': '__concat',
};

function typeError(operation, value) {
  throw new LuaError(`cannot perform ${operation} on ${luaType(value)}`);
}

function arithMeta(rt, op, a, b) {
  const event = EVENTS[op];
  const handler = rt.metamethod(a, event) || rt.metamethod(b, event);
  if (handler) return rt.call(handler, [a, b])[0];
  const culprit = toNumber(a) === undefined ? a : b;
  return typeError(`arithmetic (${op})`, culprit);
}

function arith(rt, op, a, b) {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x === undefined || y === undefined) return arithMeta(rt, op, a, b);
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/': return x / y;
    case '%': return x - Math.floor(x / y) * y;
    case '^': return x ** y;
    case '//': return Math.floor(x / y);
    default: throw new LuaError(`unknown operator '${op}'`);
  }
}

function unaryMinus(rt, a) {
  const x = toNumber(a);
  if (x !== undefined) return -x;
  const handler = rt.metamethod(a, '__unm');
  if (handler) return rt.call(handler, [a, a])[0];
  return typeError('arithmetic (-)', a);
}

function length(rt, a) {
  if (typeof a === 'string') return a.length;
  const handler = rt.metamethod(a, '__len');
  if (handler) return rt.call(handler, [a])[0];
  if (a instanceof LuaTable) return a.length();
  return typeError('get length of', a);
}

function concat(rt, a, b) {
  const okA = typeof a === 'string' || typeof a === 'number';
  const okB = typeof b === 'string' || typeof b === 'number';
  if (okA && okB) return stringify(a) + stringify(b);
  const handler = rt.metamethod(a, '__concat') || rt.metamethod(b, '__concat');
  if (handler) return rt.call(handler, [a, b])[0];
  return typeError('concatenation', okA ? b : a);
}

function stringify(value) {
  return typeof value === 'number' ? V.numberToString(value) : value;
}

function rawEquals(a, b) {
  if (a === undefined || a === null) return b === undefined || b === null;
  return a === b;
}

function equals(rt, a, b) {
  if (rawEquals(a, b)) return true;
  if (luaType(a) !== luaType(b)) return false;
  if (!(a instanceof LuaTable) && luaType(a) !== 'userdata') return false;
  const handler = rt.metamethod(a, '__eq') || rt.metamethod(b, '__eq');
  if (!handler) return false;
  return truthy(rt.call(handler, [a, b])[0]);
}

function lessThan(rt, a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return a < b;
  const handler = rt.metamethod(a, '__lt') || rt.metamethod(b, '__lt');
  if (handler) return truthy(rt.call(handler, [a, b])[0]);
  throw new LuaError(`cannot compare ${luaType(a)} with ${luaType(b)}`);
}

function lessOrEqual(rt, a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a <= b;
  if (typeof a === 'string' && typeof b === 'string') return a <= b;
  const handler = rt.metamethod(a, '__le') || rt.metamethod(b, '__le');
  if (handler) return truthy(rt.call(handler, [a, b])[0]);
  const flipped = rt.metamethod(a, '__lt') || rt.metamethod(b, '__lt');
  if (flipped) return !truthy(rt.call(flipped, [b, a])[0]);
  throw new LuaError(`cannot compare ${luaType(a)} with ${luaType(b)}`);
}

function index(rt, base, key) {
  if (base instanceof LuaTable) {
    const value = base.get(key);
    if (value !== undefined && value !== null) return value;
    const handler = rt.metamethod(base, '__index');
    if (!handler) return undefined;
    if (V.isCallable(handler)) return rt.call(handler, [base, key])[0];
    return index(rt, handler, key);
  }
  const handler = rt.metamethod(base, '__index');
  if (!handler) return typeError(`index (key '${stringify(key)}')`, base);
  if (V.isCallable(handler)) return rt.call(handler, [base, key])[0];
  return index(rt, handler, key);
}

function setIndex(rt, base, key, value) {
  if (base instanceof LuaTable) {
    if (base.get(key) === undefined) {
      const handler = rt.metamethod(base, '__newindex');
      if (handler) {
        if (V.isCallable(handler)) {
          rt.call(handler, [base, key, value]);
          return;
        }
        setIndex(rt, handler, key, value);
        return;
      }
    }
    if (key === undefined || key === null) throw new LuaError('table index is nil');
    if (typeof key === 'number' && Number.isNaN(key)) throw new LuaError('table index is NaN');
    base.set(key, value);
    return;
  }
  const handler = rt.metamethod(base, '__newindex');
  if (!handler) {
    typeError(`index (key '${stringify(key)}')`, base);
    return;
  }
  if (V.isCallable(handler)) rt.call(handler, [base, key, value]);
  else setIndex(rt, handler, key, value);
}

function tostring(rt, value) {
  const handler = rt.metamethod(value, '__tostring');
  if (handler) return rt.call(handler, [value])[0];
  const type = luaType(value);
  switch (type) {
    case 'nil': return 'nil';
    case 'boolean': return value ? 'true' : 'false';
    case 'number': return V.numberToString(value);
    case 'string': return value;
    default: return `${type}: 0x${rt.addressOf(value)}`;
  }
}

module.exports = {
  arith,
  unaryMinus,
  length,
  concat,
  equals,
  rawEquals,
  lessThan,
  lessOrEqual,
  index,
  setIndex,
  tostring,
  stringify,
};

};

__modules["src/interp/patterns.js"] = function(module, exports, require) {
'use strict';

const { LuaError } = require("src/interp/values.js");

const L_ESC = '%';
const MAX_CAPS = 32;
const UNFINISHED = -1;
const POSITION = -2;

const isDigitCode = (c) => c >= 48 && c <= 57;
const isAlphaCode = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isLowerCode = (c) => c >= 97 && c <= 122;
const isUpperCode = (c) => c >= 65 && c <= 90;
const isSpaceCode = (c) => c === 32 || (c >= 9 && c <= 13);
const isControlCode = (c) => c < 32 || c === 127;
const isPunctCode = (c) => (c >= 33 && c <= 47) || (c >= 58 && c <= 64)
  || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
const isHexCode = (c) => isDigitCode(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);

function matchClass(code, classChar) {
  let result;
  switch (classChar.toLowerCase()) {
    case 'a': result = isAlphaCode(code); break;
    case 'c': result = isControlCode(code); break;
    case 'd': result = isDigitCode(code); break;
    case 'l': result = isLowerCode(code); break;
    case 'p': result = isPunctCode(code); break;
    case 's': result = isSpaceCode(code); break;
    case 'u': result = isUpperCode(code); break;
    case 'w': result = isAlphaCode(code) || isDigitCode(code); break;
    case 'x': result = isHexCode(code); break;
    case 'z': result = code === 0; break;
    default: return classChar.charCodeAt(0) === code;
  }
  return classChar >= 'A' && classChar <= 'Z' ? !result : result;
}

class Matcher {
  constructor(source, pattern) {
    this.src = source;
    this.pattern = pattern;
    this.level = 0;
    this.captureStart = new Array(MAX_CAPS).fill(0);
    this.captureLen = new Array(MAX_CAPS).fill(0);
    this.depth = 0;
  }

  error(message) {
    throw new LuaError(message);
  }

  classEnd(pi) {
    const p = this.pattern;
    const c = p[pi];
    pi += 1;
    if (c === L_ESC) {
      if (pi >= p.length) this.error("pattern ends with '%'");
      return pi + 1;
    }
    if (c === '[') {
      if (p[pi] === '^') pi += 1;
      do {
        if (pi >= p.length) this.error("missing ']' in pattern");
        const cc = p[pi];
        pi += 1;
        if (cc === L_ESC) {
          if (pi >= p.length) this.error("pattern ends with '%'");
          pi += 1;
        }
      } while (p[pi] !== ']');
      return pi + 1;
    }
    return pi;
  }

  matchBracketClass(code, pi, ecl) {
    const p = this.pattern;
    let negate = false;
    pi += 1;
    if (p[pi] === '^') {
      negate = true;
      pi += 1;
    }
    while (pi < ecl) {
      if (p[pi] === L_ESC) {
        pi += 1;
        if (matchClass(code, p[pi])) return !negate;
        pi += 1;
      } else if (p[pi + 1] === '-' && pi + 2 < ecl) {
        if (p.charCodeAt(pi) <= code && code <= p.charCodeAt(pi + 2)) return !negate;
        pi += 3;
      } else {
        if (p.charCodeAt(pi) === code) return !negate;
        pi += 1;
      }
    }
    return negate;
  }

  singleMatch(si, pi, ep) {
    if (si >= this.src.length) return false;
    const code = this.src.charCodeAt(si);
    const pc = this.pattern[pi];
    if (pc === '.') return true;
    if (pc === L_ESC) return matchClass(code, this.pattern[pi + 1]);
    if (pc === '[') return this.matchBracketClass(code, pi, ep - 1);
    return this.pattern.charCodeAt(pi) === code;
  }

  matchBalance(si, pi) {
    if (pi + 1 >= this.pattern.length) this.error("missing '%b' arguments");
    if (this.src[si] !== this.pattern[pi]) return -1;
    const begin = this.pattern[pi];
    const end = this.pattern[pi + 1];
    let count = 1;
    let i = si + 1;
    while (i < this.src.length) {
      const c = this.src[i];
      if (c === end) {
        count -= 1;
        if (count === 0) return i + 1;
      } else if (c === begin) {
        count += 1;
      }
      i += 1;
    }
    return -1;
  }

  maxExpand(si, pi, ep) {
    let i = 0;
    while (this.singleMatch(si + i, pi, ep)) i += 1;
    while (i >= 0) {
      const result = this.match(si + i, ep + 1);
      if (result !== -1) return result;
      i -= 1;
    }
    return -1;
  }

  minExpand(si, pi, ep) {
    for (;;) {
      const result = this.match(si, ep + 1);
      if (result !== -1) return result;
      if (this.singleMatch(si, pi, ep)) si += 1;
      else return -1;
    }
  }

  startCapture(si, pi, what) {
    const level = this.level;
    if (level >= MAX_CAPTURES) this.error('too many captures');
    this.captureStart[level] = si;
    this.captureLen[level] = what;
    this.level = level + 1;
    const result = this.match(si, pi);
    if (result === -1) this.level -= 1;
    return result;
  }

  endCapture(si, pi) {
    const level = this.captureToClose();
    this.captureLen[level] = si - this.captureStart[level];
    const result = this.match(si, pi);
    if (result === -1) this.captureLen[level] = CAP_UNFINISHED;
    return result;
  }

  captureToClose() {
    for (let level = this.level - 1; level >= 0; level -= 1) {
      if (this.captureLen[level] === CAP_UNFINISHED) return level;
    }
    return this.error('invalid capture');
  }

  matchCapture(si, index) {
    const level = index - 49;
    if (level < 0 || level >= this.level || this.captureLen[level] === CAP_UNFINISHED) {
      this.error(`invalid capture index %${level + 1}`);
    }
    const len = this.captureLen[level];
    const captured = this.src.substr(this.captureStart[level], len);
    if (this.src.substr(si, len) === captured) return si + len;
    return -1;
  }

  match(si, pi) {
    this.depth += 1;
    if (this.depth > 220) this.error('pattern too complex');
    try {
      return this.matchInner(si, pi);
    } finally {
      this.depth -= 1;
    }
  }

  matchInner(si, pi) {
    const p = this.pattern;
    for (;;) {
      if (pi >= p.length) return si;
      switch (p[pi]) {
        case '(':
          return p[pi + 1] === ')'
            ? this.startCapture(si, pi + 2, POSITION)
            : this.startCapture(si, pi + 1, UNFINISHED);
        case ')':
          return this.endCapture(si, pi + 1);
        case '$':
          if (pi + 1 === p.length) return si === this.src.length ? si : -1;
          break;
        case L_ESC:
          switch (p[pi + 1]) {
            case 'b': {
              const result = this.matchBalance(si, pi + 2);
              if (result === -1) return -1;
              si = result;
              pi += 4;
              continue;
            }
            case 'f': {
              pi += 2;
              if (p[pi] !== '[') this.error("expected '[' after '%f'");
              const ep = this.classEnd(pi);
              const previous = si === 0 ? 0 : this.src.charCodeAt(si - 1);
              const current = si < this.src.length ? this.src.charCodeAt(si) : 0;
              if (!this.matchBracketClass(previous, pi, ep - 1)
                && this.matchBracketClass(current, pi, ep - 1)) {
                pi = ep;
                continue;
              }
              return -1;
            }
            default:
              if (isDigitCode(p.charCodeAt(pi + 1))) {
                const result = this.matchCapture(si, p.charCodeAt(pi + 1));
                if (result === -1) return -1;
                si = result;
                pi += 2;
                continue;
              }
              break;
          }
          break;
        default:
          break;
      }
      const ep = this.classEnd(pi);
      const matches = this.singleMatch(si, pi, ep);
      const suffix = ep < p.length ? p[ep] : '';
      if (suffix === '?') {
        if (matches) {
          const result = this.match(si + 1, ep + 1);
          if (result !== -1) return result;
        }
        pi = ep + 1;
        continue;
      }
      if (suffix === '+') return matches ? this.maxExpand(si + 1, pi, ep) : -1;
      if (suffix === '*') return this.maxExpand(si, pi, ep);
      if (suffix === '-') return this.minExpand(si, pi, ep);
      if (!matches) return -1;
      si += 1;
      pi = ep;
    }
  }

  captures(start, end, wholeIfNone = true) {
    if (this.level === 0 && wholeIfNone) return [this.src.slice(start, end)];
    const out = [];
    for (let i = 0; i < this.level; i += 1) {
      if (this.captureLen[i] === POSITION) out.push(this.captureStart[i] + 1);
      else out.push(this.src.substr(this.captureStart[i], this.captureLen[i]));
    }
    return out;
  }
}

function find(source, pattern, init = 0) {
  const anchored = pattern[0] === '^';
  const p = anchored ? 1 : 0;
  let si = init;
  do {
    const matcher = new Matcher(source, pattern);
    matcher.level = 0;
    const end = matcher.match(si, p);
    if (end !== -1) {
      return { start: si, end, captures: matcher.captures(si, end), matcher };
    }
    si += 1;
  } while (si <= source.length && !anchored);
  return null;
}

module.exports = { find, Matcher };

};

__modules["src/interp/stdlib.js"] = function(module, exports, require) {
'use strict';

const V = require("src/interp/values.js");
const ops = require("src/interp/ops.js");
const strlib = require("src/interp/strlib.js");

const { LuaError, LuaTable, LuaFunction, luaType, truthy } = V;

function installBase(rt) {
  const g = rt.globals;
  g.set('_VERSION', 'Lua 5.1');
  g.set('_G', g);

  g.set('print', (i, args) => {
    const parts = args.map((value) => ops.tostring(i, value));
    i.output.push(parts.join('\t'));
    return [];
  });
  g.set('type', (i, args) => [luaType(args[0])]);
  g.set('tostring', (i, args) => [ops.tostring(i, args[0])]);
  g.set('tonumber', (i, args) => {
    if (args[1] === undefined || args[1] === null) return [V.toNumber(args[0])];
    const base = Math.floor(V.toNumber(args[1]));
    const text = typeof args[0] === 'string' ? args[0].trim() : undefined;
    if (text === undefined) return [undefined];
    const value = parseInt(text, base);
    return [Number.isNaN(value) ? undefined : value];
  });
  g.set('rawget', (i, args) => [args[0] instanceof LuaTable ? args[0].get(args[1]) : undefined]);
  g.set('rawset', (i, args) => {
    if (args[0] instanceof LuaTable) args[0].set(args[1], args[2]);
    return [args[0]];
  });
  g.set('rawequal', (i, args) => [ops.rawEquals(args[0], args[1])]);
  g.set('rawlen', (i, args) => [ops.length(i, args[0])]);
  g.set('setmetatable', (i, args) => {
    if (!(args[0] instanceof LuaTable)) {
      throw new LuaError("setmetatable: expected table");
    }
    args[0].setMetatable(args[1] === undefined || args[1] === null ? undefined : args[1]);
    return [args[0]];
  });
  g.set('getmetatable', (i, args) => {
    const value = args[0];
    const metatable = value instanceof LuaTable ? value.metatable
      : (typeof value === 'string' ? i.stringMeta : (value && value.__metatable));
    if (!metatable) return [undefined];
    const guard = metatable.get('__metatable');
    return [guard === undefined ? metatable : guard];
  });
  g.set('assert', (i, args) => {
    if (!truthy(args[0])) {
      throw new LuaError(args[1] === undefined ? 'assertion failed!' : args[1]);
    }
    return args;
  });
  g.set('error', (i, args) => {
    const value = args[0];
    const level = args[1] === undefined ? 1 : V.toNumber(args[1]);
    if (typeof value === 'string' && level !== 0) {
      throw new LuaError(`deobf:0: ${value}`);
    }
    throw new LuaError(value);
  });
  g.set('select', (i, args) => {
    const selector = args[0];
    const rest = args.slice(1);
    if (selector === '#') return [rest.length];
    const n = Math.floor(V.toNumber(selector));
    if (n < 0) return rest.slice(rest.length + n);
    return rest.slice(n - 1);
  });
  g.set('unpack', (i, args) => {
    const table = args[0];
    if (!(table instanceof LuaTable)) return [];
    const from = args[1] === undefined ? 1 : Math.floor(V.toNumber(args[1]));
    const to = args[2] === undefined ? table.length() : Math.floor(V.toNumber(args[2]));
    const out = [];
    for (let k = from; k <= to; k += 1) out.push(table.get(k));
    return out;
  });
  g.set('next', (i, args) => nextImpl(args[0], args[1]));
  g.set('pairs', (i, args) => {
    const table = args[0];
    const handler = i.metamethod(table, '__pairs');
    if (handler) return i.call(handler, [table]);
    return [g.get('next'), table, undefined];
  });
  g.set('ipairs', (i, args) => {
    const table = args[0];
    const iterator = (inner, iargs) => {
      const index = Math.floor(V.toNumber(iargs[1])) + 1;
      const value = ops.index(inner, iargs[0], index);
      if (value === undefined || value === null) return [undefined];
      return [index, value];
    };
    return [iterator, table, 0];
  });
  g.set('pcall', (i, args) => {
    const fn = args[0];
    try {
      return [true, ...i.call(fn, args.slice(1))];
    } catch (error) {
      if (error && error.sandbox) throw error;
      if (error && error.name === 'LuaLimitError') throw error;
      i.swallows = (i.swallows || 0) + 1;
      if (error instanceof LuaError) return [false, error.value];
      return [false, String(error && error.message ? error.message : error)];
    }
  });
  g.set('xpcall', (i, args) => {
    const [fn, handler] = args;
    try {
      return [true, ...i.call(fn, args.slice(2))];
    } catch (error) {
      if (error && error.sandbox) throw error;
      if (!(error instanceof LuaError) && error && error.name === 'LuaLimitError') throw error;
      i.swallows = (i.swallows || 0) + 1;
      const value = error instanceof LuaError ? error.value : String(error.message || error);
      return [false, ...i.call(handler, [value])];
    }
  });
  g.set('getfenv', (i) => [i.globals]);
  g.set('setfenv', (i, args) => [args[0]]);
  g.set('collectgarbage', () => [0]);
  g.set('require', () => []);
  g.set('newproxy', (i, args) => {
    const proxy = { userdata: true, __metatable: undefined };
    if (truthy(args[0])) proxy.__metatable = new LuaTable();
    return [proxy];
  });
}

function nextImpl(table, key) {
  if (!(table instanceof LuaTable)) throw new LuaError("next: expected table");
  const keys = table.keys();
  if (key === undefined || key === null) {
    if (keys.length === 0) return [undefined];
    return [keys[0], table.get(keys[0])];
  }
  const at = keys.indexOf(typeof key === 'number' && Object.is(key, -0) ? 0 : key);
  if (at === -1 || at === keys.length - 1) return [undefined];
  const nextKey = keys[at + 1];
  return [nextKey, table.get(nextKey)];
}

function installTable(rt) {
  const table = new LuaTable();
  table.set('insert', (i, args) => {
    const t = args[0];
    if (!(t instanceof LuaTable)) throw new LuaError("table.insert: expected table");
    if (args.length <= 2) {
      t.set(t.length() + 1, args[1]);
      return [];
    }
    const position = Math.floor(V.toNumber(args[1]));
    const size = t.length();
    for (let k = size; k >= position; k -= 1) t.set(k + 1, t.get(k));
    t.set(position, args[2]);
    return [];
  });
  table.set('remove', (i, args) => {
    const t = args[0];
    if (!(t instanceof LuaTable)) throw new LuaError("table.remove: expected table");
    const size = t.length();
    const position = args[1] === undefined ? size : Math.floor(V.toNumber(args[1]));
    if (size === 0) return [undefined];
    const removed = t.get(position);
    for (let k = position; k < size; k += 1) t.set(k, t.get(k + 1));
    t.set(size, undefined);
    return [removed];
  });
  table.set('concat', (i, args) => {
    const t = args[0];
    const separator = args[1] === undefined ? '' : ops.stringify(args[1]);
    const from = args[2] === undefined ? 1 : Math.floor(V.toNumber(args[2]));
    const to = args[3] === undefined ? t.length() : Math.floor(V.toNumber(args[3]));
    const parts = [];
    for (let k = from; k <= to; k += 1) {
      const value = t.get(k);
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new LuaError(`table.concat: invalid value at index ${k}`);
      }
      parts.push(ops.stringify(value));
    }
    return [parts.join(separator)];
  });
  table.set('unpack', rt.globals.get('unpack'));
  table.set('pack', (i, args) => {
    const t = LuaTable.from(args);
    t.set('n', args.length);
    return [t];
  });
  table.set('sort', (i, args) => {
    const t = args[0];
    const comparator = args[1];
    const values = t.toArray();
    const compare = comparator
      ? (a, b) => (truthy(i.call(comparator, [a, b])[0]) ? -1 : (truthy(i.call(comparator, [b, a])[0]) ? 1 : 0))
      : (a, b) => (ops.lessThan(i, a, b) ? -1 : (ops.lessThan(i, b, a) ? 1 : 0));
    values.sort(compare);
    for (let k = 0; k < values.length; k += 1) t.set(k + 1, values[k]);
    return [];
  });
  table.set('getn', (i, args) => [args[0].length()]);
  rt.globals.set('table', table);
}

function installMath(rt) {
  const math = new LuaTable();
  const unary = (fn) => (i, args) => [fn(strlib.checkNumber(args, 0, 'math'))];
  math.set('floor', unary(Math.floor));
  math.set('ceil', unary(Math.ceil));
  math.set('abs', unary(Math.abs));
  math.set('sqrt', unary(Math.sqrt));
  math.set('sin', unary(Math.sin));
  math.set('cos', unary(Math.cos));
  math.set('tan', unary(Math.tan));
  math.set('asin', unary(Math.asin));
  math.set('acos', unary(Math.acos));
  math.set('atan', unary(Math.atan));
  math.set('exp', unary(Math.exp));
  math.set('log', (i, args) => {
    const x = strlib.checkNumber(args, 0, 'log');
    if (args[1] === undefined) return [Math.log(x)];
    return [Math.log(x) / Math.log(strlib.checkNumber(args, 1, 'log'))];
  });
  math.set('log10', unary(Math.log10));
  math.set('pow', (i, args) => [strlib.checkNumber(args, 0, 'pow') ** strlib.checkNumber(args, 1, 'pow')]);
  math.set('fmod', (i, args) => {
    const a = strlib.checkNumber(args, 0, 'fmod');
    const b = strlib.checkNumber(args, 1, 'fmod');
    return [a % b];
  });
  math.set('modf', (i, args) => {
    const x = strlib.checkNumber(args, 0, 'modf');
    const integral = x >= 0 ? Math.floor(x) : Math.ceil(x);
    return [integral, x - integral];
  });
  math.set('max', (i, args) => [Math.max(...args.map((v) => V.toNumber(v)))]);
  math.set('min', (i, args) => [Math.min(...args.map((v) => V.toNumber(v)))]);
  math.set('huge', Infinity);
  math.set('pi', Math.PI);
  math.set('random', (i, args) => {
    const value = i.random();
    if (args.length === 0) return [value];
    const lower = args.length === 1 ? 1 : Math.floor(V.toNumber(args[0]));
    const upper = args.length === 1 ? Math.floor(V.toNumber(args[0])) : Math.floor(V.toNumber(args[1]));
    return [lower + Math.floor(value * (upper - lower + 1))];
  });
  math.set('randomseed', (i, args) => {
    i.seedRandom(V.toNumber(args[0]) || 0);
    return [];
  });
  rt.globals.set('math', math);
}

function installMisc(rt) {
  const os = new LuaTable();
  os.set('time', () => [1600000000]);
  os.set('clock', (i) => [i.steps / 1e6]);
  os.set('date', (i, args) => [typeof args[0] === 'string' ? args[0] : 'Mon Jan  1 00:00:00 2020']);
  os.set('getenv', () => [undefined]);
  os.set('exit', () => {
    throw new LuaError('os.exit called');
  });
  rt.globals.set('os', os);

  const debug = new LuaTable();
  debug.set('getinfo', (i, args) => {
    const info = new LuaTable();
    info.set('currentline', 1);
    info.set('source', '@deobf');
    info.set('short_src', 'deobf');
    info.set('what', 'Lua');
    info.set('func', args[0]);
    info.set('linedefined', 1);
    return [info];
  });
  debug.set('sethook', () => []);
  debug.set('gethook', () => [undefined]);
  debug.set('traceback', (i, args) => [typeof args[0] === 'string' ? args[0] : 'stack traceback:']);
  debug.set('getlocal', () => [undefined]);
  debug.set('getupvalue', () => [undefined]);
  debug.set('setupvalue', () => [undefined]);
  debug.set('getmetatable', (i, args) => [args[0] instanceof LuaTable ? args[0].metatable : undefined]);
  debug.set('setmetatable', (i, args) => {
    if (args[0] instanceof LuaTable) args[0].setMetatable(args[1]);
    return [args[0]];
  });
  rt.globals.set('debug', debug);

  const io = new LuaTable();
  io.set('write', (i, args) => {
    i.output.push(args.map((v) => ops.stringify(v)).join(''));
    return [];
  });
  io.set('read', () => [undefined]);
  rt.globals.set('io', io);

  const coroutine = new LuaTable();
  coroutine.set('create', (i, args) => [args[0]]);
  coroutine.set('wrap', (i, args) => [args[0]]);
  coroutine.set('resume', (i, args) => [true, ...i.call(args[0], args.slice(1))]);
  coroutine.set('yield', () => []);
  coroutine.set('status', () => ['dead']);
  rt.globals.set('coroutine', coroutine);

  const bit = new LuaTable();
  const toInt = (v) => Math.trunc(V.toNumber(v)) | 0;
  bit.set('band', (i, args) => [args.map(toInt).reduce((a, b) => a & b)]);
  bit.set('bor', (i, args) => [args.map(toInt).reduce((a, b) => a | b)]);
  bit.set('bxor', (i, args) => [args.map(toInt).reduce((a, b) => a ^ b)]);
  bit.set('bnot', (i, args) => [~toInt(args[0])]);
  bit.set('lshift', (i, args) => [toInt(args[0]) << toInt(args[1])]);
  bit.set('rshift', (i, args) => [toInt(args[0]) >>> toInt(args[1])]);
  bit.set('arshift', (i, args) => [toInt(args[0]) >> toInt(args[1])]);
  bit.set('tobit', (i, args) => [toInt(args[0])]);
  rt.globals.set('bit', bit);
  rt.globals.set('bit32', bit);
}

function installRandom(rt) {
  let state = 0x2545f491;
  rt.seedRandom = (seed) => {
    state = (Math.floor(seed) >>> 0) || 1;
  };
  rt.random = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function install(rt) {
  installRandom(rt);
  installBase(rt);
  strlib.install(rt);
  installTable(rt);
  installMath(rt);
  installMisc(rt);
}

module.exports = { install };

};

__modules["src/interp/strlib.js"] = function(module, exports, require) {
'use strict';

const V = require("src/interp/values.js");
const ops = require("src/interp/ops.js");
const patterns = require("src/interp/patterns.js");

const { LuaError, LuaTable, luaType } = V;

const argError = (n, fname, expected, got) => {
  throw new LuaError(`${fname}: arg #${n} expected ${expected}, got ${luaType(got)}`);
};

function checkString(args, i, fname) {
  const value = args[i];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return V.numberToString(value);
  return argError(i + 1, fname, 'string', value);
}

function checkNumber(args, i, fname) {
  const value = V.toNumber(args[i]);
  if (value === undefined) return argError(i + 1, fname, 'number', args[i]);
  return value;
}

function optNumber(args, i, fallback) {
  if (args[i] === undefined || args[i] === null) return fallback;
  const value = V.toNumber(args[i]);
  return value === undefined ? fallback : value;
}

function relative(position, length) {
  if (position >= 0) return position;
  if (-position > length) return 0;
  return length + position + 1;
}

function formatValue(rt, spec, value) {
  const conversion = spec[spec.length - 1];
  const flags = spec.slice(1, -1);
  const widthMatch = /^([-+ #0]*)(\d*)(?:\.(\d+))?$/.exec(flags) || ['', '', '', undefined];
  const [, modifiers, widthText, precisionText] = widthMatch;
  const width = widthText ? Number(widthText) : 0;
  const precision = precisionText === undefined ? undefined : Number(precisionText);
  let text;
  switch (conversion) {
    case 'd': case 'i': {
      const n = Math.trunc(checkNumber([value], 0, 'format'));
      text = String(Math.abs(n));
      if (precision !== undefined) text = text.padStart(precision, '0');
      if (n < 0) text = `-${text}`;
      else if (modifiers.includes('+')) text = `+${text}`;
      break;
    }
    case 'u': text = String(Math.trunc(Math.abs(checkNumber([value], 0, 'format')))); break;
    case 'c': text = String.fromCharCode(checkNumber([value], 0, 'format')); break;
    case 'x': case 'X': {
      const n = Math.trunc(checkNumber([value], 0, 'format'));
      text = (n < 0 ? n >>> 0 : n).toString(16);
      if (precision !== undefined) text = text.padStart(precision, '0');
      if (conversion === 'X') text = text.toUpperCase();
      if (modifiers.includes('#')) text = `0${conversion}${text}`;
      break;
    }
    case 'o': text = Math.trunc(checkNumber([value], 0, 'format')).toString(8); break;
    case 'f': case 'F':
      text = checkNumber([value], 0, 'format').toFixed(precision === undefined ? 6 : precision);
      break;
    case 'e': case 'E': {
      text = checkNumber([value], 0, 'format').toExponential(precision === undefined ? 6 : precision);
      text = text.replace(/e([-+])(\d)$/, 'e$10$2');
      if (conversion === 'E') text = text.toUpperCase();
      break;
    }
    case 'g': case 'G': {
      text = V.formatFloat(checkNumber([value], 0, 'format'), precision === undefined ? 6 : precision);
      if (conversion === 'G') text = text.toUpperCase();
      break;
    }
    case 's': {
      text = ops.tostring(rt, value);
      if (precision !== undefined) text = text.slice(0, precision);
      break;
    }
    case 'q': {
      const raw = typeof value === 'string' ? value : ops.tostring(rt, value);
      let quoted = '"';
      for (let i = 0; i < raw.length; i += 1) {
        const c = raw[i];
        const code = raw.charCodeAt(i);
        if (c === '"' || c === '\\' || c === '\n') quoted += `\\${c === '\n' ? 'n' : c}`;
        else if (code === 0) quoted += '\\0';
        else if (code < 32 || code === 127) quoted += `\\${code}`;
        else quoted += c;
      }
      text = `${quoted}"`;
      break;
    }
    default:
      throw new LuaError(`format: invalid option '%${conversion}'`);
  }
  if (width > text.length) {
    text = modifiers.includes('-')
      ? text.padEnd(width, ' ')
      : text.padStart(width, modifiers.includes('0') && 'dioxXufFeEgG'.includes(conversion) ? '0' : ' ');
  }
  return text;
}

function format(rt, args) {
  const spec = checkString(args, 0, 'format');
  let out = '';
  let argIndex = 1;
  let i = 0;
  while (i < spec.length) {
    const c = spec[i];
    if (c !== '%') {
      out += c;
      i += 1;
      continue;
    }
    if (spec[i + 1] === '%') {
      out += '%';
      i += 2;
      continue;
    }
    let j = i + 1;
    while (j < spec.length && '-+ #0'.includes(spec[j])) j += 1;
    while (j < spec.length && spec[j] >= '0' && spec[j] <= '9') j += 1;
    if (spec[j] === '.') {
      j += 1;
      while (j < spec.length && spec[j] >= '0' && spec[j] <= '9') j += 1;
    }
    const directive = spec.slice(i, j + 1);
    out += formatValue(rt, directive, args[argIndex]);
    argIndex += 1;
    i = j + 1;
  }
  return [out];
}

function expandReplacement(template, whole, captures) {
  let out = '';
  for (let i = 0; i < template.length; i += 1) {
    const c = template[i];
    if (c !== '%') {
      out += c;
      continue;
    }
    const next = template[i + 1];
    i += 1;
    if (next === '%') {
      out += '%';
      continue;
    }
    if (next >= '0' && next <= '9') {
      if (next === '0') out += whole;
      else {
        const value = captures[Number(next) - 1];
        out += typeof value === 'number' ? V.numberToString(value) : value;
      }
      continue;
    }
    throw new LuaError('gsub: invalid \'%\' in replacement');
  }
  return out;
}

function gsub(rt, args) {
  const source = checkString(args, 0, 'gsub');
  const pattern = checkString(args, 1, 'gsub');
  const replacement = args[2];
  const maxCount = optNumber(args, 3, Infinity);
  let out = '';
  let position = 0;
  let count = 0;
  const anchored = pattern[0] === '^';
  while (count < maxCount) {
    const matcher = new patterns.Matcher(source, pattern);
    const end = matcher.match(position, anchored ? 1 : 0);
    if (end !== -1) {
      count += 1;
      const whole = source.slice(position, end);
      const captures = matcher.captures(position, end);
      let value;
      if (typeof replacement === 'string' || typeof replacement === 'number') {
        value = expandReplacement(String(replacement), whole, captures);
      } else if (replacement instanceof LuaTable) {
        value = replacement.get(captures[0]);
      } else if (V.isCallable(replacement)) {
        value = rt.call(replacement, captures)[0];
      } else {
        throw new LuaError('gsub: invalid replacement type');
      }
      if (value === undefined || value === null || value === false) out += whole;
      else if (typeof value === 'number') out += V.numberToString(value);
      else if (typeof value === 'string') out += value;
      else throw new LuaError('gsub: invalid replacement value');
      if (end > position) {
        position = end;
      } else {
        if (position < source.length) out += source[position];
        position += 1;
      }
    } else {
      if (position < source.length) out += source[position];
      position += 1;
    }
    if (position > source.length || anchored) break;
  }
  out += source.slice(Math.min(position, source.length));
  return [out, count];
}

function find(rt, args, wantCaptures) {
  const source = checkString(args, 0, 'find');
  const pattern = checkString(args, 1, 'find');
  const init = relative(optNumber(args, 2, 1), source.length);
  const plain = V.truthy(args[3]);
  const start = Math.max(0, init - 1);
  if (start > source.length) return [undefined];
  if (!wantCaptures && plain) {
    const at = source.indexOf(pattern, start);
    return at === -1 ? [undefined] : [at + 1, at + pattern.length];
  }
  const result = patterns.find(source, pattern, start);
  if (!result) return [undefined];
  if (wantCaptures) return result.captures;
  return [result.start + 1, result.end, ...result.matcher.captures(result.start, result.end, false)];
}

function gmatch(rt, args) {
  const source = checkString(args, 0, 'gmatch');
  const pattern = checkString(args, 1, 'gmatch');
  let position = 0;
  const iterator = () => {
    while (position <= source.length) {
      const matcher = new patterns.Matcher(source, pattern);
      const end = matcher.match(position, 0);
      if (end !== -1) {
        const captures = matcher.captures(position, end);
        position = end > position ? end : position + 1;
        return captures;
      }
      position += 1;
    }
    return [undefined];
  };
  return [iterator];
}

function install(rt) {
  const string = new LuaTable();
  const set = (name, fn) => string.set(name, fn);

  set('len', (i, args) => [checkString(args, 0, 'len').length]);
  set('sub', (i, args) => {
    const s = checkString(args, 0, 'sub');
    let start = relative(optNumber(args, 1, 1), s.length);
    let end = relative(optNumber(args, 2, -1), s.length);
    if (start < 1) start = 1;
    if (end > s.length) end = s.length;
    return [start > end ? '' : s.slice(start - 1, end)];
  });
  set('upper', (i, args) => [checkString(args, 0, 'upper').toUpperCase()]);
  set('lower', (i, args) => [checkString(args, 0, 'lower').toLowerCase()]);
  set('reverse', (i, args) => [[...checkString(args, 0, 'reverse')].reverse().join('')]);
  set('rep', (i, args) => {
    const s = checkString(args, 0, 'rep');
    const n = Math.floor(checkNumber(args, 1, 'rep'));
    const separator = args[2] === undefined ? '' : checkString(args, 2, 'rep');
    if (n <= 0) return [''];
    const parts = new Array(n).fill(s);
    return [parts.join(separator)];
  });
  set('byte', (i, args) => {
    const s = checkString(args, 0, 'byte');
    let start = relative(optNumber(args, 1, 1), s.length);
    let end = relative(optNumber(args, 2, start), s.length);
    if (start < 1) start = 1;
    if (end > s.length) end = s.length;
    const out = [];
    for (let k = start; k <= end; k += 1) out.push(s.charCodeAt(k - 1));
    return out;
  });
  set('char', (i, args) => {
    let out = '';
    for (let k = 0; k < args.length; k += 1) {
      out += String.fromCharCode(Math.floor(checkNumber(args, k, 'char')) & 0xff);
    }
    return [out];
  });
  set('format', format);
  set('gsub', gsub);
  set('find', (i, args) => find(i, args, false));
  set('match', (i, args) => find(i, args, true));
  set('gmatch', gmatch);

  rt.globals.set('string', string);

  const meta = new LuaTable();
  meta.set('__index', string);
  rt.stringMeta = meta;
  return string;
}

module.exports = { install, checkNumber };

};

__modules["src/interp/values.js"] = function(module, exports, require) {
'use strict';

const effects = require("src/interp/effects.js");

class LuaError extends Error {
  constructor(value, traceback) {
    super(typeof value === 'string' ? value : '(error object)');
    this.name = 'LuaError';
    this.value = value;
    this.luaTraceback = traceback;
  }
}

class LuaTable {
  constructor() {
    this.map = new Map();
    this.metatable = undefined;

    this.stamp = effects.fresh();
  }

  static from(values) {
    const t = new LuaTable();
    for (let i = 0; i < values.length; i += 1) t.set(i + 1, values[i]);
    return t;
  }

  static fromPairs(pairs) {
    const t = new LuaTable();
    for (const [key, value] of pairs) t.set(key, value);
    return t;
  }

  get(key) {
    if (typeof key === 'number' && Object.is(key, -0)) return this.map.get(0);
    return this.map.get(key);
  }

  set(key, value) {
    const k = typeof key === 'number' && Object.is(key, -0) ? 0 : key;
    effects.touch(this.stamp, this, k);
    if (value === undefined) this.map.delete(k);
    else this.map.set(k, value);
  }

  setMetatable(metatable) {
    effects.touch(this.stamp, this, effects.META);
    this.metatable = metatable;
  }

  length() {
    let n = 0;
    while (this.map.get(n + 1) !== undefined) n += 1;
    return n;
  }

  toArray() {
    const out = [];
    const n = this.length();
    for (let i = 1; i <= n; i += 1) out.push(this.map.get(i));
    return out;
  }

  keys() {
    return [...this.map.keys()];
  }
}

class LuaFunction {
  constructor(node, closure, name) {
    this.node = node;
    this.closure = closure;
    this.name = name || null;
  }
}

const isCallable = (v) => typeof v === 'function' || v instanceof LuaFunction;

function luaType(value) {
  if (value === undefined || value === null) return 'nil';
  switch (typeof value) {
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'string': return 'string';
    case 'function': return 'function';
    default: break;
  }
  if (value instanceof LuaTable) return 'table';
  if (value instanceof LuaFunction) return 'function';
  return 'userdata';
}

const truthy = (value) => value !== undefined && value !== null && value !== false;

function formatFloat(value, precision = 14) {
  if (Number.isNaN(value)) return 'nan';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  if (exponent < -4 || exponent >= precision) {
    let mantissa = (value / 10 ** exponent).toPrecision(precision);
    if (mantissa.includes('.')) mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
    const sign = exponent < 0 ? '-' : '+';
    const digits = String(Math.abs(exponent)).padStart(2, '0');
    return `${mantissa}e${sign}${digits}`;
  }
  let text = value.toFixed(Math.max(0, precision - 1 - exponent));
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return text;
}

function numberToString(value) {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return formatFloat(value);
}

function stringToNumber(text) {
  const trimmed = text.replace(/^[\s\f]+|[\s\f]+$/g, '');
  if (trimmed === '') return undefined;
  if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(trimmed)) {
    const negative = trimmed[0] === '-';
    const body = trimmed.replace(/^[-+]/, '');
    const value = parseInt(body.slice(2), 16);
    return negative ? -value : value;
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isNaN(value) ? undefined : value;
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return stringToNumber(value);
  return undefined;
}

module.exports = {
  LuaError,
  LuaTable,
  LuaFunction,
  isCallable,
  luaType,
  truthy,
  formatFloat,
  numberToString,
  toNumber,
};

};

__modules["src/lua/ast.js"] = function(module, exports, require) {
'use strict';

const Kind = {
  Chunk: 'Chunk',
  Block: 'Block',

  LocalDeclaration: 'LocalDeclaration',
  LocalFunction: 'LocalFunction',
  FunctionDeclaration: 'FunctionDeclaration',
  Assignment: 'Assignment',
  CallStatement: 'CallStatement',
  Return: 'Return',
  Break: 'Break',
  Continue: 'Continue',
  Do: 'Do',
  While: 'While',
  Repeat: 'Repeat',
  If: 'If',
  NumericFor: 'NumericFor',
  GenericFor: 'GenericFor',
  Goto: 'Goto',
  Label: 'Label',

  Nil: 'Nil',
  True: 'True',
  False: 'False',
  Number: 'Number',
  String: 'String',
  Vararg: 'Vararg',
  Function: 'Function',
  Table: 'Table',
  Binary: 'Binary',
  Unary: 'Unary',
  Index: 'Index',
  Call: 'Call',
  MethodCall: 'MethodCall',
  Name: 'Name',
  Paren: 'Paren',
};

const EXPRS = new Set([
  Kind.Nil, Kind.True, Kind.False, Kind.Number, Kind.String, Kind.Vararg,
  Kind.Function, Kind.Table, Kind.Binary, Kind.Unary, Kind.Index, Kind.Call,
  Kind.MethodCall, Kind.Name, Kind.Paren,
]);

const LITERALS = new Set([Kind.Nil, Kind.True, Kind.False, Kind.Number, Kind.String]);

const ASSIGNABLE = new Set([Kind.Name, Kind.Index]);

const MULTIVAL = new Set([Kind.Call, Kind.MethodCall, Kind.Vararg]);

const block = (statements = []) => ({ kind: Kind.Block, statements });
const chunk = (body) => ({ kind: Kind.Chunk, body: body || block() });
const nil = () => ({ kind: Kind.Nil });
const boolean = (value) => ({ kind: value ? Kind.True : Kind.False });
const number = (value) => ({ kind: Kind.Number, value });
const string = (value) => ({ kind: Kind.String, value });
const vararg = () => ({ kind: Kind.Vararg });
const name = (id) => ({ kind: Kind.Name, name: id });
const paren = (expression) => ({ kind: Kind.Paren, expression });
const binary = (operator, lhs, rhs) => ({ kind: Kind.Binary, operator, lhs, rhs });
const unary = (operator, argument) => ({ kind: Kind.Unary, operator, argument });
const index = (base, key, dot = false) => ({ kind: Kind.Index, base, index: key, dot });
const call = (base, args = []) => ({ kind: Kind.Call, base, args });
const methodCall = (base, method, args = []) => ({ kind: Kind.MethodCall, base, method, args });
const table = (entries = []) => ({ kind: Kind.Table, entries });
const func = (params, body, isVararg = false) => ({
  kind: Kind.Function, params, body: body || block(), isVararg,
});

const localDecl = (names, expressions = []) => ({
  kind: Kind.LocalDeclaration, names, expressions,
});
const assignment = (targets, expressions) => ({ kind: Kind.Assignment, targets, expressions });
const callStatement = (expression) => ({ kind: Kind.CallStatement, expression });
const returnStatement = (expressions = []) => ({ kind: Kind.Return, expressions });
const breakStatement = () => ({ kind: Kind.Break });
const doStatement = (body) => ({ kind: Kind.Do, body });
const whileStatement = (condition, body) => ({ kind: Kind.While, condition, body });
const repeatStatement = (body, condition) => ({ kind: Kind.Repeat, body, condition });
const ifStatement = (condition, body, elseIfs = [], elseBody = null) => ({
  kind: Kind.If, condition, body, elseIfs, elseBody,
});
const numericFor = (variable, start, limit, step, body) => ({
  kind: Kind.NumericFor, variable, start, limit, step, body,
});
const genericFor = (variables, expressions, body) => ({
  kind: Kind.GenericFor, variables, expressions, body,
});

const unparen = (node) => {
  let current = node;
  while (current && current.kind === Kind.Paren) current = current.expression;
  return current;
};

const isLiteral = (node) => !!node && LITERALS.has(node.kind);
const isMultiValue = (node) => !!node && MULTIVAL.has(node.kind);
const isExpression = (node) => !!node && EXPRS.has(node.kind);

module.exports = {
  Kind,
  LITERALS,
  ASSIGNABLE,
  isLiteral,
  unparen,
  isMultiValue,
  isExpression,
  block,
  chunk,
  nil,
  boolean,
  number,
  string,
  vararg,
  name,
  paren,
  binary,
  unary,
  index,
  call,
  methodCall,
  table,
  func,
  localDecl,
  assignment,
  callStatement,
  returnStatement,
  breakStatement,
  doStatement,
  whileStatement,
  repeatStatement,
  ifStatement,
  numericFor,
  genericFor,
};

};

__modules["src/lua/chars.js"] = function(module, exports, require) {
'use strict';

const isDigit = (c) => c >= '0' && c <= '9';
const isHex = (c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const isLower = (c) => c >= 'a' && c <= 'z';
const isUpper = (c) => c >= 'A' && c <= 'Z';
const isAlpha = (c) => isLower(c) || isUpper(c) || c === '_';
const isAlnum = (c) => isAlpha(c) || isDigit(c);
const isSpace = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\v' || c === '\f';
const isNewline = (c) => c === '\n' || c === '\r';

const ESCAPES = {
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  '"': '"',
  "'": "'",
};

function parseHexNumber(text) {
  const body = text.slice(2);
  const pIndex = body.search(/[pP]/);
  const mantissa = pIndex === -1 ? body : body.slice(0, pIndex);
  const exponent = pIndex === -1 ? undefined : body.slice(pIndex + 1);
  const dot = mantissa.indexOf('.');
  const intPart = dot === -1 ? mantissa : mantissa.slice(0, dot);
  const fracPart = dot === -1 ? '' : mantissa.slice(dot + 1);
  let value = intPart ? parseInt(intPart, 16) : 0;
  for (let i = 0; i < fracPart.length; i += 1) {
    value += parseInt(fracPart[i], 16) / 16 ** (i + 1);
  }
  if (exponent !== undefined && exponent !== '') value *= 2 ** Number(exponent);
  return value;
}

function utf8Encode(code) {
  if (code < 0x80) return String.fromCharCode(code);
  if (code < 0x800) {
    return String.fromCharCode(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
  }
  if (code < 0x10000) {
    return String.fromCharCode(
      0xe0 | (code >> 12),
      0x80 | ((code >> 6) & 0x3f),
      0x80 | (code & 0x3f),
    );
  }
  return String.fromCharCode(
    0xf0 | (code >> 18),
    0x80 | ((code >> 12) & 0x3f),
    0x80 | ((code >> 6) & 0x3f),
    0x80 | (code & 0x3f),
  );
}

module.exports = {
  isDigit,
  isHex,
  isLower,
  isUpper,
  isAlpha,
  isAlnum,
  isSpace,
  isNewline,
  ESCAPES,
  parseHexNumber,
  utf8Encode,
};

};

__modules["src/lua/format.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { KEYWORDS } = require("src/lua/tokens.js");

const BINARY = {
  or: [1, 'left'],
  and: [2, 'left'],
  '<': [3, 'left'], '>': [3, 'left'], '<=': [3, 'left'],
  '>=': [3, 'left'], '~=': [3, 'left'], '==': [3, 'left'],
  '|': [4, 'left'], '~': [5, 'left'], '&': [6, 'left'],
  '<<': [7, 'left'], '>>': [7, 'left'],
  '..': [8, 'right'],
  '+': [9, 'left'], '-': [9, 'left'],
  '*': [10, 'left'], '/': [10, 'left'], '//': [10, 'left'], '%': [10, 'left'],
  '^': [12, 'right'],
};

const UNARY_PREC = 11;
const ATOM_PREC = 100;

const PREFIXES = new Set([Kind.Name, Kind.Index, Kind.Call, Kind.MethodCall, Kind.Paren]);

const ID_START = /[A-Za-z_]/;
const ID_BODY = /[A-Za-z0-9_]/;

function isIdentifier(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (!ID_START.test(text[0])) return false;
  for (let i = 1; i < text.length; i += 1) {
    if (!ID_BODY.test(text[i])) return false;
  }
  return !KEYWORDS.has(text);
}

function formatNumber(value) {
  if (typeof value !== 'number') return String(value);
  if (Number.isNaN(value)) return '(0 / 0)';
  if (value === Infinity) return 'math.huge';
  if (value === -Infinity) return '-math.huge';
  if (Object.is(value, -0)) return '0';
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return String(value);
}

const ESCAPES = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\\': '\\\\', '"': '\\"' };

const UNPRINTABLE = new Set([0x00a0, 0x00ad, 0x2028, 0x2029, 0xfeff]);

function utf8Length(value, at) {
  const lead = value.charCodeAt(at);
  const second = value.charCodeAt(at + 1);
  const continues = (count) => {
    for (let i = 1; i <= count; i += 1) {
      const code = value.charCodeAt(at + i);
      if (!(code >= 0x80 && code <= 0xbf)) return false;
    }
    return true;
  };
  let length = 0;
  let point = 0;
  if (lead >= 0xc2 && lead <= 0xdf && continues(1)) {
    length = 2;
    point = ((lead & 0x1f) << 6) | (second & 0x3f);
  } else if (lead >= 0xe0 && lead <= 0xef && continues(2)) {
    length = 3;
    point = ((lead & 0x0f) << 12) | ((second & 0x3f) << 6)
      | (value.charCodeAt(at + 2) & 0x3f);
    if (point < 0x800 || (point >= 0xd800 && point <= 0xdfff)) return 0;
  } else if (lead >= 0xf0 && lead <= 0xf4 && continues(3)) {
    length = 4;
    point = ((lead & 0x07) << 18) | ((second & 0x3f) << 12)
      | ((value.charCodeAt(at + 2) & 0x3f) << 6) | (value.charCodeAt(at + 3) & 0x3f);
    if (point < 0x10000 || point > 0x10ffff) return 0;
  } else return 0;
  if (point <= 0x9f || UNPRINTABLE_POINTS.has(point)) return 0;
  return length;
}

function quoteString(value) {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    const short = ESCAPES[c];
    if (short !== undefined) {
      out += short;
      continue;
    }
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      out += c;
      continue;
    }
    if (code >= 0xc2 && code <= 0xf4) {
      const spelled = utf8Length(value, i);
      if (spelled) {
        out += value.slice(i, i + spelled);
        i += spelled - 1;
        continue;
      }
    }
    const next = value[i + 1];
    const needsPadding = next !== undefined && next >= '0' && next <= '9';
    out += `\\${needsPadding ? String(code).padStart(3, '0') : String(code)}`;
  }
  return `${out}"`;
}

function canUseLongBracket(value) {
  if (!value.includes('\n')) return false;
  if (value.includes(']]') || value.startsWith('\n') || value.endsWith(']')) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const printable = (code >= 0x20 && code <= 0x7e) || code === 0x0a || code === 0x09;
    if (!printable) return false;
  }
  return true;
}

function formatString(value) {
  if (canUseLongBracket(value)) return `[[\n${value}]]`;
  return quoteString(value);
}

module.exports = {
  BINARY,
  UNARY_PREC,
  ATOM_PREC,
  PREFIXES,
  isIdentifier,
  formatNumber,
  formatString,
};

};

__modules["src/lua/layout.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");

const PARAS = 4;
const RECORDS = 4;

function rootName(node) {
  let current = node;
  for (let guard = 0; guard < 1000 && current; guard += 1) {
    switch (current.kind) {
      case Kind.Name: return current.name;
      case Kind.Paren: current = current.expression; break;
      case Kind.Index: current = current.base; break;
      case Kind.Call:
      case Kind.MethodCall: current = current.base; break;
      default: return null;
    }
  }
  return null;
}

function subjectOf(statement) {
  if (!statement) return null;
  switch (statement.kind) {
    case Kind.LocalDeclaration: return (statement.names || [])[0] || null;
    case Kind.LocalFunction: return statement.name || null;
    case Kind.FunctionDeclaration: return rootName(statement.target);
    case Kind.Assignment: return rootName((statement.targets || [])[0]);
    case Kind.CallStatement: return rootName(statement.expression);
    default: return null;
  }
}

function groups(statements) {
  const index = [];
  const sizes = [];
  let current = -1;
  let subject = null;
  (statements || []).forEach((statement, at) => {
    const found = subjectOf(statement);
    if (at === 0 || found === null || subject === null || found !== subject) {
      current += 1;
      sizes.push(0);
    }
    index.push(current);
    sizes[current] += 1;
    subject = found;
  });
  return { index, sizes, count: index.length };
}

function separates(found, at, wide, above) {
  if (!at) return false;
  if (wide || above) return true;
  if (found.count < PARAS) return false;
  const here = found.index[at];
  const before = found.index[at - 1];
  if (here === before) return false;
  return found.sizes[here] >= 2 || found.sizes[before] >= 2;
}

function record(entries) {
  let keys = 0;
  for (const entry of entries) {
    if (entry.type === 'key') keys += 1;
  }
  return keys >= RECORDS;
}

module.exports = { rootName, groups, record, separates };

};

__modules["src/lua/lexer.js"] = function(module, exports, require) {
'use strict';

const { TokenKind, KEYWORDS, SYMBOLS } = require("src/lua/tokens.js");
const C = require("src/lua/chars.js");

class LuaSyntaxError extends Error {
  constructor(message, line, column) {
    super(`${message} (line ${line}, col ${column})`);
    this.name = 'LuaSyntaxError';
    this.line = line;
    this.column = column;
  }
}

class Lexer {
  constructor(source) {
    this.src = source;
    this.len = source.length;
    this.pos = 0;
    this.line = 1;
    this.lineStart = 0;
  }

  error(message) {
    throw new LuaSyntaxError(message, this.line, this.pos - this.lineStart + 1);
  }

  peek(offset = 0) {
    const i = this.pos + offset;
    return i < this.len ? this.src[i] : '';
  }

  newline() {
    const c = this.src[this.pos];
    this.pos += 1;
    const n = this.src[this.pos];
    if ((n === '\n' || n === '\r') && n !== c) this.pos += 1;
    this.line += 1;
    this.lineStart = this.pos;
  }

  skipTrivia() {
    for (;;) {
      const c = this.peek();
      if (c === '') return;
      if (C.isNewline(c)) {
        this.newline();
        continue;
      }
      if (C.isSpace(c)) {
        this.pos += 1;
        continue;
      }
      if (c === '-' && this.peek(1) === '-') {
        this.pos += 2;
        const level = this.longBracketLevel();
        if (level !== null) {
          this.readLongBracket(level);
          continue;
        }
        while (this.pos < this.len && !C.isNewline(this.src[this.pos])) this.pos += 1;
        continue;
      }
      return;
    }
  }

  longBracketLevel() {
    if (this.peek() !== '[') return null;
    let i = this.pos + 1;
    let level = 0;
    while (i < this.len && this.src[i] === '=') {
      level += 1;
      i += 1;
    }
    if (this.src[i] !== '[') return null;
    this.pos = i + 1;
    return level;
  }

  readLongBracket(level) {
    if (C.isNewline(this.peek())) this.newline();
    const closer = `]${'='.repeat(level)}]`;
    let out = '';
    for (;;) {
      if (this.pos >= this.len) this.error('unterminated long string/comment');
      if (this.src.startsWith(closer, this.pos)) {
        this.pos += closer.length;
        return out;
      }
      const c = this.src[this.pos];
      if (C.isNewline(c)) {
        this.newline();
        out += '\n';
        continue;
      }
      out += c;
      this.pos += 1;
    }
  }

  readShortString(quote) {
    this.pos += 1;
    let out = '';
    for (;;) {
      if (this.pos >= this.len) this.error('unterminated string');
      const c = this.src[this.pos];
      if (c === quote) {
        this.pos += 1;
        return out;
      }
      if (C.isNewline(c)) this.error('unterminated string');
      if (c !== '\\') {
        out += c;
        this.pos += 1;
        continue;
      }
      this.pos += 1;
      out += this.readEscape();
    }
  }

  readEscape() {
    const e = this.peek();
    if (e === '') this.error('unterminated escape sequence');
    if (C.isNewline(e)) {
      this.newline();
      return '\n';
    }
    if (Object.prototype.hasOwnProperty.call(C.ESCAPES, e)) {
      this.pos += 1;
      return C.ESCAPES[e];
    }
    if (e === 'x' || e === 'X') {
      this.pos += 1;
      let hex = '';
      while (hex.length < 2 && C.isHex(this.peek())) {
        hex += this.src[this.pos];
        this.pos += 1;
      }
      if (hex.length === 0) this.error('hex digit expected');
      return String.fromCharCode(parseInt(hex, 16));
    }
    if (e === 'z') {
      this.pos += 1;
      while (this.pos < this.len && C.isSpace(this.src[this.pos])) {
        if (C.isNewline(this.src[this.pos])) this.newline();
        else this.pos += 1;
      }
      return '';
    }
    if (e === 'u') {
      this.pos += 1;
      if (this.peek() !== '{') this.error("expected '{' after \\u");
      this.pos += 1;
      let hex = '';
      while (C.isHex(this.peek())) {
        hex += this.src[this.pos];
        this.pos += 1;
      }
      if (this.peek() !== '}') this.error("expected '}'");
      this.pos += 1;
      return C.utf8Encode(parseInt(hex, 16));
    }
    if (C.isDigit(e)) {
      let dec = '';
      while (dec.length < 3 && C.isDigit(this.peek())) {
        dec += this.src[this.pos];
        this.pos += 1;
      }
      const value = parseInt(dec, 10);
      if (value > 255) this.error('decimal escape out of range');
      return String.fromCharCode(value);
    }
    return this.error(`invalid escape '\\${e}'`);
  }

  readNumber() {
    const start = this.pos;
    if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
      this.pos += 2;
      while (C.isHex(this.peek()) || this.peek() === '.') this.pos += 1;
      if (this.peek() === 'p' || this.peek() === 'P') {
        this.pos += 1;
        if (this.peek() === '+' || this.peek() === '-') this.pos += 1;
        while (C.isDigit(this.peek())) this.pos += 1;
      }
      const text = this.src.slice(start, this.pos);
      return { text, value: C.parseHexNumber(text) };
    }
    if (this.peek() === '0' && (this.peek(1) === 'b' || this.peek(1) === 'B')) {
      this.pos += 2;
      while (this.peek() === '0' || this.peek() === '1') this.pos += 1;
      const text = this.src.slice(start, this.pos);
      return { text, value: parseInt(text.slice(2), 2) };
    }
    while (C.isDigit(this.peek())) this.pos += 1;
    if (this.peek() === '.') {
      this.pos += 1;
      while (C.isDigit(this.peek())) this.pos += 1;
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.pos += 1;
      if (this.peek() === '+' || this.peek() === '-') this.pos += 1;
      while (C.isDigit(this.peek())) this.pos += 1;
    }
    const text = this.src.slice(start, this.pos);
    const value = Number(text);
    if (Number.isNaN(value)) this.error(`malformed number '${text}'`);
    return { text, value };
  }

  next() {
    this.skipTrivia();
    const line = this.line;
    const column = this.pos - this.lineStart + 1;
    const offset = this.pos;
    if (this.pos >= this.len) {
      return { kind: TokenKind.Eof, value: null, line, column, offset };
    }
    const c = this.src[this.pos];

    if (C.isAlpha(c)) {
      let i = this.pos;
      while (i < this.len && C.isAlnum(this.src[i])) i += 1;
      const word = this.src.slice(this.pos, i);
      this.pos = i;
      const kind = KEYWORDS.has(word) ? TokenKind.Keyword : TokenKind.Name;
      return { kind, value: word, line, column, offset };
    }

    if (C.isDigit(c) || (c === '.' && C.isDigit(this.peek(1)))) {
      const num = this.readNumber();
      return { kind: TokenKind.Number, value: num.value, text: num.text, line, column, offset };
    }

    if (c === '"' || c === "'") {
      return { kind: TokenKind.String, value: this.readShortString(c), line, column, offset };
    }

    if (c === '[') {
      const level = this.longBracketLevel();
      if (level !== null) {
        const value = this.readLongBracket(level);
        return { kind: TokenKind.String, value, long: true, level, line, column, offset };
      }
    }

    for (let i = 0; i < SYMBOLS.length; i += 1) {
      const sym = SYMBOLS[i];
      if (this.src.startsWith(sym, this.pos)) {
        this.pos += sym.length;
        return { kind: TokenKind.Symbol, value: sym, line, column, offset };
      }
    }

    return this.error(`unexpected char '${c}'`);
  }

  tokenize() {
    const tokens = [];
    for (;;) {
      const token = this.next();
      tokens.push(token);
      if (token.kind === TokenKind.Eof) return tokens;
    }
  }
}

function tokenize(source) {
  return new Lexer(source).tokenize();
}

module.exports = { Lexer, tokenize, LuaSyntaxError, TokenKind };

};

__modules["src/lua/parser.js"] = function(module, exports, require) {
'use strict';

const { tokenize, LuaSyntaxError } = require("src/lua/lexer.js");
const { TokenKind } = require("src/lua/tokens.js");
const A = require("src/lua/ast.js");

const { Kind } = A;

const BIN_PRIO = {
  or: [1, 1],
  and: [2, 2],
  '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
  '|': [4, 4], '~': [5, 5], '&': [6, 6],
  '<<': [7, 7], '>>': [7, 7],
  '..': [9, 8],
  '+': [10, 10], '-': [10, 10],
  '*': [11, 11], '/': [11, 11], '//': [11, 11], '%': [11, 11],
  '^': [14, 13],
};

const UN_PRIO = 12;
const UNARY_OPS = new Set(['-', 'not', '#', '~']);

const COMPOUND_OPS = {
  '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%', '^=': '^', '..=': '..',
};

const TERMINATORS = new Set(['end', 'else', 'elseif', 'until']);

class Parser {
  constructor(source) {
    this.tokens = tokenize(source);
    this.index = 0;
  }

  get token() {
    return this.tokens[this.index];
  }

  peek(offset = 1) {
    const i = this.index + offset;
    return i < this.tokens.length ? this.tokens[i] : this.tokens[this.tokens.length - 1];
  }

  advance() {
    const token = this.tokens[this.index];
    if (this.index < this.tokens.length - 1) this.index += 1;
    return token;
  }

  error(message, token = this.token) {
    throw new LuaSyntaxError(message, token.line, token.column);
  }

  at(value) {
    const t = this.token;
    return (t.kind === TokenKind.Symbol || t.kind === TokenKind.Keyword) && t.value === value;
  }

  accept(value) {
    if (!this.at(value)) return false;
    this.advance();
    return true;
  }

  expect(value) {
    if (!this.at(value)) this.error(`expected '${value}', got '${describe(this.token)}'`);
    return this.advance();
  }

  expectName() {
    if (this.token.kind !== TokenKind.Name) {
      this.error(`expected identifier, got '${describe(this.token)}'`);
    }
    return this.advance().value;
  }

  parseChunk() {
    const body = this.parseBlock();
    if (this.token.kind !== TokenKind.Eof) {
      this.error(`expected EOF, got '${describe(this.token)}'`);
    }
    return A.chunk(body);
  }

  parseBlock() {
    const statements = [];
    while (this.token.kind !== TokenKind.Eof) {
      if (this.token.kind === TokenKind.Keyword && TERMINATORS.has(this.token.value)) break;
      if (this.accept(';')) continue;
      if (this.token.kind === TokenKind.Keyword && this.token.value === 'return') {
        statements.push(this.parseReturn());
        this.accept(';');
        break;
      }
      statements.push(this.parseStatement());
    }
    return A.block(statements);
  }

  parseReturn() {
    this.expect('return');
    const expressions = this.blockEnds() || this.at(';') ? [] : this.parseExpressionList();
    return A.returnStatement(expressions);
  }

  blockEnds() {
    const t = this.token;
    if (t.kind === TokenKind.Eof) return true;
    return t.kind === TokenKind.Keyword && BLOCK_TERMINATORS.has(t.value);
  }

  parseStatement() {
    const t = this.token;
    if (t.kind === TokenKind.Keyword) {
      switch (t.value) {
        case 'local': return this.parseLocal();
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'do': {
          this.advance();
          const body = this.parseBlock();
          this.expect('end');
          return A.doStatement(body);
        }
        case 'for': return this.parseFor();
        case 'repeat': return this.parseRepeat();
        case 'function': return this.parseFunctionDeclaration();
        case 'break': this.advance(); return A.breakStatement();
        case 'continue': this.advance(); return { kind: Kind.Continue };
        case 'goto': this.advance(); return { kind: Kind.Goto, label: this.expectName() };
        default: break;
      }
    }
    if (this.at('::')) {
      this.advance();
      const label = this.expectName();
      this.expect('::');
      return { kind: Kind.Label, name: label };
    }
    return this.parseExpressionStatement();
  }

  parseLocal() {
    this.expect('local');
    if (this.accept('function')) {
      const id = this.expectName();
      const body = this.parseFunctionBody();
      return { kind: Kind.LocalFunction, name: id, body };
    }
    const names = [this.parseAttributedName()];
    while (this.accept(',')) names.push(this.parseAttributedName());
    const expressions = this.accept('=') ? this.parseExpressionList() : [];
    return A.localDecl(names, expressions);
  }

  parseAttributedName() {
    const id = this.expectName();
    if (this.at('<')) {
      this.advance();
      this.expectName();
      this.expect('>');
    } else if (this.at(':')) {
      this.advance();
      this.skipTypeAnnotation();
    }
    return id;
  }

  skipTypeAnnotation() {
    let depth = 0;
    for (;;) {
      const t = this.token;
      if (t.kind === TokenKind.Eof) return;
      if (t.kind === TokenKind.Symbol) {
        if (t.value === '(' || t.value === '{' || t.value === '<') depth += 1;
        else if (t.value === ')' || t.value === '}' || t.value === '>') {
          if (depth === 0) return;
          depth -= 1;
        } else if (depth === 0 && (t.value === ',' || t.value === '=' || t.value === ';')) {
          return;
        }
      } else if (t.kind === TokenKind.Keyword && depth === 0 && t.value !== 'nil') {
        return;
      }
      this.advance();
    }
  }

  parseIf() {
    this.expect('if');
    const condition = this.parseExpression();
    this.expect('then');
    const body = this.parseBlock();
    const elseIfs = [];
    let elseBody = null;
    for (;;) {
      if (this.accept('elseif')) {
        const cond = this.parseExpression();
        this.expect('then');
        elseIfs.push({ condition: cond, body: this.parseBlock() });
        continue;
      }
      if (this.accept('else')) elseBody = this.parseBlock();
      break;
    }
    this.expect('end');
    return A.ifStatement(condition, body, elseIfs, elseBody);
  }

  parseWhile() {
    this.expect('while');
    const condition = this.parseExpression();
    this.expect('do');
    const body = this.parseBlock();
    this.expect('end');
    return A.whileStatement(condition, body);
  }

  parseRepeat() {
    this.expect('repeat');
    const body = this.parseBlock();
    this.expect('until');
    return A.repeatStatement(body, this.parseExpression());
  }

  parseFor() {
    this.expect('for');
    const first = this.parseAttributedName();
    if (this.accept('=')) {
      const start = this.parseExpression();
      this.expect(',');
      const limit = this.parseExpression();
      const step = this.accept(',') ? this.parseExpression() : null;
      this.expect('do');
      const body = this.parseBlock();
      this.expect('end');
      return A.numericFor(first, start, limit, step, body);
    }
    const variables = [first];
    while (this.accept(',')) variables.push(this.parseAttributedName());
    this.expect('in');
    const expressions = this.parseExpressionList();
    this.expect('do');
    const body = this.parseBlock();
    this.expect('end');
    return A.genericFor(variables, expressions, body);
  }

  parseFunctionDeclaration() {
    this.expect('function');
    let target = A.name(this.expectName());
    let isMethod = false;
    for (;;) {
      if (this.accept('.')) {
        target = A.index(target, A.string(this.expectName()));
        continue;
      }
      if (this.accept(':')) {
        target = A.index(target, A.string(this.expectName()));
        isMethod = true;
      }
      break;
    }
    const body = this.parseFunctionBody(isMethod);
    return { kind: Kind.FunctionDeclaration, target, isMethod, body };
  }

  parseFunctionBody(isMethod = false) {
    if (this.at('<')) this.skipGenericParams();
    this.expect('(');
    const params = isMethod ? ['self'] : [];
    let isVararg = false;
    if (!this.at(')')) {
      do {
        if (this.accept('...')) {
          isVararg = true;
          if (this.accept(':')) this.skipTypeAnnotation();
          break;
        }
        params.push(this.parseAttributedName());
      } while (this.accept(','));
    }
    this.expect(')');
    if (this.accept(':')) this.skipTypeAnnotation();
    const body = this.parseBlock();
    this.expect('end');
    return A.func(params, body, isVararg);
  }

  skipGenericParams() {
    this.expect('<');
    let depth = 1;
    while (depth > 0 && this.token.kind !== TokenKind.Eof) {
      if (this.at('<')) depth += 1;
      else if (this.at('>')) depth -= 1;
      this.advance();
    }
  }

  parseExpressionStatement() {
    const first = this.parseSuffixedExpression();
    if (this.at('=') || this.at(',')) {
      const targets = [first];
      while (this.accept(',')) targets.push(this.parseSuffixedExpression());
      this.expect('=');
      const expressions = this.parseExpressionList();
      for (const target of targets) {
        if (!A.ASSIGNABLE.has(target.kind)) this.error('invalid assignment target');
      }
      return A.assignment(targets, expressions);
    }
    const compound = this.token.kind === TokenKind.Symbol
      ? COMPOUND_OPS[this.token.value] : undefined;
    if (compound) {
      this.advance();
      const rhs = this.parseExpression();
      return A.assignment([first], [A.binary(compound, first, rhs)]);
    }
    if (first.kind !== Kind.Call && first.kind !== Kind.MethodCall) {
      this.error('unexpected expression statement');
    }
    return A.callStatement(first);
  }

  parseExpressionList() {
    const list = [this.parseExpression()];
    while (this.accept(',')) list.push(this.parseExpression());
    return list;
  }

  parseExpression(limit = 0) {
    let left;
    const t = this.token;
    const isUnary = (t.kind === TokenKind.Symbol && UNARY_OPS.has(t.value))
      || (t.kind === TokenKind.Keyword && t.value === 'not');
    if (isUnary) {
      const operator = this.advance().value;
      left = A.unary(operator, this.parseExpression(UN_PRIO));
    } else {
      left = this.parseSimpleExpression();
    }
    for (;;) {
      const op = this.token;
      const isBinary = (op.kind === TokenKind.Symbol || op.kind === TokenKind.Keyword)
        && Object.prototype.hasOwnProperty.call(BIN_PRIO, op.value);
      if (!isBinary) break;
      const [leftPriority, rightPriority] = BIN_PRIO[op.value];
      if (leftPriority <= limit) break;
      this.advance();
      left = A.binary(op.value, left, this.parseExpression(rightPriority));
    }
    return left;
  }

  parseSimpleExpression() {
    const t = this.token;
    switch (t.kind) {
      case TokenKind.Number: this.advance(); return A.number(t.value);
      case TokenKind.String: this.advance(); return A.string(t.value);
      case TokenKind.Keyword:
        if (t.value === 'nil') { this.advance(); return A.nil(); }
        if (t.value === 'true') { this.advance(); return A.boolean(true); }
        if (t.value === 'false') { this.advance(); return A.boolean(false); }
        if (t.value === 'function') { this.advance(); return this.parseFunctionBody(); }
        break;
      case TokenKind.Symbol:
        if (t.value === '...') { this.advance(); return A.vararg(); }
        if (t.value === '{') return this.parseTable();
        break;
      default: break;
    }
    return this.parseSuffixedExpression();
  }

  parsePrimaryExpression() {
    if (this.accept('(')) {
      const inner = this.parseExpression();
      this.expect(')');
      return A.paren(inner);
    }
    if (this.token.kind === TokenKind.Name) return A.name(this.advance().value);
    return this.error(`unexpected token '${describe(this.token)}'`);
  }

  parseSuffixedExpression() {
    let node = this.parsePrimaryExpression();
    for (;;) {
      if (this.accept('.')) {
        node = A.index(node, A.string(this.expectName()), true);
        continue;
      }
      if (this.accept('[')) {
        const key = this.parseExpression();
        this.expect(']');
        node = A.index(node, key);
        continue;
      }
      if (this.at(':') && this.peek().kind === TokenKind.Name) {
        this.advance();
        const method = this.expectName();
        node = A.methodCall(node, method, this.parseCallArguments());
        continue;
      }
      if (this.at('(') || this.at('{') || this.token.kind === TokenKind.String) {
        node = A.call(node, this.parseCallArguments());
        continue;
      }
      return node;
    }
  }

  parseCallArguments() {
    if (this.token.kind === TokenKind.String) return [A.string(this.advance().value)];
    if (this.at('{')) return [this.parseTable()];
    this.expect('(');
    if (this.accept(')')) return [];
    const args = this.parseExpressionList();
    this.expect(')');
    return args;
  }

  parseTable() {
    this.expect('{');
    const entries = [];
    while (!this.at('}')) {
      if (this.accept('[')) {
        const key = this.parseExpression();
        this.expect(']');
        this.expect('=');
        entries.push({ type: 'key', key, value: this.parseExpression() });
      } else if (this.token.kind === TokenKind.Name && this.peek().kind === TokenKind.Symbol
        && this.peek().value === '=') {
        const key = A.string(this.advance().value);
        this.advance();
        entries.push({ type: 'key', key, value: this.parseExpression() });
      } else {
        entries.push({ type: 'item', value: this.parseExpression() });
      }
      if (!this.accept(',') && !this.accept(';')) break;
    }
    this.expect('}');
    return A.table(entries);
  }
}

function describe(token) {
  if (token.kind === TokenKind.Eof) return '<eof>';
  if (token.kind === TokenKind.String) return `"${token.value}"`;
  return String(token.value);
}

function parse(source) {
  return new Parser(source).parseChunk();
}

module.exports = { parse, LuaSyntaxError };

};

__modules["src/lua/scope.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");

let bindingId = 0;

class Binding {
  constructor(name, kind, options = {}) {
    bindingId += 1;
    this.id = bindingId;
    this.name = name;
    this.kind = kind;
    this.declaration = options.declaration || null;
    this.functionDepth = options.functionDepth || 0;
    this.reads = [];
    this.writes = [];
    this.initializer = options.initializer || null;
    this.captured = false;
  }

  get writeCount() {
    return this.writes.length + (this.initializer ? 1 : 0);
  }

  get isSingleAssignment() {
    return this.writes.length === 0;
  }
}

class Scope {
  constructor(parent, functionDepth) {
    this.parent = parent;
    this.functionDepth = functionDepth;
    this.bindings = new Map();
  }

  declare(name, kind, options) {
    const binding = new Binding(name, kind, { ...options, functionDepth: this.functionDepth });
    this.bindings.set(name, binding);
    return binding;
  }

  lookup(name) {
    let scope = this;
    while (scope) {
      const binding = scope.bindings.get(name);
      if (binding) return binding;
      scope = scope.parent;
    }
    return null;
  }
}

class Resolver {
  constructor() {
    this.globals = new Map();
    this.allBindings = [];
    this.functionDepth = 0;
  }

  global(name) {
    let binding = this.globals.get(name);
    if (!binding) {
      binding = new Binding(name, 'global', {});
      this.globals.set(name, binding);
      this.allBindings.push(binding);
    }
    return binding;
  }

  declare(scope, name, kind, options) {
    const binding = scope.declare(name, kind, options);
    this.allBindings.push(binding);
    return binding;
  }

  reference(scope, node, mode) {
    const binding = scope.lookup(node.name) || this.global(node.name);
    node.binding = binding;
    if (binding.functionDepth !== undefined && binding.kind !== 'global'
      && binding.functionDepth < this.functionDepth) {
      binding.captured = true;
    }
    if (mode === 'write') binding.writes.push(node);
    else binding.reads.push(node);
    return binding;
  }

  block(node, parentScope) {
    const scope = new Scope(parentScope, this.functionDepth);
    node.scope = scope;
    for (const statement of node.statements) this.statement(statement, scope);
    return scope;
  }

  statement(node, scope) {
    switch (node.kind) {
      case Kind.LocalDeclaration: {
        for (const expression of node.expressions) this.expression(expression, scope);
        node.bindings = node.names.map((name) => this.declare(scope, name, 'local', {
          declaration: node,
          initializer: node,
        }));
        return;
      }
      case Kind.LocalFunction: {
        const binding = this.declare(scope, node.name, 'local', {
          declaration: node,
          initializer: node,
        });
        node.binding = binding;
        this.functionExpression(node.body, scope);
        return;
      }
      case Kind.FunctionDeclaration:
        this.expression(node.target, scope, 'write');
        this.functionExpression(node.body, scope);
        return;
      case Kind.Assignment:
        for (const expression of node.expressions) this.expression(expression, scope);
        for (const target of node.targets) this.expression(target, scope, 'write');
        return;
      case Kind.CallStatement:
        this.expression(node.expression, scope);
        return;
      case Kind.Return:
        for (const expression of node.expressions) this.expression(expression, scope);
        return;
      case Kind.Break:
      case Kind.Continue:
      case Kind.Goto:
      case Kind.Label:
        return;
      case Kind.Do:
        this.block(node.body, scope);
        return;
      case Kind.While:
        this.expression(node.condition, scope);
        this.block(node.body, scope);
        return;
      case Kind.Repeat: {
        const inner = new Scope(scope, this.functionDepth);
        node.body.scope = inner;
        for (const statement of node.body.statements) this.statement(statement, inner);
        this.expression(node.condition, inner);
        return;
      }
      case Kind.If: {
        this.expression(node.condition, scope);
        this.block(node.body, scope);
        for (const clause of node.elseIfs || []) {
          this.expression(clause.condition, scope);
          this.block(clause.body, scope);
        }
        if (node.elseBody) this.block(node.elseBody, scope);
        return;
      }
      case Kind.NumericFor: {
        this.expression(node.start, scope);
        this.expression(node.limit, scope);
        if (node.step) this.expression(node.step, scope);
        const inner = new Scope(scope, this.functionDepth);
        node.binding = this.declare(inner, node.variable, 'local', { declaration: node });
        node.body.scope = inner;
        for (const statement of node.body.statements) this.statement(statement, inner);
        return;
      }
      case Kind.GenericFor: {
        for (const expression of node.expressions) this.expression(expression, scope);
        const inner = new Scope(scope, this.functionDepth);
        node.bindings = node.variables.map(
          (name) => this.declare(inner, name, 'local', { declaration: node }),
        );
        node.body.scope = inner;
        for (const statement of node.body.statements) this.statement(statement, inner);
        return;
      }
      default:
        throw new Error(`unsupported statement: ${node.kind}`);
    }
  }

  functionExpression(node, scope) {
    this.functionDepth += 1;
    const inner = new Scope(scope, this.functionDepth);
    node.bindings = (node.params || []).map(
      (name) => this.declare(inner, name, 'param', { declaration: node }),
    );
    node.body.scope = inner;
    for (const statement of node.body.statements) this.statement(statement, inner);
    this.functionDepth -= 1;
  }

  expression(node, scope, mode = 'read') {
    if (!node) return;
    switch (node.kind) {
      case Kind.Name:
        this.reference(scope, node, mode);
        return;
      case Kind.Index:
        this.expression(node.base, scope);
        this.expression(node.index, scope);
        return;
      case Kind.Call:
        this.expression(node.base, scope);
        for (const arg of node.args) this.expression(arg, scope);
        return;
      case Kind.MethodCall:
        this.expression(node.base, scope);
        for (const arg of node.args) this.expression(arg, scope);
        return;
      case Kind.Function:
        this.functionExpression(node, scope);
        return;
      case Kind.Table:
        for (const entry of node.entries) {
          if (entry.key) this.expression(entry.key, scope);
          this.expression(entry.value, scope);
        }
        return;
      case Kind.Binary:
        this.expression(node.lhs, scope);
        this.expression(node.rhs, scope);
        return;
      case Kind.Unary:
        this.expression(node.argument, scope);
        return;
      case Kind.Paren:
        this.expression(node.expression, scope);
        return;
      default:
        return;
    }
  }
}

function resolve(chunk) {
  const resolver = new Resolver();
  const root = new Scope(null, 0);
  resolver.rootScope = root;
  const body = chunk.kind === Kind.Chunk ? chunk.body : chunk;
  resolver.block(body, root);
  return resolver;
}

function isGlobalName(node) {
  if (!node || node.kind !== Kind.Name) return false;
  return !node.binding || node.binding.kind === 'global';
}

function isLocalBinding(binding) {
  return !!binding && binding.kind !== 'global';
}

module.exports = { resolve, Scope, isGlobalName, isLocalBinding };

};

__modules["src/lua/tokens.js"] = function(module, exports, require) {
'use strict';

const TokenKind = {
  Eof: 'Eof',
  Name: 'Name',
  Keyword: 'Keyword',
  Number: 'Number',
  String: 'String',
  Symbol: 'Symbol',
};

const KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
  'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return',
  'then', 'true', 'until', 'while', 'continue',
]);

const SYMBOLS = [
  '...', '..=',
  '==', '~=', '<=', '>=', '..', '::', '->', '//', '<<', '>>',
  '+=', '-=', '*=', '/=', '%=', '^=',
  '+', '-', '*', '/', '%', '^', '#', '=', '<', '>',
  '(', ')', '{', '}', '[', ']', ';', ':', ',', '.', '?', '|', '&', '~',
];

module.exports = { TokenKind, KEYWORDS, SYMBOLS };

};

__modules["src/lua/unparse.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const F = require("src/lua/format.js");
const layout = require("src/lua/layout.js");

const DEFAULTS = { indent: '  ', maxInlineWidth: 96 };

const OPENERS = new Set(['do', 'then', 'else', 'repeat']);

const FLAT = new Set(['and', 'or']);

function tailToken(text) {
  const trimmed = text.trimEnd();
  if (!trimmed) return '';
  const isWord = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
    || (ch >= '0' && ch <= '9') || ch === '_';
  const end = trimmed.length;
  if (!isWord(trimmed[end - 1])) return trimmed[end - 1];
  let start = end;
  while (start > 0 && isWord(trimmed[start - 1])) start -= 1;
  return trimmed.slice(start, end);
}

class Printer {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.lines = [];
    this.depth = 0;
    this.tail = '';
    this.column = 0;
    this.tight = false;
  }

  push(text) {
    this.lines.push(text === '' ? '' : this.options.indent.repeat(this.depth) + text);
    if (text !== '') this.tail = tailToken(text);
  }

  continues() {
    if (!this.lines.length) return false;
    return !(OPENERS.has(this.tail) || this.tail === ';' || this.tail === ':');
  }

  blank() {
    if (this.lines.length && this.lines[this.lines.length - 1] !== '') this.lines.push('');
  }

  indented(fn) {
    this.depth += 1;
    fn();
    this.depth -= 1;
  }

  from(column, fn) {
    const saved = this.column;
    this.column = column;
    const text = fn();
    this.column = saved;
    return text;
  }

  after(head, fn) {
    return head + this.from(this.startOf(head), fn);
  }

  packed(fn) {
    const saved = this.tight;
    this.tight = true;
    const text = fn();
    this.tight = saved;
    return text;
  }

  startOf(head) {
    return this.column + head.length;
  }

  wrap(head, list) {
    const flat = head + list.join(', ');
    if (this.fits(flat)) return flat;
    const indent = this.options.indent.repeat(this.depth + 1);
    const rows = [];
    let row = head.trimEnd();
    let start = this.column;
    for (let at = 0; at < list.length; at += 1) {
      const piece = at === list.length - 1 ? list[at] : `${list[at]},`;
      const joined = row ? `${row} ${piece}` : piece;
      if (start + joined.length <= this.options.maxInlineWidth) {
        row = joined;
      } else {
        rows.push(row);
        row = piece;
        start = indent.length;
      }
    }
    rows.push(row);
    return rows.join(`\n${indent}`);
  }

  fits(flat) {
    return !flat.includes('\n') && this.column + flat.length <= this.options.maxInlineWidth;
  }

  inner() {
    const sub = new Printer(this.options);
    sub.tight = this.tight;
    sub.depth = this.depth + 1;
    sub.column = this.options.indent.length * sub.depth;
    return sub;
  }

  toString() {
    return `${this.lines.join('\n').replace(/\s+$/, '')}\n`;
  }

  block(node) {
    if (!node || !node.statements) return;
    const statements = node.statements;
    const found = layout.groups(statements);
    let above = false;
    for (let at = 0; at < statements.length; at += 1) {
      const start = this.lines.length;
      this.statement(statements[at]);
      const written = this.lines.length - start;
      const wide = written > 1 || (written === 1 && this.lines[start].indexOf('\n') >= 0);
      if (layout.separates(found, at, wide, above)) this.lines.splice(start, 0, '');
      above = wide;
    }
  }

  statement(node) {
    this.column = this.options.indent.length * this.depth;
    switch (node.kind) {
      case Kind.LocalDeclaration: {
        const names = node.names.join(', ');
        if (!node.expressions || node.expressions.length === 0) {
          this.push(this.wrap('local ', node.names));
        } else {
          this.push(this.after(`local ${names} = `,
            () => this.expressionList(node.expressions)));
        }
        return;
      }
      case Kind.LocalFunction:
        this.functionBody(`local function ${node.name}`, node.body);
        return;
      case Kind.FunctionDeclaration: {
        const target = this.targetPath(node.target, node.isMethod);
        this.functionBody(`function ${target}`, node.body, node.isMethod);
        return;
      }
      case Kind.Assignment: {
        const text = this.after(`${this.expressionList(node.targets)} = `,
          () => this.expressionList(node.expressions));
        this.push(text.startsWith('(') && this.continues() ? `;${text}` : text);
        return;
      }
      case Kind.CallStatement: {
        const text = this.expression(node.expression);
        this.push(text.startsWith('(') && this.continues() ? `;${text}` : text);
        return;
      }
      case Kind.Return:
        if (!node.expressions || node.expressions.length === 0) this.push('return');
        else this.push(this.after('return ', () => this.expressionList(node.expressions)));
        return;
      case Kind.Break:
        this.push('break');
        return;
      case Kind.Continue:
        this.push('continue');
        return;
      case Kind.Goto:
        this.push(`goto ${node.label}`);
        return;
      case Kind.Label:
        this.push(`::${node.name}::`);
        return;
      case Kind.Do:
        this.push('do');
        this.indented(() => this.block(node.body));
        this.push('end');
        return;
      case Kind.While:
        this.push(`${this.after('while ', () => this.expression(node.condition))} do`);
        this.indented(() => this.block(node.body));
        this.push('end');
        return;
      case Kind.Repeat:
        this.push('repeat');
        this.indented(() => this.block(node.body));
        this.push(this.after('until ', () => this.expression(node.condition)));
        return;
      case Kind.If:
        this.ifStatement(node);
        return;
      case Kind.NumericFor: {
        const bounds = [node.start, node.limit];
        if (node.step) bounds.push(node.step);
        this.push(`${this.after(`for ${node.variable} = `,
          () => this.expressionList(bounds))} do`);
        this.indented(() => this.block(node.body));
        this.push('end');
        return;
      }
      case Kind.GenericFor:
        this.push(`${this.after(`for ${node.variables.join(', ')} in `,
          () => this.expressionList(node.expressions))} do`);
        this.indented(() => this.block(node.body));
        this.push('end');
        return;
      default:
        this.push(`--[[ unsupported statement ${node.kind} ]]`);
    }
  }

  ifStatement(node) {
    this.push(`${this.after('if ', () => this.expression(node.condition))} then`);
    this.indented(() => this.block(node.body));
    for (const clause of node.elseIfs || []) {
      this.push(`${this.after('elseif ', () => this.expression(clause.condition))} then`);
      this.indented(() => this.block(clause.body));
    }
    if (node.elseBody) {
      this.push('else');
      this.indented(() => this.block(node.elseBody));
    }
    this.push('end');
  }

  targetPath(node, isMethod) {
    if (node.kind !== Kind.Index) return this.expression(node);
    const key = node.index;
    if (isMethod && key.kind === Kind.String && F.isIdentifier(key.value)) {
      return `${this.expression(node.base)}:${key.value}`;
    }
    return this.expression(node);
  }

  functionBody(header, fn, isMethod = false) {
    const params = (fn.params || []).slice();
    if (isMethod && params[0] === 'self') params.shift();
    if (fn.isVararg) params.push('...');
    this.push(`${header}(${params.join(', ')})`);
    this.indented(() => this.block(fn.body));
    this.push('end');
  }

  expressionList(nodes) {
    return nodes.map((node) => this.expression(node)).join(', ');
  }

  static printsParens(node) {
    const inner = node.expression;
    return !!inner && (inner.kind === Kind.Call || inner.kind === Kind.MethodCall
      || inner.kind === Kind.Vararg);
  }

  static precedenceOf(node) {
    if (node.kind === Kind.Paren) {
      if (Printer.printsParens(node)) return F.ATOM_PREC;
      return Printer.precedenceOf(node.expression || node);
    }
    if (node.kind === Kind.Binary) {
      const info = F.BINARY[node.operator];
      return info ? info[0] : 0;
    }
    if (node.kind === Kind.Unary) return F.UNARY_PREC;
    return F.ATOM_PREC;
  }

  expression(node) {
    if (!node) return 'nil';
    switch (node.kind) {
      case Kind.Nil: return 'nil';
      case Kind.True: return 'true';
      case Kind.False: return 'false';
      case Kind.Vararg: return '...';
      case Kind.Number: return F.formatNumber(node.value);
      case Kind.String: return F.formatString(node.value);
      case Kind.Name: return node.name;
      case Kind.Function: return this.functionExpression(node);
      case Kind.Table: return this.tableExpression(node);
      case Kind.Binary: return this.binaryExpression(node);
      case Kind.Unary: return this.unaryExpression(node);
      case Kind.Index: return this.indexExpression(node);
      case Kind.Call: {
        const base = this.prefix(node.base);
        return base + this.from(this.column + base.length, () => this.arguments(node.args));
      }
      case Kind.MethodCall: {
        const head = `${this.prefix(node.base)}:${node.method}`;
        return head + this.from(this.column + head.length, () => this.arguments(node.args));
      }
      case Kind.Paren:
        if (Printer.printsParens(node)) return `(${this.expression(node.expression)})`;
        return this.expression(node.expression);
      default: return `--[[ ${node.kind} ]]nil`;
    }
  }

  operand(node, minPrecedence, side, assoc) {
    const text = this.expression(node);
    const precedence = Printer.precedenceOf(node);
    let inner = node;
    while (inner.kind === Kind.Paren && !Printer.printsParens(inner)) {
      inner = inner.expression;
    }
    let needs = precedence < minPrecedence;
    if (precedence === minPrecedence && inner.kind === Kind.Binary && !FLAT.has(inner.operator)) {
      if (side === 'left' && assoc === 'right') needs = true;
      if (side === 'right' && assoc === 'left') needs = true;
    }

    return needs ? `(${text})` : text;
  }

  binaryExpression(node) {
    const info = F.BINARY[node.operator] || [0, 'left'];
    const [precedence, assoc] = info;
    const parts = [];
    this.chain(node, node.operator, assoc, parts);
    const flat = this.packed(() => this.operands(this, parts, precedence, assoc)
      .join(` ${node.operator} `));
    if (this.tight || flat.includes('\n') || this.fits(flat)) return flat;
    return this.spread(parts, node.operator, precedence, assoc);
  }

  chain(node, operator, assoc, parts) {
    let inner = node;
    while (inner.kind === Kind.Paren && !Printer.printsParens(inner)) inner = inner.expression;
    if (inner.kind !== Kind.Binary || inner.operator !== operator) {
      parts.push(node);
      return;
    }
    const both = FLAT.has(operator);
    if (both || assoc === 'left') this.chain(inner.lhs, operator, assoc, parts);
    else parts.push(inner.lhs);
    if (both || assoc === 'right') this.chain(inner.rhs, operator, assoc, parts);
    else parts.push(inner.rhs);
  }

  operands(printer, parts, precedence, assoc, columnAt) {
    const last = parts.length - 1;
    const leftmost = assoc === 'right' ? (at) => at !== last : (at) => at === 0;
    return parts.map((part, at) => {
      const side = leftmost(at) ? 'left' : 'right';
      const print = () => printer.operand(part, precedence, side, assoc);
      return columnAt ? printer.from(columnAt(at), print) : print();
    });
  }

  spread(parts, operator, precedence, assoc) {
    const sub = this.inner();
    const indent = this.options.indent.repeat(sub.depth);
    const head = `${operator} `;
    const texts = this.operands(sub, parts, precedence, assoc,
      (at) => (at === 0 ? this.column : indent.length + head.length))
      .map((text, at) => (at === 0 ? text : `${head}${text}`));
    const wide = texts.some((text) => text.includes('\n'));
    const rows = [];
    let row = texts[0];
    let start = this.column;
    for (let at = 1; at < texts.length; at += 1) {
      const joined = `${row} ${texts[at]}`;
      if (!wide && start + joined.length <= this.options.maxInlineWidth) {
        row = joined;
      } else {
        rows.push(row);
        row = texts[at];
        start = indent.length;
      }
    }
    rows.push(row);
    return rows.join(`\n${indent}`);
  }

  unaryExpression(node) {
    const text = this.operand(node.argument, F.UNARY_PREC, 'right', 'right');
    if (node.operator === 'not') return `not ${text}`;
    const separator = node.operator === '-' && text.startsWith('-') ? ' ' : '';
    return `${node.operator}${separator}${text}`;
  }

  prefix(node) {
    if (node.kind === Kind.Paren) {
      const inner = node.expression;
      if (inner && (inner.kind === Kind.Name || inner.kind === Kind.Index)) {
        return this.prefix(inner);
      }
      return `(${this.expression(inner)})`;
    }
    const text = this.expression(node);
    if (F.PREFIXES.has(node.kind)) return text;
    return `(${text})`;
  }

  indexExpression(node) {
    const key = node.index;
    if (key && key.kind === Kind.String && F.isIdentifier(key.value)) {
      return `${this.prefix(node.base)}.${key.value}`;
    }
    return `${this.prefix(node.base)}[${this.expression(key)}]`;
  }

  arguments(args) {
    const list = args || [];
    if (!list.length) return '()';
    const flat = `(${this.expressionList(list)})`;
    if (list.length < 2 || flat.includes('\n') || this.fits(flat)) return flat;
    const hugged = this.hug(list);
    if (hugged) return hugged;
    const sub = this.inner();
    const indent = this.options.indent.repeat(sub.depth);
    const items = list.map((node) => ({ text: sub.expression(node), alone: false }));
    const closing = this.options.indent.repeat(this.depth);
    return `(\n${this.filled(items, indent, '').join('\n')}\n${closing})`;
  }

  hug(list) {
    const last = list[list.length - 1];
    if (last.kind !== Kind.Table && last.kind !== Kind.Function) return null;
    const head = `(${this.expressionList(list.slice(0, -1))}, `;
    const start = this.column + head.length;
    if (head.includes('\n') || start > this.options.maxInlineWidth) return null;
    return `${head}${this.from(start, () => this.expression(last))})`;
  }

  functionExpression(fn) {
    const params = (fn.params || []).slice();
    if (fn.isVararg) params.push('...');
    const head = `function(${params.join(', ')})`;
    const sub = this.inner();
    sub.block(fn.body);
    if (sub.lines.length < 2) {
      const only = sub.lines.length ? sub.lines[0].trim() : '';
      const flat = only ? `${head} ${only} end` : `${head} end`;
      if (this.fits(flat)) return flat;
    }
    const closing = this.options.indent.repeat(this.depth);
    const body = sub.lines.length ? `\n${sub.lines.join('\n')}` : '';
    return `${head}${body}\n${closing}end`;
  }

  filled(items, indent, tail = ',') {
    const rows = [];
    let row = '';
    const commit = () => {
      if (row) rows.push(row);
      row = '';
    };
    items.forEach((item, at) => {
      const comma = at === items.length - 1 ? tail : ',';
      const own = `${indent}${item.text}${comma}`;
      const joined = row ? `${row} ${item.text}${comma}` : own;
      if (item.alone) {
        commit();
        rows.push(own);
      } else if (row && joined.length > this.options.maxInlineWidth) {
        commit();
        row = own;
      } else {
        row = joined;
      }
    });
    commit();
    return rows;
  }

  tableExpression(node) {
    const entries = node.entries || [];
    if (entries.length === 0) return '{}';
    const inline = entries.map((entry) => this.tableEntry(entry, false));
    const flat = `{ ${inline.join(', ')} }`;
    if (!layout.record(entries) && this.fits(flat)) return flat;
    const sub = this.inner();
    const items = entries.map((entry) => {
      const text = sub.tableEntry(entry, true);
      return { text, alone: entry.type === 'key' || text.includes('\n') };
    });
    const indent = this.options.indent.repeat(sub.depth);
    const closing = this.options.indent.repeat(this.depth);
    return `{\n${this.filled(items, indent).join('\n')}\n${closing}}`;
  }

  tableEntry(entry) {
    if (entry.type === 'key') {
      const key = entry.key;
      const head = key.kind === Kind.String && F.isIdentifier(key.value)
        ? `${key.value} = `
        : `[${this.expression(key)}] = `;
      return this.after(head, () => this.expression(entry.value));
    }
    return this.expression(entry.value);
  }
}

function unparse(node, options) {
  const printer = new Printer(options);
  if (!node) return '';
  if (node.kind === Kind.Chunk) printer.block(node.body);
  else if (node.kind === Kind.Block) printer.block(node);
  else if (node.kind && require("src/lua/ast.js").isExpression(node)) return printer.expression(node);
  else printer.statement(node);
  return printer.toString();
}

module.exports = { unparse };

};

__modules["src/lua/walk.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");

const CHILDREN = {
  [Kind.Chunk]: { body: 'node' },
  [Kind.Block]: { statements: 'list' },

  [Kind.LocalDeclaration]: { expressions: 'list' },
  [Kind.LocalFunction]: { body: 'node' },
  [Kind.FunctionDeclaration]: { target: 'node', body: 'node' },
  [Kind.Assignment]: { targets: 'list', expressions: 'list' },
  [Kind.CallStatement]: { expression: 'node' },
  [Kind.Return]: { expressions: 'list' },
  [Kind.Break]: {},
  [Kind.Continue]: {},
  [Kind.Goto]: {},
  [Kind.Label]: {},
  [Kind.Do]: { body: 'node' },
  [Kind.While]: { condition: 'node', body: 'node' },
  [Kind.Repeat]: { body: 'node', condition: 'node' },
  [Kind.If]: { condition: 'node', body: 'node', elseIfs: 'clauses', elseBody: 'node' },
  [Kind.NumericFor]: { start: 'node', limit: 'node', step: 'node', body: 'node' },
  [Kind.GenericFor]: { expressions: 'list', body: 'node' },

  [Kind.Nil]: {},
  [Kind.True]: {},
  [Kind.False]: {},
  [Kind.Number]: {},
  [Kind.String]: {},
  [Kind.Vararg]: {},
  [Kind.Name]: {},
  [Kind.Function]: { body: 'node' },
  [Kind.Table]: { entries: 'entries' },
  [Kind.Binary]: { lhs: 'node', rhs: 'node' },
  [Kind.Unary]: { argument: 'node' },
  [Kind.Index]: { base: 'node', index: 'node' },
  [Kind.Call]: { base: 'node', args: 'list' },
  [Kind.MethodCall]: { base: 'node', args: 'list' },
  [Kind.Paren]: { expression: 'node' },
};

const SPEC = {};
for (const kind of Object.keys(CHILDREN)) SPEC[kind] = Object.entries(CHILDREN[kind]);

const NONE = [];

function children(node) {
  const spec = node ? SPEC[node.kind] : null;
  if (!spec || spec.length === 0) return NONE;
  const out = [];
  for (let s = 0; s < spec.length; s += 1) {
    const key = spec[s][0];
    const value = node[key];
    if (value === undefined || value === null) continue;
    const type = spec[s][1];
    if (type === 'node') {
      out.push({ parent: node, key, index: null, node: value });
    } else if (type === 'list') {
      for (let i = 0; i < value.length; i += 1) {
        out.push({ parent: node, key, index: i, node: value[i] });
      }
    } else if (type === 'clauses') {
      for (let i = 0; i < value.length; i += 1) {
        const clause = value[i];
        out.push({ parent: clause, key: 'condition', index: null, node: clause.condition });
        out.push({ parent: clause, key: 'body', index: null, node: clause.body });
      }
    } else {
      for (let i = 0; i < value.length; i += 1) {
        const entry = value[i];
        if (entry.key) out.push({ parent: entry, key: 'key', index: null, node: entry.key });
        out.push({ parent: entry, key: 'value', index: null, node: entry.value });
      }
    }
  }
  return out;
}

function nodesOf(node) {
  const spec = node ? SPEC[node.kind] : null;
  if (!spec || spec.length === 0) return NONE;
  const out = [];
  for (let s = 0; s < spec.length; s += 1) {
    const value = node[spec[s][0]];
    if (value === undefined || value === null) continue;
    const type = spec[s][1];
    if (type === 'node') {
      out.push(value);
    } else if (type === 'list') {
      for (let i = 0; i < value.length; i += 1) out.push(value[i]);
    } else if (type === 'clauses') {
      for (let i = 0; i < value.length; i += 1) {
        out.push(value[i].condition);
        out.push(value[i].body);
      }
    } else {
      for (let i = 0; i < value.length; i += 1) {
        if (value[i].key) out.push(value[i].key);
        out.push(value[i].value);
      }
    }
  }
  return out;
}

function wants(visit) {
  return (visit.enter && visit.enter.length > 1) || (visit.leave && visit.leave.length > 1);
}

function deep(node, visit) {
  if (!node || !node.kind) return;
  if (visit.enter && visit.enter(node) === false) return;
  const kids = nodesOf(node);
  for (let i = 0; i < kids.length; i += 1) deep(kids[i], visit);
  visit.leave(node);
}

function bare(node, visit) {
  if (visit.leave) {
    deep(node, visit);
    return;
  }
  const enter = visit.enter;
  if (!enter) return;
  const stack = [node];
  let top = 1;
  while (top > 0) {
    top -= 1;
    const one = stack[top];
    if (!one || !one.kind) continue;
    if (enter(one) === false) continue;
    const spec = SPEC[one.kind];
    if (!spec) continue;
    for (let s = spec.length - 1; s >= 0; s -= 1) {
      const value = one[spec[s][0]];
      if (value === undefined || value === null) continue;
      const type = spec[s][1];
      if (type === 'node') {
        stack[top] = value;
        top += 1;
      } else if (type === 'list') {
        for (let i = value.length - 1; i >= 0; i -= 1) {
          stack[top] = value[i];
          top += 1;
        }
      } else if (type === 'clauses') {
        for (let i = value.length - 1; i >= 0; i -= 1) {
          stack[top] = value[i].body;
          top += 1;
          stack[top] = value[i].condition;
          top += 1;
        }
      } else {
        for (let i = value.length - 1; i >= 0; i -= 1) {
          stack[top] = value[i].value;
          top += 1;
          if (value[i].key) {
            stack[top] = value[i].key;
            top += 1;
          }
        }
      }
    }
  }
}

function framed(root, fn) {
  const stack = [root];
  const frames = [null];
  let top = 1;
  while (top > 0) {
    top -= 1;
    const node = stack[top];
    const frame = frames[top];
    if (!node || !node.kind) continue;
    fn(node, frame);
    if (node.kind === Kind.Block) {
      const statements = node.statements;
      const depth = frame ? frame.depth + 1 : 1;
      for (let i = statements.length - 1; i >= 0; i -= 1) {
        stack[top] = statements[i];
        frames[top] = { block: node, at: i, up: frame, depth };
        top += 1;
      }
      continue;
    }
    const spec = SPEC[node.kind];
    if (!spec) continue;
    for (let s = spec.length - 1; s >= 0; s -= 1) {
      const value = node[spec[s][0]];
      if (value === undefined || value === null) continue;
      const type = spec[s][1];
      if (type === 'node') {
        stack[top] = value;
        frames[top] = frame;
        top += 1;
      } else if (type === 'list') {
        for (let i = value.length - 1; i >= 0; i -= 1) {
          stack[top] = value[i];
          frames[top] = frame;
          top += 1;
        }
      } else if (type === 'clauses') {
        for (let i = value.length - 1; i >= 0; i -= 1) {
          stack[top] = value[i].body;
          frames[top] = frame;
          top += 1;
          stack[top] = value[i].condition;
          frames[top] = frame;
          top += 1;
        }
      } else {
        for (let i = value.length - 1; i >= 0; i -= 1) {
          stack[top] = value[i].value;
          frames[top] = frame;
          top += 1;
          if (value[i].key) {
            stack[top] = value[i].key;
            frames[top] = frame;
            top += 1;
          }
        }
      }
    }
  }
}

function walk(node, visit, parentInfo = null) {
  if (parentInfo === null && !wants(visit)) {
    bare(node, visit);
    return;
  }
  if (!node || !node.kind) return;
  if (visit.enter && visit.enter(node, parentInfo) === false) return;
  const kids = children(node);
  for (let i = 0; i < kids.length; i += 1) walk(kids[i].node, visit, kids[i]);
  if (visit.leave) visit.leave(node, parentInfo);
}

function transform(node, fn) {
  if (!node || !node.kind) return node;
  const kids = children(node);
  for (let i = 0; i < kids.length; i += 1) {
    const child = kids[i];
    const replaced = transform(child.node, fn);
    if (replaced === child.node) continue;
    if (child.index === null) child.parent[child.key] = replaced;
    else child.parent[child.key][child.index] = replaced;
  }
  const result = fn(node);
  return result === undefined ? node : result;
}

function collect(root, predicate) {
  const found = [];
  walk(root, {
    enter(node) {
      if (predicate(node)) found.push(node);
    },
  });
  return found;
}

function clone(node) {
  if (Array.isArray(node)) return node.map(clone);
  if (!node || typeof node !== 'object') return node;
  const copy = {};
  for (const key of Object.keys(node)) copy[key] = clone(node[key]);
  return copy;
}

module.exports = {
  CHILDREN,
  children,
  framed,
  walk,
  transform,
  collect,
};

};

__modules["src/pipeline.js"] = function(module, exports, require) {
'use strict';

const { resolve } = require("src/lua/scope.js");
const { unparse } = require("src/lua/unparse.js");
const { matchWrapper } = require("src/steps/01-wrap.js");
const { detect } = require("src/vm/detect.js");

class Context {
  constructor(chunk, options = {}) {
    this.chunk = chunk;
    this.options = options;
    this.notes = [];
    this.stats = {};
    this.warnings = [];
    this.step = null;
    this.resolved = null;
  }

  note(message, count) {
    this.notes.push({ step: this.step, message, count });
  }

  warn(message) {
    this.warnings.push({ step: this.step, message });
  }

  bump(key, amount = 1) {
    this.stats[key] = (this.stats[key] || 0) + amount;
  }

  resolve() {
    this.resolved = resolve(this.chunk);
    return this.resolved;
  }

  reportProgress(event, data = {}) {
    if (typeof this.options.onProgress === 'function') {
      try {
        this.options.onProgress(event, { step: this.step, ...data, stats: this.stats });
      } catch (_) {}
    }
  }

  source() {
    return unparse(this.chunk, this.options.print);
  }
}

const STEPS = [
  require("src/steps/01-wrap.js"),
  require("src/steps/02-fold.js"),
  require("src/steps/03-str.js"),
  require("src/steps/04-lift.js"),
  require("src/steps/05-if.js"),
  require("src/steps/06-proxy.js"),
  require("src/steps/07-opt.js"),
  require("src/steps/08-vars.js"),
  require("src/steps/09-fmt.js"),
  require("src/steps/10-name.js"),
  require("src/steps/11-scope.js"),
];

const SETTLE = ['03-str', '06-proxy', '07-opt'];
const FINAL = ['08-vars', '09-fmt', '10-name', '11-scope'];
const PASSES = 4;
const LAYERS = 8;

function runStep(context, step, options, pass, layer) {
  context.step = step.name;
  context.reportProgress('start', { step: step.name, pass, layer });
  const started = Date.now();
  try {
    step.run(context);
  } catch (error) {
    if (options.strict) throw error;
    context.warn(`step failed: ${error.message}`);
    if (options.verbose) console.error(error.stack);
  }
  context.bump(`time.${step.name}`, Date.now() - started);
  context.reportProgress('end', { step: step.name, pass, layer });
  if (options.trace) {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(options.trace, { recursive: true });
    const deep = layer > 1 ? `.layer${layer}` : '';
    const suffix = pass > 1 ? `.pass${pass}` : '';
    fs.writeFileSync(
      path.join(options.trace, `${step.name}${deep}${suffix}.lua`),
      context.source(),
      'latin1',
    );
  }
}

function settle(context, group, options, layer) {
  const enabling = new Set(['03-str', '06-proxy']);
  for (let pass = 2; pass <= PASSES; pass += 1) {
    const before = context.notes.length;
    let moved = false;
    for (const step of group) {
      const mark = context.notes.length;
      runStep(context, step, options, pass, layer);
      if (enabling.has(step.name) && context.notes.length > mark) moved = true;
    }
    if (context.notes.length === before || !moved) return;
  }
}

function stacked(context) {
  if (matchWrapper(context.chunk.body)) return true;
  context.resolve();
  try {
    return detect(context.chunk).instances.length > 0;
  } catch (_) {
    return false;
  }
}

function run(chunk, options = {}) {
  const context = new Context(chunk, options);
  const only = options.only ? new Set(options.only) : null;
  const skip = options.skip ? new Set(options.skip) : new Set();
  const wanted = STEPS.filter((step) => (!only || only.has(step.name)) && !skip.has(step.name));
  const early = wanted.filter((step) => !FINAL.includes(step.name));
  const last = wanted.filter((step) => FINAL.includes(step.name));
  const group = SETTLE.map((name) => early.find((step) => step.name === name)).filter(Boolean);
  const closes = group.length ? Math.max(...group.map((step) => early.indexOf(step))) : -1;

  for (let layer = 1; layer <= LAYERS && early.length; layer += 1) {
    const before = context.notes.length;
    for (let i = 0; i < early.length; i += 1) {
      runStep(context, early[i], options, 1, layer);
      if (i === closes) settle(context, group, options, layer);
    }
    if (context.notes.length === before) break;
    if (!stacked(context)) break;
    context.bump('layers.stacked');
  }

  for (const step of last) runStep(context, step, options, 1, 1);
  context.step = null;
  return context;
}
module.exports = { Context, STEPS, run };

};

__modules["src/steps/01-wrap.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");

function matchWrapper(body) {
  if (!body || !body.statements.length) return null;
  const statement = body.statements[body.statements.length - 1];
  if (statement.kind !== Kind.Return || statement.expressions.length !== 1) return null;
  const call = statement.expressions[0];
  if (!call || call.kind !== Kind.Call) return null;

  let callee = call.base;
  while (callee && callee.kind === Kind.Paren) callee = callee.expression;
  if (!callee || callee.kind !== Kind.Function) return null;
  if ((callee.params || []).length !== 0) return null;

  for (const arg of call.args) {
    if (arg.kind !== Kind.Vararg) return null;
  }
  if (call.args.length > 1) return null;
  return callee;
}

function run(context) {
  let unwrapped = 0;
  for (;;) {
    const body = context.chunk.body;
    const fn = matchWrapper(body);
    if (!fn) break;
    body.statements.splice(body.statements.length - 1, 1, ...fn.body.statements);
    unwrapped += 1;
    if (unwrapped > 64) break;
  }
  if (unwrapped) {
    context.note(`removed ${unwrapped} WrapInFunction layer(s)`, unwrapped);
    context.bump('unwrap.layers', unwrapped);
  }
}

module.exports = { name: '01-wrap', run, matchWrapper };

};

__modules["src/steps/02-fold.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { transform } = require("src/lua/walk.js");
const C = require("src/util/const.js");

const ARITH = new Set(['+', '-', '*', '/', '%', '^', '..']);
const UNARY = new Set(['-']);

const BINARY = new Set([...ARITH, '==', '~=', '<', '<=', '>', '>=', 'and', 'or']);
const LOGIC = new Set([...UNARY, 'not']);

function foldTree(root, options = {}) {
  const binary = options.binary || ARITH;
  const unary = options.unary || UNARY;
  let folded = 0;
  transform(root, (node) => {
    if (node.kind === Kind.Binary) {
      if (!binary.has(node.operator)) return node;
      const replacement = C.foldBinary(node.operator, node.lhs, node.rhs);
      if (replacement) {
        folded += 1;
        return replacement;
      }
      return node;
    }
    if (node.kind === Kind.Unary) {
      if (!unary.has(node.operator)) return node;
      const replacement = C.foldUnary(node.operator, node.argument);
      if (replacement) {
        folded += 1;
        return replacement;
      }
      return node;
    }
    if (node.kind === Kind.Paren) {
      const inner = node.expression;
      if (inner && C.isConstant(inner)) {
        folded += 1;
        return inner;
      }
      return node;
    }
    return node;
  });
  return folded;
}

function run(context) {
  const folded = foldTree(context.chunk);
  if (folded) {
    context.note(`folded ${folded} constant expression(s)`, folded);
    context.bump('fold.count', folded);
  }
}

module.exports = {
  name: '02-fold',
  run,
  foldTree,
  BINARY,
  LOGIC,
};

};

__modules["src/steps/03-str.js"] = function(module, exports, require) {
'use strict';

const { Kind, isExpression } = require("src/lua/ast.js");
const { children, collect, walk, transform } = require("src/lua/walk.js");
const { Evaluator, readsIn, writesIn } = require("src/util/eval.js");
const { isLocalBinding, isGlobalName } = require("src/lua/scope.js");
const C = require("src/util/const.js");
const { copyRoots, soleValues, soleValueOf } = require("src/util/flow.js");
const { Writes } = require("src/util/writes.js");
const { LuaTable, LuaFunction } = require("src/interp/values.js");

function preludeWrites(statement, inside, summary, copies) {
  const written = new Set();
  let escapes = false;

  const note = (binding) => {
    if (!binding) return;
    if (!isLocalBinding(binding)) {
      escapes = true;
      return;
    }
    written.add(binding);
    const origin = copies.get(binding);
    if (origin) written.add(origin);
  };

  walk(statement, {
    enter(node) {
      inside.set(node, statement);
      if (node.kind === Kind.FunctionDeclaration) escapes = true;
      return undefined;
    },
  });
  for (const binding of writesIn(statement, true, copies)) note(binding);
  for (const binding of summary.of(statement)) note(binding);
  for (const binding of readsIn(statement)) if (isLocalBinding(binding)) note(binding);
  return escapes ? null : written;
}

function readOutside(binding, going, inside) {
  for (const read of binding.reads || []) if (!going.has(inside.get(read))) return true;
  return false;
}

function liveValues(evaluator, going, inside) {
  const stack = [evaluator.rt.globals];
  for (const [binding, slot] of evaluator.values) {
    if (slot && readOutside(binding, going, inside)) stack.push(slot.value);
  }
  const live = new Set();
  while (stack.length) {
    const value = stack.pop();
    if (!(value instanceof LuaTable) || live.has(value)) continue;
    live.add(value);
    for (const [key, entry] of value.map) {
      stack.push(key);
      stack.push(entry);
    }
    if (value.metatable) stack.push(value.metatable);
  }
  return live;
}

function touchesLive(touched, live, cells, going, inside) {
  for (const owner of touched) {
    if (owner instanceof LuaTable) {
      if (live.has(owner)) return true;
      continue;
    }
    const binding = cells.get(owner);
    if (!binding || readOutside(binding, going, inside)) return true;
  }
  return false;
}

function settle(going, owned, inside) {
  for (let round = 0; round < owned.size && going.size; round += 1) {
    let dropped = false;
    for (const statement of going) {
      let needed = false;
      for (const binding of owned.get(statement)) {
        if (binding) needed = readOutside(binding, going, inside);
        if (needed) break;
      }
      if (!needed) continue;
      going.delete(statement);
      dropped = true;
    }
    if (!dropped) break;
  }
}

function keepMutators(evaluator, going, owned, inside) {
  if (!evaluator.mutated.size) return;
  const cells = new Map();
  for (const [binding, cell] of evaluator.cells) cells.set(cell, binding);
  for (let round = 0; round < owned.size && going.size; round += 1) {
    const live = liveValues(evaluator, going, inside);
    let dropped = false;
    for (const statement of going) {
      const touched = evaluator.mutated.get(statement);
      if (!touched || !touchesLive(touched, live, cells, going, inside)) continue;
      going.delete(statement);
      dropped = true;
    }
    if (!dropped) break;
    settle(going, owned, inside);
  }
}

function dropPrelude(context, evaluator) {
  const prelude = evaluator.preludeStatements;
  if (!prelude.size) return 0;
  const copies = copyRoots(soleValues(context.chunk));
  const summary = new Writes(context.chunk, (root, into) => writesIn(root, into, copies), readsIn);
  const inside = new Map();
  const owned = new Map();
  for (const statement of prelude) {
    const written = preludeWrites(statement, inside, summary, copies);
    if (written) owned.set(statement, written);
  }
  const going = new Set(owned.keys());
  settle(going, owned, inside);
  keepMutators(evaluator, going, owned, inside);
  if (!going.size) return 0;
  const body = context.chunk.body;
  const before = body.statements.length;
  body.statements = body.statements.filter((statement) => !going.has(statement));
  return before - body.statements.length;
}

function guardedChildren(node) {
  const blocked = new Set();
  if (node.kind === Kind.CallStatement) blocked.add(node.expression);
  if (node.kind === Kind.Assignment) for (const t of node.targets) blocked.add(t);
  if (node.kind === Kind.FunctionDeclaration) blocked.add(node.target);
  return blocked;
}

function openChildren(node) {
  const expanding = new Set();
  const last = (list) => (list && list.length ? list[list.length - 1] : null);
  const mark = (child) => { if (child) expanding.add(child); };
  if (node.kind === Kind.Call || node.kind === Kind.MethodCall) mark(last(node.args));
  else if (node.kind === Kind.Return) mark(last(node.expressions));
  else if (node.kind === Kind.LocalDeclaration || node.kind === Kind.Assignment) {
    mark(last(node.expressions));
  } else if (node.kind === Kind.GenericFor) mark(last(node.expressions));
  else if (node.kind === Kind.Table) {
    const entry = last(node.entries);
    if (entry && entry.type === 'item') mark(entry.value);
  }
  return expanding;
}

function rootName(node) {
  let base = node;
  for (;;) {
    if (!base) return null;
    if (base.kind === Kind.Paren) { base = base.expression; continue; }
    if (base.kind === Kind.Index) { base = base.base; continue; }
    return base.kind === Kind.Name ? base : null;
  }
}

function isData(node) {
  if (!node) return false;
  if (C.isConstant(node)) return true;
  if (node.kind === Kind.Paren) return isData(node.expression);
  if (node.kind !== Kind.Table) return false;
  return (node.entries || []).every((entry) => {
    if (entry.type === 'item') return isData(entry.value);
    if (entry.type === 'key') return C.isConstant(entry.key) && isData(entry.value);
    return false;
  });
}

function isOwned(node) {
  if (spelledOut(node)) return true;
  const root = rootName(node);
  return !!root && !isGlobalName(root);
}

function peel(node) {
  let base = node;
  while (base && base.kind === Kind.Paren) base = base.expression;
  return base;
}

function spelledOut(node) {
  const base = peel(node);
  return !!base && (base.kind === Kind.Function || base.kind === Kind.Table);
}

function heldValue(evaluator, node) {
  if (!evaluator) return undefined;
  const seen = evaluator.evaluate(node);
  return seen && seen.ok ? seen.value : undefined;
}

function isOwn(node, values, seen = new Set()) {
  const base = peel(node);
  if (!base || seen.has(base)) return false;
  seen.add(base);
  if (base.kind === Kind.Function || base.kind === Kind.Table) return true;
  if (base.kind === Kind.Name) {
    if (isGlobalName(base)) return false;
    return isOwn(soleValueOf(values, base.binding), values, seen);
  }
  if (base.kind === Kind.Index) return isOwn(base.base, values, seen);
  return false;
}

function holdsOwn(node, sort, ctx) {
  if (isOwn(node, ctx.values)) return true;
  return heldValue(ctx.evaluator, node) instanceof sort;
}

function isRawRead(node, ctx) {
  const table = heldValue(ctx.evaluator, node.base);
  if (!(table instanceof LuaTable)) return false;
  const key = heldValue(ctx.evaluator, node.index);
  if (key === undefined || key === null) return false;
  return filed(table, key, new Set());
}

function filed(table, key, seen) {
  let at = table;
  while (at instanceof LuaTable && !seen.has(at)) {
    seen.add(at);
    if (at.get(key) !== undefined) return true;
    const meta = at.metatable;
    at = meta instanceof LuaTable ? meta.get('__index') : undefined;
  }
  return false;
}

function isAccessor(node, ctx) {
  if (node.kind === Kind.Index) {
    if (node.index && node.index.kind === Kind.String) return false;
    if (!isOwned(node.base)) return false;
    if (!holdsOwn(node.base, LuaTable, ctx)) return false;
    return isRawRead(node, ctx);
  }
  if (node.kind === Kind.Call) {
    if (!isOwned(node.base)) return false;
    if (!holdsOwn(node.base, LuaFunction, ctx)) return false;
    return (node.args || []).every((argument) => isData(argument));
  }
  return false;
}

const LOOPS = new Set([Kind.While, Kind.Repeat, Kind.NumericFor, Kind.GenericFor]);

function tablesPassed(evaluator, root) {
  const found = new Set();
  const note = (node) => {
    const base = peel(node);
    if (!base) return;
    if (base.kind === Kind.Name) {
      if (!base.binding) return;
      const cell = evaluator.cells.get(base.binding);
      if (cell && cell.value instanceof LuaTable) {
        found.add(base.binding);
        found.add(cell.value);
      }
      return;
    }
    const held = heldValue(evaluator, node);
    if (held instanceof LuaTable) found.add(held);
  };
  walk(root, {
    enter: (node) => {
      if (node.kind === Kind.Call) (node.args || []).forEach(note);
      else if (node.kind === Kind.MethodCall) {
        note(node.base);
        (node.args || []).forEach(note);
      }
      return undefined;
    },
  });
  return found;
}

function foldValues(evaluator, root, options = {}) {
  const skip = options.skip || new Set();
  const ctx = { evaluator, values: options.values || new Map() };
  const anyExpression = options.anyExpression === true;
  const counts = { folded: 0, strings: 0 };

  const visit = (node) => {
    const kept = evaluator.dirty;
    if (LOOPS.has(node.kind)) {
      const passed = tablesPassed(evaluator, node);
      if (passed.size) evaluator.dirty = kept ? new Set([...kept, ...passed]) : passed;
    }
    const blocked = guardedChildren(node);
    const expanding = openChildren(node);
    for (const child of children(node)) {
      const target = child.node;
      if (!target || skip.has(target)) continue;
      if (isExpression(target) && !blocked.has(target)
        && (anyExpression || isAccessor(target, ctx))) {
        const literal = evaluator.literalFor(target, expanding.has(target));
        if (literal) {
          if (child.index === null) child.parent[child.key] = literal;
          else child.parent[child.key][child.index] = literal;
          counts.folded += 1;
          if (literal.kind === Kind.String) counts.strings += 1;
          continue;
        }
      }
      const nested = target.kind === Kind.Function;
      if (nested) evaluator.depth += 1;
      visit(target);
      if (nested) evaluator.depth -= 1;
    }
    evaluator.dirty = kept;
  };

  visit(root);
  return counts;
}

function writeTargets(root) {
  const blocked = new Set();
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Assignment) {
        for (const target of node.targets || []) blocked.add(target);
      } else if (node.kind === Kind.FunctionDeclaration && node.target) {
        blocked.add(node.target);
      }
      return undefined;
    },
  });
  return blocked;
}

function foldLookups(evaluator, root, context) {
  const counts = { folded: 0, strings: 0 };
  const blocked = writeTargets(root);
  transform(root, (node) => {
    if (blocked.has(node)) return node;
    const literal = evaluator.cacheLiteralFor(node);
    if (!literal) return node;
    counts.folded += 1;
    if (literal.kind === Kind.String) {
      counts.strings += 1;
      if (context && (counts.strings % 25 === 0 || counts.strings === 1)) {
        context.reportProgress('progress', { step: '03-strings', strings: counts.strings, folded: counts.folded });
      }
    }
    return literal;
  });
  return counts;
}

function run(context) {
  context.resolve();
  const counts = { folded: 0, strings: 0 };
  const evaluator = new Evaluator(context.chunk, context.options);

  const values = soleValues(context.chunk);

  evaluator.prepare((statement) => {
    const step = foldValues(evaluator, statement, { values });
    counts.folded += step.folded;
    counts.strings += step.strings;
    if (counts.strings > 0 && (counts.strings % 25 === 0 || counts.folded % 50 === 0)) {
      context.reportProgress('progress', { step: '03-strings', strings: counts.strings, folded: counts.folded });
    }
  });
  const cached = foldLookups(evaluator, context.chunk, context);
  counts.folded += cached.folded;
  counts.strings += cached.strings;
  context.evaluator = evaluator;
  context.reportProgress('progress', { step: '03-strings', strings: counts.strings, folded: counts.folded });
  if (counts.folded) {
    context.note(
      `resolved ${counts.folded} hidden constant(s), ${counts.strings} string(s)`,
      counts.folded,
    );
    context.bump('decrypt.constants', counts.folded);
    context.bump('decrypt.strings', counts.strings);
  }
  if (evaluator.skipped.length) {
    context.bump('decrypt.skippedStatements', evaluator.skipped.length);
  }
  context.resolve();
  const dropped = dropPrelude(context, evaluator);
  if (dropped) {
    context.note(`removed the ${dropped}-statement decoder prelude`, dropped);
    context.bump('decrypt.preludeRemoved', dropped);
    context.resolve();
  }
}

module.exports = { name: '03-str', run, Evaluator, C };

};

__modules["src/steps/04-lift.js"] = function(module, exports, require) {
'use strict';

const A = require("src/lua/ast.js");
const { Kind } = A;
const { parentMap } = require("src/vm/detect.js");
const { detect } = require("src/vm/detect.js");
const { buildCfg } = require("src/vm/cfg.js");
const { liftVm, resultList } = require("src/vm/lift.js");

const fold = require("src/steps/02-fold.js");
const decrypt = require("src/steps/03-str.js");
const guards = require("src/steps/05-if.js");
const idioms = require("src/vm/idioms.js");
const { discharge } = require("src/util/dead-stores.js");
const { walk } = require("src/lua/walk.js");

function varargsArg(vm) {
  const bindings = (vm.wrapper && vm.wrapper.bindings) || [];
  const slot = vm.roles.varargs ? bindings.indexOf(vm.roles.varargs) : -1;
  if (slot < 0) return null;
  return vm.wrapperCall.args[slot] || null;
}

const CARRIED = new Set([Kind.Name, Kind.Number, Kind.String, Kind.Nil, Kind.True, Kind.False]);

function copyPair(statement) {
  if (statement.kind === Kind.Assignment) {
    if (statement.targets.length !== 1 || statement.expressions.length !== 1) return null;
    const target = statement.targets[0];
    const source = A.unparen(statement.expressions[0]);
    if (target.kind !== Kind.Name || source.kind !== Kind.Name) return null;
    return { target: target.binding, source: source.binding, write: target };
  }
  if (statement.kind === Kind.LocalDeclaration) {
    if (statement.names.length !== 1 || statement.expressions.length !== 1) return null;
    const source = A.unparen(statement.expressions[0]);
    if (source.kind !== Kind.Name) return null;
    return { target: (statement.bindings || [])[0], source: source.binding, write: null };
  }
  return null;
}

function callValues(vm) {
  const values = new Map();
  const wrapper = vm.wrapper;
  if (!wrapper || !wrapper.body) return values;
  const args = vm.wrapperCall.args || [];
  const tail = args.length ? A.unparen(args[args.length - 1]) : null;
  const spread = tail ? A.isMultiValue(tail) : false;
  (wrapper.bindings || []).forEach((binding, slot) => {
    if (!binding || slot >= args.length) return;
    if (spread && slot === args.length - 1) return;
    const arg = A.unparen(args[slot]);
    if (CARRIED.has(arg.kind)) values.set(binding, arg);
  });
  for (let round = 0; round < 8; round += 1) {
    let added = 0;
    for (const statement of wrapper.body.statements) {
      const pair = copyPair(statement);
      if (!pair || !pair.target || values.has(pair.target)) continue;
      const value = values.get(pair.source);
      if (!value) continue;
      const writes = pair.target.writes || [];
      const once = pair.write ? writes.length === 1 && writes[0] === pair.write : !writes.length;
      if (!once) continue;
      values.set(pair.target, value);
      added += 1;
    }
    if (!added) break;
  }
  return values;
}

function become(node, value) {
  for (const key of Object.keys(node)) delete node[key];
  Object.assign(node, value.kind === Kind.Name ? A.name(value.name) : { ...value });
}

function wrapperDepth(vm) {
  let depth = null;
  for (const binding of (vm.wrapper && vm.wrapper.bindings) || []) {
    if (!binding) continue;
    const at = binding.functionDepth;
    depth = depth === null ? at : Math.max(depth, at);
  }
  return depth;
}

function reseat(context, vm, lifted) {
  const values = callValues(vm);
  const depth = wrapperDepth(vm);
  const sites = new Map();
  walk(lifted.body, {
    enter(node) {
      if (node.kind !== Kind.Name || !node.binding) return undefined;
      if (node.binding.kind === 'global') return undefined;
      const list = sites.get(node.binding);
      if (list) list.push(node);
      else sites.set(node.binding, [node]);
      return undefined;
    },
  });
  let moved = 0;
  for (const [binding, nodes] of sites) {
    const value = values.get(binding);
    if (value) {
      for (const node of nodes) become(node, value);
      moved += nodes.length;
      continue;
    }
    if (depth === null || binding.functionDepth < depth) continue;
    context.warn(`lift: carried-local ${binding.name}`);
    context.bump('lift.carried-local');
  }
  return moved;
}

function tailReturn(call, parents) {
  let node = call;
  for (let guard = 0; guard < 16; guard += 1) {
    const parent = parents.get(node);
    if (!parent) return null;
    if (parent.kind === Kind.Return) {
      return parent.expressions.length === 1 && parent.expressions[0] === node ? parent : null;
    }
    if (parent.kind === Kind.Paren) {
      node = parent;
      continue;
    }
    if (parent.kind === Kind.Table) {
      const entries = parent.entries || [];
      if (entries.length !== 1 || entries[0].type !== 'item' || entries[0].value !== node) {
        return null;
      }
      node = parent;
      continue;
    }
    if (parent.kind === Kind.Call && parent.base && parent.base.kind === Kind.Name
      && (parent.args || []).length === 1 && parent.args[0] === node) {
      node = parent;
      continue;
    }
    return null;
  }
  return null;
}

function replaceStatement(parents, statement, replacement) {
  const block = parents.get(statement);
  if (!block || !Array.isArray(block.statements)) return false;
  const at = block.statements.indexOf(statement);
  if (at < 0) return false;
  block.statements.splice(at, 1, ...replacement);
  return true;
}

function place(chunk, vm, lifted) {
  const parents = parentMap(chunk);
  const statement = tailReturn(vm.wrapperCall, parents);
  if (statement && replaceStatement(parents, statement, lifted.body.statements)) {
    return 'inline';
  }

  const call = vm.wrapperCall;
  call.base = A.paren(A.func([], lifted.body, true));
  call.args = [A.vararg()];
  return 'closure';
}

function devirtualize(context, vm, counter) {
  const cfg = buildCfg(vm);
  const lifted = liftVm(vm, cfg, { counter, varargs: varargsArg(vm) });
  for (const warning of lifted.warnings) {
    context.warn(`lift: ${warning.kind} ${JSON.stringify(warning)}`);
    context.bump(`lift.${warning.kind}`);
  }
  const reseated = reseat(context, vm, lifted);
  if (reseated) context.bump('devirtualize.reseated', reseated);
  const how = place(context.chunk, vm, lifted);
  context.bump(`devirtualize.${how}`);
  context.bump('devirtualize.blocks', cfg.blocks.size);
  context.bump('devirtualize.functions', cfg.functions.length);
  return lifted.counter;
}

function run(context) {
  let counter = 0;
  let layers = 0;
  for (let pass = 0; pass < 32; pass += 1) {
    context.resolve();
    const found = detect(context.chunk);
    for (const rejected of found.rejected) {
      context.bump(`devirtualize.rejected.${rejected.reason}`);
    }
    if (!found.instances.length) break;

    for (const vm of found.instances) {
      counter = devirtualize(context, vm, counter);
      layers += 1;
      context.reportProgress('progress', {
        step: '04-devirt',
        layers,
        blocks: context.stats['devirtualize.blocks'] || 0,
        functions: context.stats['devirtualize.functions'] || 0,
      });
    }

    context.resolve();
    fold.run(context);

    guards.run(context);
    context.resolve();
    decrypt.run(context);

    context.resolve();
    idioms.run(context);
  }
  if (layers) {
    context.resolve();

    const discharged = discharge(context.chunk);
    if (discharged) {
      context.bump('devirtualize.discharged', discharged);
      context.resolve();
    }
    context.note(`devirtualized ${layers} VM layer(s)`, layers);
    context.bump('devirtualize.layers', layers);
  }
}

module.exports = { name: '04-lift', run, resultList };

};

__modules["src/steps/05-if.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { isGlobalName } = require("src/lua/scope.js");
const { transform, walk } = require("src/lua/walk.js");
const { diverges, divergesBlock, bare } = require("src/util/flow.js");
const C = require("src/util/const.js");

function isPure(node) {
  if (!node) return true;
  const inner = bare(node);
  if (!inner) return true;
  switch (inner.kind) {
    case Kind.Name:
    case Kind.Nil: case Kind.True: case Kind.False:
    case Kind.Number: case Kind.String: case Kind.Vararg:
      return true;
    case Kind.Unary:
      return isPure(inner.argument);
    case Kind.Binary:
      return isPure(inner.lhs) && isPure(inner.rhs);
    default:
      return false;
  }
}

function inlined(block) {
  return { kind: Kind.Do, body: block, inlineHint: true };
}

function resolveGuard(statement, counters) {
  const clauses = [
    { condition: statement.condition, body: statement.body },
    ...(statement.elseIfs || []).map((clause) => ({ ...clause })),
  ];
  const otherwise = statement.elseBody;
  if (!otherwise) return null;
  if (!clauses.every((clause) => isPure(clause.condition))) return null;

  const exits = clauses.map((clause) => divergesBlock(clause.body));
  const elseExits = divergesBlock(otherwise);
  const live = exits.filter((value) => !value).length + (elseExits ? 0 : 1);
  if (live !== 1) return null;

  counters.guards += 1;
  if (!elseExits) return inlined(otherwise);
  const at = exits.indexOf(false);
  return inlined(clauses[at].body);
}

function isWatermark(statement) {
  if (statement.kind !== Kind.CallStatement) return false;
  const call = bare(statement.expression);
  if (!call || call.kind !== Kind.MethodCall || call.method !== 'gsub') return false;
  const subject = bare(call.base);
  if (!subject || subject.kind !== Kind.String) return false;
  const args = call.args || [];
  if (args.length !== 2) return false;
  const pattern = bare(args[0]);
  if (!pattern || pattern.kind !== Kind.String) return false;
  const fn = bare(args[1]);
  if (!fn || fn.kind !== Kind.Function) return false;
  const body = (fn.body && fn.body.statements) || [];
  if (body.length !== 1 || body[0].kind !== Kind.Assignment) return false;
  const targets = body[0].targets || [];
  return targets.length === 1 && isGlobalName(targets[0]);
}

function isWatermarkCheck(statement) {
  if (statement.kind !== Kind.If) return false;
  if ((statement.elseIfs || []).length) return false;
  const body = (statement.body && statement.body.statements) || [];
  if (body.length !== 1 || body[0].kind !== Kind.Return) return false;
  if ((body[0].expressions || []).length) return false;
  const test = bare(statement.condition);
  if (!test || test.kind !== Kind.Binary || test.operator !== '~=') return false;
  const sides = [bare(test.lhs), bare(test.rhs)];
  const global = sides.find((side) => isGlobalName(side));
  const literal = sides.find((side) => side && side.kind === Kind.String);
  return !!global && !!literal;
}

function resolveConstant(statement, counters) {
  const clauses = [
    { condition: statement.condition, body: statement.body },
    ...(statement.elseIfs || []).map((clause) => ({ ...clause })),
  ];
  const kept = [];
  let taken = null;
  for (const clause of clauses) {
    const value = C.truthiness(clause.condition);
    if (value === false) continue;
    if (value === true) {
      taken = clause;
      break;
    }
    kept.push(clause);
  }
  const otherwise = taken ? taken.body : statement.elseBody;
  const dropped = clauses.length - kept.length - (taken ? 1 : 0);
  if (!dropped && !taken) return null;
  counters.constants += 1;
  if (!kept.length) {
    return inlined(otherwise || { kind: Kind.Block, statements: [] });
  }
  return {
    kind: Kind.If,
    condition: kept[0].condition,
    body: kept[0].body,
    elseIfs: kept.slice(1),
    elseBody: otherwise,
  };
}

function flattenMarkers(root) {
  let merged = 0;
  walk(root, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      const out = [];
      for (const statement of node.statements) {
        if (statement.kind === Kind.Do && statement.inlineHint) {
          merged += 1;
          out.push(...((statement.body && statement.body.statements) || []));
        } else out.push(statement);
      }
      node.statements = out;
      return undefined;
    },
  });
  return merged;
}

function isAntiTamperGuard(statement, blockStatements, index) {
  if (statement.kind !== Kind.If) return false;
  if (statement.elseIfs && statement.elseIfs.length > 0) return false;
  if (statement.elseBody && statement.elseBody.statements && statement.elseBody.statements.length > 0) {
    if (!divergesBlock(statement.elseBody)) return false;
  }

  const cond = bare(statement.condition);
  if (!cond || cond.kind !== Kind.Name) return false;

  const flagName = cond.name;
  const binding = cond.binding;

  const preceding = blockStatements.slice(0, index);
  let hasTamperCheck = false;
  let flagInitialized = false;

  for (const prev of preceding) {
    walk(prev, {
      enter(node) {
        if (node.kind === Kind.String && typeof node.value === 'string' && /tamper/i.test(node.value)) {
          hasTamperCheck = true;
        }
        if (node.kind === Kind.Call && node.base && node.base.kind === Kind.Name && node.base.name === 'error') {
          if (node.args && node.args.length && node.args[0].kind === Kind.String && /tamper/i.test(node.args[0].value)) {
            hasTamperCheck = true;
          }
        }
        if (node.kind === Kind.Assignment) {
          for (let i = 0; i < (node.targets || []).length; i += 1) {
            const target = bare(node.targets[i]);
            if (target && target.kind === Kind.Name && (target.name === flagName || (binding && target.binding === binding))) {
              const expr = (node.expressions || [])[i];
              if (expr && (expr.kind === Kind.True || C.truthiness(expr) === true)) {
                flagInitialized = true;
              }
            }
          }
        }
        return undefined;
      },
    });
  }

  return hasTamperCheck && flagInitialized;
}

function pruneBlock(block, counters) {
  const out = [];
  for (let i = 0; i < block.statements.length; i += 1) {
    const statement = block.statements[i];
    if (isAntiTamperGuard(statement, block.statements, i)) {
      counters.guards += 1;
      const inner = (statement.body && statement.body.statements) || [];
      out.push(...inner);
      continue;
    }
    if (statement.kind === Kind.Repeat && !(statement.body.statements || []).length) {
      if (isPure(statement.condition)) {
        counters.loops += 1;
        continue;
      }
    }
    if (statement.kind === Kind.While && C.truthiness(statement.condition) === false) {
      counters.loops += 1;
      continue;
    }
    if (isWatermark(statement)) {
      counters.watermarks += 1;
      continue;
    }
    if (isWatermarkCheck(statement)) {
      counters.watermarks += 1;

      if (statement.elseBody) out.push(inlined(statement.elseBody));
      continue;
    }
    out.push(statement);
  }
  block.statements = out;
}

function pruneUnreachable(root, counters) {
  walk(root, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      for (let i = 0; i < node.statements.length; i += 1) {
        const statement = node.statements[i];
        const stops = statement.kind === Kind.Return || statement.kind === Kind.Break
          || diverges(statement);
        if (stops && i + 1 < node.statements.length) {
          counters.unreachable += node.statements.length - i - 1;
          node.statements.length = i + 1;
          break;
        }
      }
      return undefined;
    },
  });
}

function run(context) {
  const counters = {
    guards: 0, constants: 0, loops: 0, watermarks: 0, unreachable: 0,
  };
  for (let pass = 0; pass < 16; pass += 1) {
    const before = { ...counters };
    context.resolve();
    transform(context.chunk, (node) => {
      if (node.kind !== Kind.If) return node;
      const constant = resolveConstant(node, counters);
      if (constant) return constant;
      const guard = resolveGuard(node, counters);
      if (guard) return guard;
      return node;
    });
    flattenMarkers(context.chunk);
    walk(context.chunk, {
      enter(node) {
        if (node.kind === Kind.Block) pruneBlock(node, counters);
        return undefined;
      },
    });
    pruneUnreachable(context.chunk, counters);
    const changed = Object.keys(counters).some((key) => counters[key] !== before[key]);
    if (!changed) break;
  }
  const total = counters.guards + counters.constants + counters.loops + counters.watermarks;
  if (total) {
    context.note(
      `resolved ${counters.guards} integrity guard(s), ${counters.constants} constant branch(es),`
      + ` dropped ${counters.loops} dead loop(s) and ${counters.watermarks} watermark(s)`,
      total,
    );
  }
  for (const key of Object.keys(counters)) {
    if (counters[key]) context.bump(`guards.${key}`, counters[key]);
  }
}

module.exports = { name: '05-if', run };

};

__modules["src/steps/06-proxy.js"] = function(module, exports, require) {
'use strict';

const A = require("src/lua/ast.js");
const { Kind } = A;
const { transform, walk } = require("src/lua/walk.js");
const { bare, soleValues, soleValueOf } = require("src/util/flow.js");
const { isGlobalName } = require("src/lua/scope.js");
const { Interpreter, Scope } = require("src/interp/interpreter.js");
const { LuaTable } = require("src/interp/values.js");
const effects = require("src/interp/effects.js");

const OPERATOR = {
  __add: '+', __sub: '-', __mul: '*', __div: '/', __pow: '^', __concat: '..',
};

function keyOf(entry) {
  if (!entry || entry.type !== 'key') return null;
  const key = bare(entry.key);
  return key && key.kind === Kind.String ? key.value : null;
}

function readBinding(node) {
  const inner = bare(node);
  return inner && inner.kind === Kind.Name ? inner.binding || null : null;
}

function functionBehind(node, values, found) {
  let inner = bare(node);
  const seen = new Set();
  for (let guard = 0; inner && guard < 8; guard += 1) {
    if (inner.kind === Kind.Function) return inner;
    const read = found ? appliedTo(inner, found, 'getKey') || heldField(inner, found) : null;
    if (read) {
      inner = bare(heldOf(read));
      continue;
    }
    if (inner.kind !== Kind.Name || !inner.binding || seen.has(inner.binding)) return null;
    seen.add(inner.binding);
    inner = bare(valueOf(values, inner.binding));
  }
  return null;
}

const HELD = ' proxy-held';
const GIVEN = ' proxy-given';

function classify(fn, field, values) {
  const literal = functionBehind(fn, values);
  if (!literal || (literal.params || []).length !== 2) return null;
  const rt = new Interpreter({ stepLimit: 20000, maxCallDepth: 16, lenient: true });
  const probe = new LuaTable();
  probe.set(field, HELD);
  let results;
  try {
    const value = rt.eval(literal, new Scope(null));
    results = rt.call(value, [probe, GIVEN]);
  } catch (error) {
    return null;
  }
  const after = probe.get(field);
  const returned = results.length ? results[0] : undefined;
  if (after === GIVEN && returned === undefined && results.length <= 1) return 'set';
  if (after === HELD && returned === HELD && results.length === 1) return 'get';
  return null;
}

function matchProxy(expression, setmetatables, values) {
  const call = bare(expression);
  if (!call || call.kind !== Kind.Call) return null;
  const callee = bare(call.base);
  const args = call.args || [];
  if (args.length !== 2) return null;
  const viaLocal = callee && callee.kind === Kind.Name && callee.binding
    && setmetatables.has(callee.binding);
  const viaGlobal = isGlobalName(callee) && callee.name === 'setmetatable';
  if (!viaLocal && !viaGlobal) return null;

  const value = bare(args[0]);
  const meta = bare(args[1]);
  if (!value || value.kind !== Kind.Table || !meta || meta.kind !== Kind.Table) return null;
  const valueEntries = value.entries || [];
  const metaEntries = meta.entries || [];
  if (valueEntries.length !== 1 || metaEntries.length !== 2) return null;
  const field = keyOf(valueEntries[0]);
  if (!field) return null;

  const roles = {};
  for (const entry of metaEntries) {
    const key = keyOf(entry);
    if (!key || (key !== '__index' && !OPERATOR[key])) return null;
    const role = classify(entry.value, field, values);
    if (!role || roles[role]) return null;
    roles[role] = key;
  }
  if (!roles.set || !roles.get) return null;

  return {
    field, setKey: roles.set, getKey: roles.get, init: valueEntries[0].value, at: valueEntries[0],
  };
}

const singleValues = soleValues;
const valueOf = soleValueOf;

function metaBindings(values) {
  const found = new Set();
  for (const binding of values.keys()) {
    const value = bare(valueOf(values, binding));
    if (value && isGlobalName(value) && value.name === 'setmetatable') found.add(binding);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const binding of values.keys()) {
      if (found.has(binding)) continue;
      const held = bare(valueOf(values, binding));
      if (!held || held.kind !== Kind.Name || !held.binding) continue;
      if (!found.has(held.binding)) continue;
      found.add(binding);
      grew = true;
    }
  }
  return found;
}

function doesNothing(literal) {
  if (!literal || (literal.params || []).length) return false;
  const rt = new Interpreter({ stepLimit: 20000, maxCallDepth: 16 });
  try {
    const value = rt.eval(literal, new Scope(null));
    const trial = effects.record(() => rt.call(value, []));
    return trial.value.length === 0 && trial.writes.size === 0;
  } catch (error) {
    return false;
  }
}

function emptyBindings(values, found) {
  const empties = new Set();
  const known = new Map();
  for (const binding of values.keys()) {
    const literal = functionBehind(valueOf(values, binding), values, found);
    if (!literal) continue;
    if (!known.has(literal)) known.set(literal, doesNothing(literal));
    if (known.get(literal)) empties.add(binding);
  }
  return empties;
}

function findProxies(values, setmetatables, counters) {
  const proxies = new Map();
  for (const binding of values.keys()) {
    const at = values.get(binding);
    const proxy = matchProxy(at.list[at.index], setmetatables, values);
    if (!proxy) continue;
    proxies.set(binding, Object.assign({ name: binding.name }, proxy));
    at.list[at.index] = proxy.init;
    counters.locals += 1;
  }
  return proxies;
}

function aliasProxies(values, proxies) {
  let grew = true;
  while (grew) {
    grew = false;
    for (const binding of values.keys()) {
      if (proxies.has(binding)) continue;
      const held = bare(valueOf(values, binding));
      if (!held || held.kind !== Kind.Name || !held.binding) continue;
      const proxy = proxies.get(held.binding);
      if (!proxy) continue;
      proxies.set(binding, proxy);
      grew = true;
    }
  }
}

function inlineProxies(chunk, setmetatables, values, counters) {
  const inline = new Map();
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Call) return undefined;
      const proxy = matchProxy(node, setmetatables, values);
      if (proxy) {
        inline.set(node, proxy);
        counters.locals += 1;
      }
      return undefined;
    },
  });
  return inline;
}

function proxyOf(node, found) {
  const inner = bare(node);
  if (!inner) return null;
  const direct = found.inline.get(inner);
  if (direct) return { proxy: direct, via: null };
  const binding = inner.kind === Kind.Name ? inner.binding : null;
  if (!binding) return null;
  const proxy = found.proxies.get(binding);
  return proxy ? { proxy, via: binding } : null;
}

function appliedTo(node, found, which) {
  if (!node) return null;
  if (node.kind === Kind.Index) {
    const at = proxyOf(node.base, found);
    if (!at || at.proxy[which] !== '__index') return null;
    return { proxy: at.proxy, via: at.via, value: node.index };
  }
  if (node.kind === Kind.Binary) {
    const at = proxyOf(node.lhs, found);
    if (at && OPERATOR[at.proxy[which]] === node.operator) {
      return { proxy: at.proxy, via: at.via, value: node.rhs };
    }
  }
  return null;
}

function heldField(node, found) {
  if (!node || node.kind !== Kind.Index) return null;
  const at = proxyOf(node.base, found);
  if (!at) return null;
  const key = bare(node.index);
  if (!key || key.kind !== Kind.String || key.value !== at.proxy.field) return null;
  return at;
}

function writtenProxies(chunk, found) {
  const written = new Set();
  walk(chunk, {
    enter(node) {
      const set = appliedTo(node, found, 'setKey');
      if (set) written.add(set.proxy);
      if (node.kind !== Kind.Assignment) return undefined;
      for (const target of node.targets || []) {
        const inner = bare(target);
        if (!inner || inner.kind !== Kind.Index) continue;
        const at = proxyOf(inner.base, found);
        if (at) written.add(at.proxy);
      }
      return undefined;
    },
  });
  return written;
}

function nameOf(at, found) {
  if (at.via && !found.written.has(at.proxy)) return at.via.name;
  return at.proxy.name;
}

function heldOf(at) {
  return at.proxy.at ? at.proxy.at.value : at.proxy.init;
}

function holderOf(at, found) {
  const name = nameOf(at, found);
  if (name) return A.name(name);
  return heldOf(at);
}

function unwrapAssignment(statement, found, empties, counters) {
  if (statement.kind !== Kind.CallStatement) return null;
  const call = bare(statement.expression);
  if (!call || call.kind !== Kind.Call) return null;

  const callee = bare(call.base);
  const read = appliedTo(callee, found, 'getKey');
  const named = read ? read.proxy.binding : (callee.kind === Kind.Name ? callee.binding : null);
  const empty = read && !read.proxy.name
    ? doesNothing(bare(read.proxy.init))
    : !!named && empties.has(named);
  if (!empty) return null;
  const args = call.args || [];
  if (!args.length) return null;
  const applied = appliedTo(bare(args[0]), found, 'setKey');
  if (!applied) return null;
  const name = nameOf(applied, found);
  if (!name) return null;
  counters.assignments += 1;
  return A.assignment([A.name(name)], [applied.value, ...args.slice(1)]);
}

function unwrapTargets(statement, found, counters) {
  if (statement.kind !== Kind.Assignment) return;
  statement.targets = (statement.targets || []).map((target) => {
    const inner = bare(target);
    if (!inner || inner.kind !== Kind.Index) return target;
    const at = proxyOf(inner.base, found);
    if (!at) return target;
    const name = nameOf(at, found);
    if (!name) return target;
    const key = bare(inner.index);
    if (!key || key.kind !== Kind.String || key.value !== at.proxy.field) return target;
    counters.targets += 1;
    return A.name(name);
  });
}

function run(context) {
  const counters = {
    locals: 0, reads: 0, assignments: 0, targets: 0,
  };
  context.resolve();
  const values = singleValues(context.chunk);
  const setmetatables = metaBindings(values);
  if (!setmetatables.size) return;
  const proxies = findProxies(values, setmetatables, counters);
  for (const [binding, proxy] of proxies) proxy.binding = proxy.binding || binding;
  aliasProxies(values, proxies);
  const inline = inlineProxies(context.chunk, setmetatables, values, counters);
  if (!proxies.size && !inline.size) return;
  const found = { proxies, inline, written: new Set() };
  found.written = writtenProxies(context.chunk, found);
  const empties = emptyBindings(values, found);

  walk(context.chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      node.statements = node.statements.map((statement) => {
        const replacement = unwrapAssignment(statement, found, empties, counters);
        if (replacement) return replacement;
        unwrapTargets(statement, found, counters);
        return statement;
      });
      return undefined;
    },
  });

  transform(context.chunk, (node) => {
    const applied = appliedTo(node, found, 'getKey');
    if (applied) {
      counters.reads += 1;
      return holderOf(applied, found);
    }
    const held = heldField(node, found);
    if (held) {
      counters.reads += 1;
      return holderOf(held, found);
    }
    return node;
  });

  context.resolve();
  const total = counters.locals + counters.reads + counters.assignments + counters.targets;
  if (total) {
    context.note(
      `unproxied ${counters.locals} local(s): ${counters.reads} read(s),`
      + ` ${counters.assignments} assignment(s)`,
      total,
    );
  }
  for (const key of Object.keys(counters)) {
    if (counters[key]) context.bump(`unproxy.${key}`, counters[key]);
  }
}

module.exports = { name: '06-proxy', run };

};

__modules["src/steps/07-opt.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const A = require("src/lua/ast.js");
const { walk, transform } = require("src/lua/walk.js");
const purity = require("src/util/purity.js");
const { isIdentifier } = require("src/lua/format.js");
const { isGlobalName, isLocalBinding } = require("src/lua/scope.js");
const idioms = require("src/vm/idioms.js");
const { Writes } = require("src/util/writes.js");
const { writesIn, readsIn } = require("src/util/eval.js");
const { removeStores, removeRedundant } = require("src/util/dead-stores.js");
const { removeDead } = require("src/util/dead-code.js");
const { Positions } = require("src/util/order.js");

const fold = require("src/steps/02-fold.js");
const guards = require("src/steps/05-if.js");
const C = require("src/util/const.js");

function decideLogic(chunk, facts, counters) {
  let decided = 0;
  transform(chunk, (node) => {
    if (node.kind !== Kind.Binary) return node;
    if (node.operator !== 'and' && node.operator !== 'or') return node;
    const known = C.truthiness(node.lhs);
    if (known === null) return node;
    const keepsLeft = node.operator === 'and' ? !known : known;
    const dropped = keepsLeft ? node.rhs : node.lhs;
    if (!purity.isSelfContained(dropped, facts)) return node;
    counters.decided += 1;
    decided += 1;
    return keepsLeft ? node.lhs : node.rhs;
  });
  return decided;
}

function nodeSet(root) {
  const seen = new Set();
  walk(root, {
    enter(node) {
      seen.add(node);
      return undefined;
    },
  });
  return seen;
}

function readOnlyIn(binding, root) {
  const reads = binding.reads || [];
  if (!reads.length) return true;
  const inside = nodeSet(root);
  return reads.every((node) => inside.has(node));
}

function isDead(binding, definition) {
  if (!isLocalBinding(binding)) return false;
  const reads = binding.reads || [];
  if (!reads.length) return true;
  return definition ? readOnlyIn(binding, definition) : false;
}

function eliminate(chunk, facts, counters) {
  let removed = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      const out = [];
      for (const statement of node.statements) {
        if (statement.kind === Kind.LocalFunction) {
          if (isDead(statement.binding, statement)) {
            removed += 1;
            continue;
          }
        } else if (statement.kind === Kind.LocalDeclaration) {
          const bindings = statement.bindings || [];
          const names = statement.names || [];
          const expressions = statement.expressions || [];
          const aligned = expressions.length === names.length;
          const keep = [];
          for (let i = 0; i < names.length; i += 1) {
            const written = ((bindings[i] && bindings[i].writes) || []).length > 0;
            const dies = !written && isDead(bindings[i], aligned ? expressions[i] : null)
              && (!aligned || purity.isSelfContained(expressions[i], facts));
            if (dies) removed += 1;
            else keep.push(i);
          }
          if (!keep.length && (!expressions.length
            || expressions.every((e) => purity.isSelfContained(e, facts)))) {
            continue;
          }
          if (keep.length !== names.length && aligned) {
            statement.names = keep.map((i) => names[i]);
            statement.bindings = keep.map((i) => bindings[i]);
            statement.expressions = keep.map((i) => expressions[i]);
          } else if (keep.length !== names.length && !expressions.length) {
            statement.names = keep.map((i) => names[i]);
            statement.bindings = keep.map((i) => bindings[i]);
          }
        } else if (statement.kind === Kind.Assignment) {
          const targets = statement.targets || [];
          const expressions = statement.expressions || [];

          if (targets.length === 1 && expressions.length === 1
            && targets[0].kind === Kind.Name && expressions[0].kind === Kind.Name
            && targets[0].binding && targets[0].binding === expressions[0].binding) {
            removed += 1;
            continue;
          }
          const deadTarget = (target) => target.kind === Kind.Name
            && isDead(target.binding, null);
          if (targets.every(deadTarget)
            && expressions.every((e) => purity.isSelfContained(e, facts))) {
            removed += targets.length;
            continue;
          }

          const bare = expressions.length === 1 ? A.unparen(expressions[0]) : null;
          if (targets.every(deadTarget) && bare
            && (bare.kind === Kind.Call || bare.kind === Kind.MethodCall)) {
            removed += targets.length;
            out.push(A.callStatement(bare));
            continue;
          }
          if (targets.length === expressions.length && targets.some(deadTarget)
            && targets.some((t) => !deadTarget(t))) {
            const keep = [];
            for (let i = 0; i < targets.length; i += 1) {
              if (deadTarget(targets[i])
                && purity.isSelfContained(expressions[i], facts)) removed += 1;
              else keep.push(i);
            }
            statement.targets = keep.map((i) => targets[i]);
            statement.expressions = keep.map((i) => expressions[i]);
          }
        } else if (statement.kind === Kind.CallStatement) {
          if (purity.touchesOwn(statement.expression, facts)
            && purity.isSelfContained(statement.expression, facts)) {
            removed += 1;
            continue;
          }
        } else if (statement.kind === Kind.Do
          && !((statement.body && statement.body.statements) || []).length) {
          removed += 1;
          continue;
        }
        out.push(statement);
      }
      node.statements = out;
      return undefined;
    },
  });
  counters.eliminated += removed;
  return removed;
}

function mergeDecls(chunk, counters) {
  let merged = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      for (let i = 0; i + 1 < node.statements.length; i += 1) {
        const decl = node.statements[i];
        if (decl.kind !== Kind.LocalDeclaration || (decl.expressions || []).length) continue;
        const next = node.statements[i + 1];
        if (!next || next.kind !== Kind.Assignment) continue;
        const targets = next.targets || [];
        const expressions = next.expressions || [];
        if (!targets.length || targets.length !== expressions.length) continue;
        const owned = new Set(decl.bindings || []);
        if (!targets.every((t) => t.kind === Kind.Name && owned.has(t.binding))) continue;
        let touches = false;
        for (const expression of expressions) {
          walk(expression, {
            enter(child) {
              if (child.kind === Kind.Name && owned.has(child.binding)) touches = true;
              return undefined;
            },
          });
        }
        if (touches) continue;
        const taken = new Set(targets.map((t) => t.binding));
        const rest = [];
        const restBindings = [];
        (decl.bindings || []).forEach((binding, at) => {
          if (taken.has(binding)) return;
          rest.push(decl.names[at]);
          restBindings.push(binding);
        });
        const joined = A.localDecl(targets.map((t) => t.name), expressions);
        joined.bindings = targets.map((t) => t.binding);

        const replacement = rest.length
          ? [joined, Object.assign(decl, { names: rest, bindings: restBindings })]
          : [joined];
        node.statements.splice(i, 2, ...replacement);
        merged += 1;
        i -= 1;
      }
      return undefined;
    },
  });
  counters.merged += merged;
  return merged;
}

function dropParens(chunk, counters) {
  let dropped = 0;
  transform(chunk, (node) => {
    if (node.kind !== Kind.Paren) return node;
    const inner = node.expression;
    if (!inner) return node;

    if (A.isMultiValue(inner)) return node;
    if (inner.kind === Kind.Name || inner.kind === Kind.Paren || A.isLiteral(inner)
      || inner.kind === Kind.Table || inner.kind === Kind.Index) {
      dropped += 1;
      return inner;
    }
    return node;
  });
  counters.parens += dropped;
  return dropped;
}

function basePositions(chunk) {
  const bases = new Set();
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Index || node.kind === Kind.Call
        || node.kind === Kind.MethodCall) bases.add(node.base);
      return undefined;
    },
  });
  return bases;
}

function pushLiterals(chunk, counters) {
  const writes = new Map();
  walk(chunk, {
    enter(node) {
      const note = (binding, value, at, bare) => {
        if (!isLocalBinding(binding)) return;
        let seen = writes.get(binding);
        if (!seen) {
          seen = { count: 0, bare: 0, valued: 0, value: null, at: null };
          writes.set(binding, seen);
        }
        seen.count += 1;
        if (value) {
          seen.valued += 1;
          seen.value = value;
          seen.at = at;
        } else if (bare) seen.bare += 1;
      };
      if (node.kind === Kind.LocalDeclaration) {
        const expressions = node.expressions || [];
        const aligned = expressions.length === (node.names || []).length;
        (node.bindings || []).forEach((binding, at) => {
          note(binding, aligned ? expressions[at] : null, node, !expressions.length);
        });
      } else if (node.kind === Kind.Assignment) {
        const targets = node.targets || [];
        const expressions = node.expressions || [];
        const aligned = targets.length === expressions.length;
        targets.forEach((target, at) => {
          if (target.kind !== Kind.Name) return;
          note(target.binding, aligned ? expressions[at] : null, node, false);
        });
      } else if (node.kind === Kind.LocalFunction) note(node.binding, null, node, false);
      else if (node.kind === Kind.NumericFor) note(node.binding, null, node, false);
      else if (node.kind === Kind.GenericFor || node.kind === Kind.Function) {
        for (const binding of node.bindings || []) note(binding, null, node, false);
      }
      return undefined;
    },
  });

  const values = new Map();
  let positions = null;
  let bases = null;

  const copies = new Map();
  for (const [binding, info] of writes) {
    if (!info.value || info.valued !== 1 || info.bare !== info.count - 1) continue;
    const value = A.unparen(info.value);
    if (value.kind !== Kind.Name) continue;
    if (!isLocalBinding(value.binding) || value.binding === binding) continue;
    copies.set(value, binding);
  }

  const spelledAt = (binding, seen) => {
    const found = [];
    for (const read of binding.reads || []) {
      const into = copies.get(read);
      if (into && !seen.has(into)) {
        seen.add(into);
        found.push(...spelledAt(into, seen));
      } else found.push(read);
    }
    return found;
  };

  for (const [binding, info] of writes) {
    if (!info.value || info.valued !== 1) continue;
    if (!A.isLiteral(info.value) || info.value.kind === Kind.Vararg) continue;
    const reads = binding.reads || [];
    if (!reads.length) continue;
    if (info.count !== 1) {
      if (info.bare !== info.count - 1) continue;
      if (!positions) positions = new Positions(chunk);
      if (!reads.every((read) => positions.precedes(info.at, read))) continue;
    }
    const spelled = spelledAt(binding, new Set([binding]));
    if (spelled.length > 1) {
      if (!bases) bases = basePositions(chunk);
      if (spelled.some((read) => bases.has(read))) continue;
    }
    values.set(binding, info.value);
  }
  if (!values.size) return 0;

  const targets = new Set();
  for (const binding of values.keys()) {
    for (const write of binding.writes || []) targets.add(write);
  }

  let replaced = 0;
  transform(chunk, (node) => {
    if (node.kind !== Kind.Name || !node.binding || targets.has(node)) return node;
    const value = values.get(node.binding);
    if (!value) return node;
    replaced += 1;
    return { ...value };
  });
  counters.propagated += replaced;
  return replaced;
}

function resolveGlobals(chunk, counters) {
  const locals = new Set();
  walk(chunk, {
    enter(node) {
      if (isLocalBinding(node.binding)) locals.add(node.name);
      return undefined;
    },
  });
  let resolved = 0;
  transform(chunk, (node) => {
    if (node.kind !== Kind.Index) return node;
    const base = node.base;
    if (!isGlobalName(base) || base.name !== '_ENV') return node;
    const key = node.index;
    if (!key || key.kind !== Kind.String || !isIdentifier(key.value)) return node;
    if (locals.has(key.value)) return node;
    resolved += 1;
    return A.name(key.value);
  });
  counters.globals += resolved;
  return resolved;
}

function tidyLoops(chunk, counters) {
  let tidied = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.NumericFor && node.step
        && node.step.kind === Kind.Number && node.step.value === 1) {
        node.step = null;
        tidied += 1;
      }
      return undefined;
    },
  });
  counters.loops += tidied;
  return tidied;
}

function run(context) {
  const counters = {
    eliminated: 0, merged: 0, parens: 0, idioms: 0, propagated: 0, loops: 0, globals: 0,
    stores: 0, decided: 0, unwanted: 0,
  };
  for (let round = 0; round < 24; round += 1) {
    context.resolve();
    let changed = 0;
    changed += idioms.run(context, counters);
    context.resolve();
    changed += pushLiterals(context.chunk, counters);
    context.resolve();
    changed += resolveGlobals(context.chunk, counters);
    context.resolve();
    const facts = new purity.Facts(context.chunk);

    const decided = fold.foldTree(context.chunk, {
      binary: fold.BINARY,
      unary: fold.LOGIC,
    });
    counters.decided += decided;
    changed += decided;
    changed += decideLogic(context.chunk, facts, counters);
    context.resolve();
    const resolved = context.stats['guards.constants'] || 0;
    guards.run(context);
    changed += (context.stats['guards.constants'] || 0) - resolved;
    context.resolve();
    changed += eliminate(context.chunk, facts, counters);
    context.resolve();

    const stores = removeStores(
      context.chunk,
      new Writes(context.chunk, writesIn, readsIn),
      new purity.Facts(context.chunk),
    );
    counters.stores += stores;
    changed += stores;
    context.resolve();

    const restated = removeRedundant(context.chunk);
    counters.stores += restated;
    changed += restated;
    context.resolve();

    const unwanted = removeDead(context.chunk, new purity.Facts(context.chunk));
    counters.unwanted += unwanted;
    changed += unwanted;
    context.resolve();
    changed += mergeDecls(context.chunk, counters);
    changed += dropParens(context.chunk, counters);
    const before = context.stats['fold.count'] || 0;

    fold.run(context);
    changed += (context.stats['fold.count'] || 0) - before;
    if (!changed) break;
  }
  tidyLoops(context.chunk, counters);
  context.resolve();
  const total = Object.values(counters).reduce((a, b) => a + b, 0);
  if (total) {
    context.note(
      `removed ${counters.eliminated + counters.stores} dead write(s),`
      + ` ${counters.unwanted} unwanted statement(s),`
      + ` merged ${counters.merged} declaration(s),`
      + ` rebuilt ${counters.idioms} idiom(s)`,
      total,
    );
  }
  for (const key of Object.keys(counters)) {
    if (counters[key]) context.bump(`simplify.${key}`, counters[key]);
  }
}

module.exports = {
  name: '07-opt',
  run,
  eliminate,
  mergeDecls,
  dropParens,
};

};

__modules["src/steps/08-vars.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { walk } = require("src/lua/walk.js");
const { isIdentifier } = require("src/lua/format.js");
const { isGlobalName } = require("src/lua/scope.js");

const COUNTERS = ['i', 'j', 'k', 'm', 'n'];

function reserved(chunk) {
  const taken = new Set([
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if',
    'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
    'self', '_ENV',
  ]);
  walk(chunk, {
    enter(node) {
      if (isGlobalName(node)) taken.add(node.name);
      return undefined;
    },
  });
  return taken;
}

function namer(taken) {
  const counts = { p: 0, f: 0, v: 0, i: 0 };
  const next = (category) => {
    for (let guard = 0; guard < 100000; guard += 1) {
      counts[category] += 1;
      const n = counts[category];
      const candidate = category === 'i' && n <= COUNTERS.length
        ? COUNTERS[n - 1]
        : `${category}${n}`;
      if (!taken.has(candidate) && isIdentifier(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    throw new Error('rename: name pool exhausted');
  };
  return next;
}

function holdsFunctions(chunk) {
  const tally = new Map();
  const count = (target, value) => {
    if (!target || target.kind !== Kind.Name || !target.binding) return;
    const seen = tally.get(target.binding) || { functions: 0, other: 0 };
    if (value && value.kind === Kind.Function) seen.functions += 1;
    else seen.other += 1;
    tally.set(target.binding, seen);
  };
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.FunctionDeclaration) count(node.target, node.body);
      else if (node.kind === Kind.Assignment) {
        const values = node.expressions || [];
        const targets = node.targets || [];
        const aligned = values.length === targets.length;
        targets.forEach((target, at) => count(target, aligned ? values[at] : null));
      }
      return undefined;
    },
  });
  const named = new Set();
  for (const [binding, seen] of tally) {
    if (seen.functions && !seen.other) named.add(binding);
  }
  return named;
}

function categories(chunk) {
  const found = new Map();
  const stored = holdsFunctions(chunk);
  const assign = (binding, category) => {
    if (!binding || found.has(binding)) return;
    found.set(binding, category);
  };
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Function) {
        (node.bindings || []).forEach((binding, at) => {
          if ((node.params || [])[at] === 'self') return;
          assign(binding, 'p');
        });
      } else if (node.kind === Kind.LocalFunction) {
        assign(node.binding, 'f');
      } else if (node.kind === Kind.NumericFor) {
        assign(node.binding, 'i');
      } else if (node.kind === Kind.GenericFor) {
        (node.bindings || []).forEach((binding) => assign(binding, 'v'));
      } else if (node.kind === Kind.LocalDeclaration) {
        const expressions = node.expressions || [];
        const aligned = expressions.length === (node.names || []).length;
        (node.bindings || []).forEach((binding, at) => {
          const value = aligned ? expressions[at] : null;
          const holds = (value && value.kind === Kind.Function) || stored.has(binding);
          assign(binding, holds ? 'f' : 'v');
        });
      }
      return undefined;
    },
  });
  return found;
}

function plan(chunk, next) {
  const names = new Map();
  for (const [binding, category] of categories(chunk)) names.set(binding, next(category));
  return names;
}

function apply(chunk, names) {
  let renamed = 0;
  const rewrite = (list, bindings) => {
    if (!list || !bindings) return;
    for (let i = 0; i < bindings.length && i < list.length; i += 1) {
      const chosen = names.get(bindings[i]);
      if (chosen) list[i] = chosen;
    }
  };
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Function) rewrite(node.params, node.bindings);
      else if (node.kind === Kind.LocalDeclaration) rewrite(node.names, node.bindings);
      else if (node.kind === Kind.GenericFor) rewrite(node.variables, node.bindings);
      else if (node.kind === Kind.LocalFunction) {
        const chosen = names.get(node.binding);
        if (chosen) node.name = chosen;
      } else if (node.kind === Kind.NumericFor) {
        const chosen = names.get(node.binding);
        if (chosen) node.variable = chosen;
      } else if (node.kind === Kind.Name && node.binding) {
        const chosen = names.get(node.binding);
        if (chosen && node.name !== chosen) {
          node.name = chosen;
          renamed += 1;
        }
      }
      return undefined;
    },
  });
  return renamed;
}

function run(context) {
  context.resolve();
  const taken = reserved(context.chunk);
  const names = plan(context.chunk, namer(taken));
  if (!names.size) return;
  const renamed = apply(context.chunk, names);
  context.resolve();
  context.note(`renamed ${names.size} local(s)`, names.size);
  context.bump('rename.bindings', names.size);
  context.bump('rename.mentions', renamed);
}

module.exports = {
  name: '08-vars',
  run,
  reserved,
  namer,
  categories,
  plan,
  apply,
};

};

__modules["src/steps/09-fmt.js"] = function(module, exports, require) {
'use strict';

const purity = require("src/util/purity.js");
const { removeDead } = require("src/util/dead-code.js");
const idioms = require("src/vm/idioms.js");
const simplify = require("src/steps/07-opt.js");
const copies = require("src/beautify/copies.js");
const hoist = require("src/beautify/hoist.js");
const tuples = require("src/beautify/tuples.js");
const declare = require("src/beautify/declare.js");
const services = require("src/beautify/services.js");
const shapes = require("src/beautify/shapes.js");
const jumps = require("src/beautify/jumps.js");
const loops = require("src/beautify/loops.js");
const callbacks = require("src/beautify/callbacks.js");

const ROUNDS = 8;

const PASSES = [
  ['named', (chunk) => hoist.nameCalled(chunk)],
  ['tuples', (chunk) => tuples.nameResults(chunk)],
  ['services', (chunk) => services.gather(chunk)],
  ['copies', (chunk) => copies.propagate(chunk)],
  ['temporaries', (chunk) => copies.inlineTemps(chunk)],
  ['declarations', (chunk) => declare.sink(chunk)],
  ['filled', (chunk) => declare.fill(chunk)],
  ['pushed', (chunk) => declare.pushIn(chunk)],
  ['moved', (chunk) => declare.slide(chunk)],
  ['husks', (chunk) => declare.dropEmpty(chunk)],
  ['functions', (chunk) => declare.localForm(chunk)],
  ['recursions', (chunk) => declare.recursiveForm(chunk)],
  ['assigned', (chunk) => declare.assignedForm(chunk)],
  ['methods', (chunk) => declare.methodForm(chunk)],
  ['callbacks', (chunk) => callbacks.inlineClosures(chunk)],
  ['iterators', (chunk) => loops.foldIterators(chunk)],
  ['tests', (chunk) => loops.raiseTest(chunk)],
  ['jumps', (chunk) => jumps.clean(chunk)],
  ['tails', (chunk) => jumps.pull(chunk)],
  ['returns', (chunk) => shapes.dropReturns(chunk)],
  ['otherwise', (chunk) => shapes.dropElse(chunk)],
  ['guards', (chunk) => shapes.liftElse(chunk)],
  ['branches', (chunk) => shapes.collapseElseIf(chunk)],
  ['parens', (chunk) => shapes.dropParens(chunk)],
  ['blocks', (chunk) => shapes.flatten(chunk)],
];

function tidy(context, counters) {
  let changed = 0;
  changed += idioms.run(context, counters);
  context.resolve();
  changed += simplify.eliminate(context.chunk, new purity.Facts(context.chunk), counters);
  context.resolve();
  const unwanted = removeDead(context.chunk, new purity.Facts(context.chunk));
  counters.unwanted += unwanted;
  changed += unwanted;
  context.resolve();
  changed += simplify.mergeDecls(context.chunk, counters);
  context.resolve();
  return changed;
}

function run(context) {
  const counters = { eliminated: 0, merged: 0, idioms: 0, unwanted: 0 };
  for (const [name] of PASSES) counters[name] = 0;
  context.resolve();
  for (let round = 0; round < ROUNDS; round += 1) {
    let changed = 0;
    for (const [name, pass] of PASSES) {
      const moved = pass(context.chunk);
      if (!moved) continue;
      counters[name] += moved;
      changed += moved;
      context.resolve();
    }
    changed += tidy(context, counters);
    if (!changed) break;
  }
  const moves = PASSES.reduce((total, [name]) => total + counters[name], 0);
  if (moves) {
    context.note(
      `put back ${counters.copies + counters.temporaries} value(s),`
      + ` ${counters.declarations + counters.filled} declaration(s),`
      + ` ${counters.named + counters.functions + counters.assigned + counters.methods} function form(s)`,
      moves,
    );
  }
  for (const key of Object.keys(counters)) {
    if (counters[key]) context.bump(`beautify.${key}`, counters[key]);
  }
}

module.exports = { name: '09-fmt', run, PASSES };

};

__modules["src/steps/10-name.js"] = function(module, exports, require) {
'use strict';

const rename = require("src/steps/08-vars.js");
const names = require("src/beautify/names.js");

function plan(chunk, hints, taken) {
  const globals = new Set(taken);
  const next = rename.namer(taken);
  const word = names.allocator(taken);
  const chosen = new Map();
  let described = 0;
  for (const [binding, category] of rename.categories(chunk)) {
    const hint = hints.get(binding);
    if (hint && !globals.has(hint)) {
      chosen.set(binding, word(hint));
      described += 1;
    } else chosen.set(binding, next(category));
  }
  return { chosen, described };
}

function run(context) {
  context.resolve();
  const hints = names.suggest(context.chunk);
  const taken = rename.reserved(context.chunk);
  const { chosen, described } = plan(context.chunk, hints, taken);
  if (!chosen.size) return;
  const renamed = rename.apply(context.chunk, chosen);
  context.resolve();
  context.note(`named ${described} local(s) from the code`, described);
  context.bump('name.described', described);
  context.bump('name.bindings', chosen.size);
  context.bump('name.mentions', renamed);
}

module.exports = {
  name: '10-name',
  run,
  plan,
};

};

__modules["src/steps/11-scope.js"] = function(module, exports, require) {
'use strict';

const scopes = require("src/beautify/scopes.js");

function run(context) {
  context.resolve();
  const wrapped = scopes.fit(context.chunk, () => context.resolve());
  if (wrapped) {
    context.note(`narrowed ${wrapped} scope(s) to fit the local limit`, wrapped);
    context.bump('scope.narrowed', wrapped);
  }
}

module.exports = {
  name: '11-scope',
  run,
};

};

__modules["src/util/const.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const A = require("src/lua/ast.js");
const ops = require("src/interp/ops.js");
const V = require("src/interp/values.js");

const RT = {
  metamethod: () => undefined,
  call() {
    throw new Error('pure eval: calls not allowed');
  },
  addressOf: () => '0',
};

const NONE = Symbol('none');

function literalValue(node) {
  if (!node) return NONE;
  switch (node.kind) {
    case Kind.Nil: return undefined;
    case Kind.True: return true;
    case Kind.False: return false;
    case Kind.Number: return node.value;
    case Kind.String: return node.value;
    case Kind.Paren: return literalValue(node.expression);
    default: return NONE;
  }
}

const isConstant = (node) => literalValue(node) !== NONE;

function truthiness(node) {
  if (!node) return null;
  if (node.kind === Kind.Paren) return truthiness(node.expression);
  if (node.kind === Kind.Table || node.kind === Kind.Function) return true;
  const value = literalValue(node);
  if (value === NONE) return null;
  return value !== undefined && value !== false;
}

function literalNode(value) {
  if (value === undefined || value === null) return A.nil();
  if (value === true) return A.boolean(true);
  if (value === false) return A.boolean(false);
  if (typeof value === 'number') return A.number(value);
  if (typeof value === 'string') return A.string(value);
  return null;
}

function foldBinary(operator, lhsNode, rhsNode) {
  const a = literalValue(lhsNode);
  const b = literalValue(rhsNode);
  if (a === NONE || b === NONE) return null;
  try {
    switch (operator) {
      case 'and': return literalNode(V.truthy(a) ? b : a);
      case 'or': return literalNode(V.truthy(a) ? a : b);
      case '..': {
        if (typeof a !== 'string' && typeof a !== 'number') return null;
        if (typeof b !== 'string' && typeof b !== 'number') return null;
        return literalNode(ops.concat(RT, a, b));
      }
      case '==': return literalNode(ops.equals(RT, a, b));
      case '~=': return literalNode(!ops.equals(RT, a, b));
      case '<': return literalNode(ops.lessThan(RT, a, b));
      case '>': return literalNode(ops.lessThan(RT, b, a));
      case '<=': return literalNode(ops.lessOrEqual(RT, a, b));
      case '>=': return literalNode(ops.lessOrEqual(RT, b, a));
      default: {
        if (typeof a === 'boolean' || typeof b === 'boolean') return null;
        if (a === undefined || b === undefined) return null;
        return literalNode(ops.arith(RT, operator, a, b));
      }
    }
  } catch (error) {
    return null;
  }
}

function foldUnary(operator, argumentNode) {
  const a = literalValue(argumentNode);
  if (a === NONE) return null;
  try {
    switch (operator) {
      case '-': return typeof a === 'boolean' || a === undefined ? null
        : literalNode(ops.unaryMinus(RT, a));
      case 'not': return literalNode(!V.truthy(a));

      case '#': return null;
      default: return null;
    }
  } catch (error) {
    return null;
  }
}

module.exports = {
  literalNode,
  isConstant,
  truthiness,
  foldBinary,
  foldUnary,
};

};

__modules["src/util/dead-code.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { children } = require("src/lua/walk.js");
const purity = require("src/util/purity.js");
const { throughBindings } = purity;
const { isLocalBinding } = require("src/lua/scope.js");

function ownedBlocks(statement) {
  const blocks = [];
  const add = (block, role) => { if (block) blocks.push({ block, role }); };
  switch (statement.kind) {
    case Kind.Do:
      add(statement.body, 'plain');
      break;
    case Kind.While: case Kind.NumericFor: case Kind.GenericFor:
      add(statement.body, 'loop');
      break;
    case Kind.Repeat:
      add(statement.body, 'loop');
      break;
    case Kind.If:
      add(statement.body, 'plain');
      for (const clause of statement.elseIfs || []) add(clause.body, 'plain');
      add(statement.elseBody, 'plain');
      break;
    case Kind.LocalFunction: case Kind.FunctionDeclaration:
      add(statement.body && statement.body.body, 'function');
      break;
    default:
      break;
  }
  return blocks;
}

class Shape {
  constructor(root, facts = null) {
    this.facts = facts;
    this.holder = new Map();
    this.owner = new Map();
    this.role = new Map();
    this.stmtOf = new Map();
    this.declarer = new Map();
    this.mutations = new Map();
    this.reads = new Set();
    this.blocks = [];
    const body = root.kind === Kind.Chunk ? root.body : root;
    this.enter(body, 'chunk');
    this.indexReads();
  }

  indexReads() {
    const seen = new Set();
    for (const node of this.stmtOf.keys()) {
      if (node.kind !== Kind.Name || !node.binding || seen.has(node.binding)) continue;
      seen.add(node.binding);
      for (const read of node.binding.reads || []) this.reads.add(read);
    }
  }

  enter(block, role) {
    if (!block || !block.statements) return;
    this.blocks.push(block);
    this.role.set(block, role);
    for (const statement of block.statements) {
      this.holder.set(statement, block);
      this.declare(statement);
      this.charge(statement);
      this.claim(statement, statement);
    }
  }

  charge(statement) {
    const blame = (binding) => {
      if (!this.mutations.has(binding)) this.mutations.set(binding, []);
      this.mutations.get(binding).push(statement);
    };
    const note = (node) => {
      for (const binding of throughBindings(node, this.facts)) blame(binding);
    };
    for (const target of statement.targets || []) {
      if (target && target.kind !== Kind.Name) note(target);
    }
    for (const node of this.own(statement)) {
      if (node.kind !== Kind.Call && node.kind !== Kind.MethodCall) continue;

      if (node.kind === Kind.MethodCall || (node.base && node.base.kind !== Kind.Name)) {
        note(node.base);
      }
      for (const argument of node.args || []) note(argument);
      if (!this.facts) continue;
      const cells = purity.writesOutside(node, this.facts);
      if (cells) for (const binding of cells) blame(binding);
    }
  }

  declare(statement) {
    const note = (binding) => { if (binding) this.declarer.set(binding, statement); };
    if (statement.kind === Kind.LocalDeclaration) (statement.bindings || []).forEach(note);
    else if (statement.kind === Kind.LocalFunction) note(statement.binding);
    else if (statement.kind === Kind.NumericFor) note(statement.binding);
    else if (statement.kind === Kind.GenericFor) (statement.bindings || []).forEach(note);
  }

  claim(node, statement) {
    this.stmtOf.set(node, statement);
    for (const child of children(node)) {
      const inner = child.node;
      if (!inner || !inner.kind) continue;
      if (inner.kind === Kind.Block) {
        this.owner.set(inner, statement);
        const role = child.parent && child.parent.kind === Kind.Function ? 'function'
          : (ownedBlocks(statement).find((entry) => entry.block === inner) || {}).role || 'plain';
        this.enter(inner, role);
      } else {
        if (inner.kind === Kind.Function) {
          for (const binding of inner.bindings || []) this.declarer.set(binding, statement);
        }
        this.claim(inner, statement);
      }
    }
  }

  * own(statement) {
    const stack = [statement];
    while (stack.length) {
      const node = stack.pop();
      yield node;
      for (const child of children(node)) {
        if (child.node && child.node.kind && child.node.kind !== Kind.Block) {
          stack.push(child.node);
        }
      }
    }
  }
}

function ownExpressions(statement) {
  switch (statement.kind) {
    case Kind.LocalDeclaration: case Kind.Return: case Kind.GenericFor:
      return statement.expressions || [];
    case Kind.Assignment:
      return statement.expressions || [];
    case Kind.CallStatement:
      return [statement.expression];
    case Kind.While: case Kind.Repeat:
      return [statement.condition];
    case Kind.NumericFor:
      return [statement.start, statement.limit, statement.step];
    case Kind.If:
      return [statement.condition, ...(statement.elseIfs || []).map((c) => c.condition)];
    default:
      return [];
  }
}

function endsFunction(shape, statement) {
  let node = statement;
  for (let guard = 0; guard < 1000; guard += 1) {
    const block = shape.holder.get(node);
    if (!block) return false;
    const statements = block.statements || [];
    if (statements[statements.length - 1] !== node) return false;
    const role = shape.role.get(block);
    if (role === 'function') return true;
    if (role !== 'plain') return false;
    const owner = shape.owner.get(block);
    if (!owner || owner === node) return false;
    node = owner;
  }
  return false;
}

function tailReturns(shape, body) {
  const found = [];
  const visit = (block) => {
    const statements = (block && block.statements) || [];
    const last = statements[statements.length - 1];
    if (!last) return;
    if (last.kind === Kind.Return) {
      found.push(last);
      return;
    }
    if (last.kind !== Kind.If && last.kind !== Kind.Do) return;
    for (const entry of ownedBlocks(last)) visit(entry.block);
  };
  visit(body);
  return found;
}

function seeds(shape, facts) {
  const found = [];
  for (const block of shape.blocks) {
    block.statements.forEach((statement) => {
      switch (statement.kind) {
        case Kind.Goto: case Kind.Label: case Kind.FunctionDeclaration:
          found.push(statement);
          return;
        case Kind.Return:
          if (!endsFunction(shape, statement)) {
            found.push(statement);
            return;
          }
          break;
        case Kind.Break: case Kind.Continue:
          return;
        default:
          break;
      }
      if (statement.kind === Kind.Assignment) {
        if ((statement.targets || []).some((target) => !purity.targetWrites(target, facts))) {
          found.push(statement);
          return;
        }
      }
      for (const expression of ownExpressions(statement)) {
        if (expression && !purity.writesOutside(expression, facts)) {
          found.push(statement);
          return;
        }
      }

      for (const target of statement.targets || []) {
        if (target && target.kind === Kind.Index
          && !purity.isRemovable(target, facts)) found.push(statement);
      }
    });
  }
  return found;
}

function readsOf(shape, statement) {
  const bindings = new Set();
  for (const node of shape.own(statement)) {
    if (node.kind !== Kind.Name || !node.binding) continue;
    if (!isLocalBinding(node.binding)) continue;
    if (!shape.reads.has(node)) continue;
    bindings.add(node.binding);
  }
  return bindings;
}

function removeDead(root, facts) {
  const shape = new Shape(root, facts);
  const live = new Set();
  const needed = new Set();
  const queue = [];

  const mark = (statement) => {
    if (!statement || live.has(statement)) return;
    live.add(statement);
    queue.push(statement);
  };
  const want = (binding) => {
    if (!binding || needed.has(binding) || !isLocalBinding(binding)) return;
    needed.add(binding);
    for (const write of binding.writes || []) mark(shape.stmtOf.get(write));
    for (const statement of shape.mutations.get(binding) || []) mark(statement);
    mark(shape.declarer.get(binding));
  };

  const keepJumps = (block) => {
    for (const statement of block.statements) {
      if (statement.kind === Kind.Break || statement.kind === Kind.Continue) mark(statement);
      if (statement.kind === Kind.If || statement.kind === Kind.Do) {
        for (const entry of ownedBlocks(statement)) keepJumps(entry.block);
      }
    }
  };

  for (const statement of seeds(shape, facts)) mark(statement);

  while (queue.length) {
    const statement = queue.pop();
    for (const binding of readsOf(shape, statement)) want(binding);

    let block = shape.holder.get(statement);
    while (block) {
      const owner = shape.owner.get(block);
      if (!owner) break;
      mark(owner);
      block = shape.holder.get(owner);
    }
    for (const entry of ownedBlocks(statement)) {
      if (entry.role === 'loop') keepJumps(entry.block);
    }

    for (const node of shape.own(statement)) {
      if (node.kind !== Kind.Function) continue;
      const body = node.body;
      if (!body || !body.statements.length) continue;
      for (const tail of tailReturns(shape, body)) mark(tail);
    }
  }

  let removed = 0;
  for (const block of shape.blocks) {
    const before = block.statements.length;
    block.statements = block.statements.filter((statement) => live.has(statement));
    removed += before - block.statements.length;
  }
  return removed;
}

module.exports = { removeDead, seeds };

};

__modules["src/util/dead-stores.js"] = function(module, exports, require) {
'use strict';

const A = require("src/lua/ast.js");
const { Kind } = A;
const { walk } = require("src/lua/walk.js");
const { hasEscape } = require("src/util/flow.js");
const { readsIn, writesIn } = require("src/util/eval.js");
const purity = require("src/util/purity.js");
const { isLocalBinding } = require("src/lua/scope.js");

function readsThrough(statement, summary) {
  const direct = readsIn(statement);
  const total = new Set(direct);
  for (const binding of direct) {
    for (const fn of summary.carriersOf(binding)) {
      for (const one of summary.allReadsOf(fn)) total.add(one);
    }
  }
  return total;
}

function hasOpaqueCall(statement, summary) {
  let opaque = false;
  walk(statement, {
    enter(node) {
      if (opaque) return false;
      if (node.kind === Kind.MethodCall) { opaque = true; return false; }
      if (node.kind !== Kind.Call) return undefined;
      let callee = node.base;
      while (callee && callee.kind === Kind.Paren) callee = callee.expression;
      if (!callee || callee.kind !== Kind.Name) { opaque = true; return false; }
      const binding = callee.binding;
      if (!binding) { opaque = true; return false; }
      if (summary.carriersOf(binding).size) return undefined;
      const assigned = (binding.writes || []).length > 0;
      if (isLocalBinding(binding) || assigned) opaque = true;
      return undefined;
    },
  });
  return opaque;
}

function killedBy(statement) {
  const killed = new Set();
  if (statement.kind !== Kind.Assignment) return killed;
  for (const target of statement.targets || []) {
    let node = target;
    while (node && node.kind === Kind.Paren) node = node.expression;
    if (node && node.kind === Kind.Name && node.binding) killed.add(node.binding);
  }
  return killed;
}

function survey(block, summary) {
  const reads = [];
  const kills = [];
  const walls = [];
  for (const statement of block.statements) {
    reads.push(readsThrough(statement, summary));
    kills.push(killedBy(statement));
    walls.push(hasEscape(statement) || hasOpaqueCall(statement, summary));
  }
  return { reads, kills, walls };
}

function isDeadStore(binding, at, info) {
  if (!isLocalBinding(binding)) return false;
  for (let j = at + 1; j < info.reads.length; j += 1) {
    if (info.reads[j].has(binding)) return false;
    if (info.walls[j]) return false;
    if (info.kills[j].has(binding)) return true;
  }
  return false;
}

function targetBinding(target) {
  let node = target;
  while (node && node.kind === Kind.Paren) node = node.expression;
  if (!node || node.kind !== Kind.Name) return null;
  return node.binding || null;
}

function rewrite(statement, dead, facts) {
  const targets = statement.targets || [];
  const expressions = statement.expressions || [];
  const aligned = targets.length === expressions.length;
  if (dead.every((value) => value)) {
    if (expressions.every((expression) => purity.isSelfContained(expression, facts))) {
      return { statements: [], removed: targets.length };
    }
    if (expressions.length === 1
      && (expressions[0].kind === Kind.Call || expressions[0].kind === Kind.MethodCall)) {
      return { statements: [A.callStatement(expressions[0])], removed: targets.length };
    }
    return null;
  }
  if (!aligned) return null;
  const keep = [];
  let removed = 0;
  for (let i = 0; i < targets.length; i += 1) {
    if (dead[i] && purity.isSelfContained(expressions[i], facts)) removed += 1;
    else keep.push(i);
  }
  if (!removed) return null;
  statement.targets = keep.map((i) => targets[i]);
  statement.expressions = keep.map((i) => expressions[i]);
  return { statements: [statement], removed };
}

function hasLabel(block) {
  return block.statements.some((statement) => statement.kind === Kind.Label);
}

function removeStores(root, summary, facts) {
  let removed = 0;
  walk(root, {
    enter(node) {
      if (node.kind !== Kind.Block || hasLabel(node)) return undefined;
      const info = survey(node, summary);
      const out = [];
      for (let i = 0; i < node.statements.length; i += 1) {
        const statement = node.statements[i];
        if (statement.kind !== Kind.Assignment) { out.push(statement); continue; }
        const dead = (statement.targets || []).map((target) => {
          const binding = targetBinding(target);
          return !!binding && isDeadStore(binding, i, info);
        });
        if (!dead.some((value) => value)) { out.push(statement); continue; }
        const result = rewrite(statement, dead, facts);
        if (!result) { out.push(statement); continue; }
        removed += result.removed;
        out.push(...result.statements);
      }
      node.statements = out;
      return undefined;
    },
  });
  return removed;
}

function bareBindings(statement) {
  if (!statement || statement.kind !== Kind.LocalDeclaration) return [];

  if ((statement.expressions || []).length) return [];
  return (statement.bindings || []).filter(Boolean);
}

function stillNil(block, binding, at) {
  const statements = block.statements || [];
  for (let i = 0; i < at; i += 1) {
    if (!bareBindings(statements[i]).includes(binding)) continue;
    for (let j = i + 1; j < at; j += 1) {
      if (writesIn(statements[j], true).has(binding)) return false;
    }
    return true;
  }
  return false;
}

function removeRedundant(root) {
  let removed = 0;
  walk(root, {
    enter(node) {
      if (node.kind !== Kind.Block || hasLabel(node)) return undefined;
      const out = [];
      node.statements.forEach((statement, at) => {
        const targets = statement.kind === Kind.Assignment ? statement.targets || [] : [];
        const expressions = statement.expressions || [];
        if (!targets.length || targets.length !== expressions.length) {
          out.push(statement);
          return;
        }
        const seen = new Set();
        const keep = [];
        for (let i = 0; i < targets.length; i += 1) {
          const binding = targetBinding(targets[i]);
          const redundant = binding && isLocalBinding(binding) && !seen.has(binding)
            && expressions[i].kind === Kind.Nil && stillNil(node, binding, at);
          if (binding) seen.add(binding);
          if (redundant) removed += 1;
          else keep.push(i);
        }
        if (keep.length === targets.length) {
          out.push(statement);
          return;
        }
        if (!keep.length) return;
        statement.targets = keep.map((i) => targets[i]);
        statement.expressions = keep.map((i) => expressions[i]);
        out.push(statement);
      });
      node.statements = out;
      return undefined;
    },
  });
  return removed;
}

function neverRead(target) {
  if (!target || target.kind !== Kind.Name || !target.binding) return false;
  if (!isLocalBinding(target.binding)) return false;
  return !((target.binding.reads || []).length);
}

function discharge(chunk) {
  let changed = 0;
  walk(chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      node.statements = node.statements.map((statement) => {
        if (statement.kind !== Kind.Assignment) return statement;
        const targets = statement.targets || [];
        const expressions = statement.expressions || [];
        if (!targets.length || expressions.length !== 1) return statement;
        if (!targets.every(neverRead)) return statement;
        const value = A.unparen(expressions[0]);
        if (value.kind !== Kind.Call && value.kind !== Kind.MethodCall) return statement;
        changed += 1;
        return A.callStatement(value);
      });
      return undefined;
    },
  });
  return changed;
}

module.exports = { removeStores, removeRedundant, discharge };

};

__modules["src/util/eval.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { walk, children } = require("src/lua/walk.js");
const { Interpreter } = require("src/interp/interpreter.js");
const V = require("src/interp/values.js");
const ops = require("src/interp/ops.js");
const effects = require("src/interp/effects.js");
const C = require("src/util/const.js");
const { Writes, declaredIn } = require("src/util/writes.js");
const { Positions } = require("src/util/order.js");
const { isLocalBinding } = require("src/lua/scope.js");
const { soleValues, soleValueOf, copyRoots } = require("src/util/flow.js");

const GLOBALS = new Set([
  'string', 'table', 'math', 'bit', 'bit32', 'utf8',
  'type', 'tostring', 'tonumber', 'select', 'unpack', 'ipairs', 'pairs', 'next',
  'rawget', 'rawset', 'rawequal', 'rawlen', 'setmetatable', 'getmetatable',
  'assert', 'pcall', '_VERSION', '_ENV',
]);

function pureEnv(rt) {
  const env = new V.LuaTable();
  for (const name of GLOBALS) {
    const value = rt.globals.get(name);
    if (value !== undefined) env.set(name, value);
  }
  const meta = new V.LuaTable();
  meta.set('__index', (_, args) => {
    const missing = new V.LuaError(`unknown global '${String(args[1])}'`);
    missing.sandbox = true;
    throw missing;
  });
  env.metatable = meta;
  return env;
}

const isScalar = (value) => value === undefined || typeof value === 'boolean'
  || typeof value === 'number' || typeof value === 'string';

const PRIME_LIMIT = 20000;

function writesIn(root, intoFunctions, copies) {
  const written = new Set();
  const noteTarget = (target) => {
    let node = target;
    while (node && node.kind === Kind.Paren) node = node.expression;
    if (!node) return;
    if (node.kind === Kind.Name) {
      if (node.binding) written.add(node.binding);
      return;
    }
    let base = node;
    while (base && (base.kind === Kind.Index || base.kind === Kind.Paren)) {
      base = base.base || base.expression;
    }
    if (!base || base.kind !== Kind.Name || !base.binding) return;
    written.add(base.binding);
    const origin = copies ? copies.get(base.binding) : undefined;
    if (origin) written.add(origin);
  };
  walk(root, {
    enter: (node) => {
      if (node !== root && node.kind === Kind.Function && !intoFunctions) return false;
      if (node.kind === Kind.Assignment) (node.targets || []).forEach(noteTarget);
      else if (node.kind === Kind.LocalDeclaration || node.kind === Kind.GenericFor
        || node.kind === Kind.Function) {
        for (const binding of node.bindings || []) if (binding) written.add(binding);
      } else if (node.kind === Kind.LocalFunction || node.kind === Kind.NumericFor) {
        if (node.binding) written.add(node.binding);
      }
      return undefined;
    },
  });
  return written;
}

function readsIn(root, intoFunctions = true) {
  const read = new Set();
  const written = new Set();
  const note = (binding, isWrite) => {
    if (!binding || read.has(binding) || written.has(binding)) return;
    if (isWrite) written.add(binding);
    else read.add(binding);
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    switch (node.kind) {
      case Kind.Name:
        note(node.binding, false);
        return;
      case Kind.Assignment:
        (node.expressions || []).forEach(visit);
        for (const slot of node.targets || []) {
          let inner = slot;
          while (inner && inner.kind === Kind.Paren) inner = inner.expression;
          if (!inner) continue;
          if (inner.kind === Kind.Name) note(inner.binding, true);
          else visit(inner);
        }
        return;
      case Kind.LocalDeclaration:
        (node.expressions || []).forEach(visit);
        for (const binding of node.bindings || []) note(binding, true);
        return;
      case Kind.NumericFor:
        visit(node.start);
        visit(node.limit);
        visit(node.step);
        note(node.binding, true);
        visit(node.body);
        return;
      case Kind.GenericFor:
        (node.expressions || []).forEach(visit);
        for (const binding of node.bindings || []) note(binding, true);
        visit(node.body);
        return;
      case Kind.Function:
        if (node !== root && !intoFunctions) return;
        for (const binding of node.bindings || []) note(binding, true);
        visit(node.body);
        return;
      case Kind.LocalFunction:
        note(node.binding, true);
        break;
      default:
        break;
    }
    for (const child of children(node)) visit(child.node);
  };
  visit(root);
  return read;
}

class Evaluator {
  constructor(chunk, options = {}) {
    this.chunk = chunk;
    this.options = options;
    this.rt = new Interpreter({ stepLimit: options.stepLimit || 40e6 });
    this.scope = this.rt.rootScope();
    this.values = new Map();
    this.declared = new Set();
    this.declarations = [];
    this.failures = [];
    this.preludeStatements = new Set();
    this.mutated = new Map();
    this.skipped = [];
    this.unfoldable = new Set();
    this.cells = new Map();
    this.tainted = new Set();
    this.lastWrite = new Map();
    this.point = 0;
    this.pointWrites = null;
    this.dirty = null;
    this.depth = 0;
    this.live = false;
    this.copying = false;
    this.impure = new Set();
    this.caches = new Set();
    this.positions = null;
    this.holders = null;
    this.parents = null;

    this.soleValues = soleValues(chunk);

    this.copies = copyRoots(this.soleValues);
    this.reading = new Set();

    this.summary = new Writes(
      chunk,
      (root, intoFunctions) => writesIn(root, intoFunctions, this.copies),
      readsIn,
    );
    const table = this.rt.globals.get('table');
    if (table) {
      for (const name of ['insert', 'remove', 'sort']) {
        const fn = table.get(name);
        if (fn) this.impure.add(fn);
      }
    }
    for (const name of ['rawset', 'setmetatable', 'collectgarbage']) {
      const fn = this.rt.globals.get(name);
      if (fn) this.impure.add(fn);
    }
    this.rt.globals.set('_ENV', pureEnv(this.rt));
  }

  usesChunkVararg(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.kind === Kind.Vararg) return true;
    if (node.kind === Kind.Function) return false;
    for (const child of children(node)) {
      if (this.usesChunkVararg(child.node)) return true;
    }
    return false;
  }

  isDeterministic(statement) {
    if (this.usesChunkVararg(statement)) return false;

    const declaredHere = declaredIn(statement);
    let deterministic = true;
    walk(statement, {
      enter: (node) => {
        if (!deterministic) return false;
        if (node.kind !== Kind.Name) return undefined;
        const binding = node.binding;
        if (!binding) {
          deterministic = false;
          return false;
        }
        if (binding.kind === 'global') {
          if (!GLOBALS.has(binding.name)) deterministic = false;
          return undefined;
        }

        if (this.declared.has(binding)) return undefined;
        if (declaredHere.has(binding)) return undefined;
        deterministic = false;
        return false;
      },
    });
    return deterministic;
  }

  declaresFrom(statement) {
    if (statement.kind === Kind.LocalDeclaration && statement.bindings) {
      for (let i = 0; i < statement.bindings.length; i += 1) {
        this.note(statement.bindings[i], statement.names[i]);
      }
    } else if (statement.kind === Kind.LocalFunction && statement.binding) {
      this.note(statement.binding, statement.name);
    }
  }

  note(binding, name) {
    if (!binding) return;
    this.declarations.push({ binding, name });
    this.declared.add(binding);
    const cell = this.scope.lookup(name);
    if (cell) this.cells.set(binding, cell);
  }

  finalizeValues() {
    const seen = new Map();
    for (const { binding, name } of this.declarations) {
      const cell = this.scope.lookup(name);
      if (!cell) continue;

      const previous = seen.get(name);
      if (previous) this.unfoldable.add(previous);
      seen.set(name, binding);
      this.values.set(binding, { value: cell.value });
    }
  }

  prepare(folder) {
    const statements = this.chunk.body.statements;
    this.mapWrites(statements);
    this.live = !!folder;
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      this.point = index;
      if (folder) {
        this.depth = 0;
        this.dirty = null;

        this.pointWrites = new Set([
          ...writesIn(statement, true),
          ...this.mayChange(statement),
        ]);
        folder(statement, index);
      }
      if (statement.kind === Kind.Return) break;
      if (!this.isDeterministic(statement)) {
        this.skipped.push(statement);
        this.loseTrack(statement);
        continue;
      }
      try {
        const swallows = this.rt.swallows || 0;
        const seen = effects.witness(() => this.rt.execStatement(statement, this.scope));
        if ((this.rt.swallows || 0) !== swallows) {
          this.skipped.push(statement);
          this.loseTrack(statement);
          continue;
        }
        this.preludeStatements.add(statement);
        if (seen.older.size) this.mutated.set(statement, seen.older);
        this.declaresFrom(statement);
        this.keepTrack(statement);
        if (seen.value) break;
      } catch (error) {
        this.skipped.push(statement);
        this.preludeStatements.delete(statement);
        this.failures.push({ statement, error });
        this.loseTrack(statement);
        continue;
      }
    }
    this.live = false;
    this.finalizeValues();
    this.markUnfoldable();

    this.primeDecoders();
    return this;
  }

  mapWrites(statements) {
    statements.forEach((statement, index) => {
      for (const binding of writesIn(statement, true)) this.lastWrite.set(binding, index);
    });
  }

  loseTrack(statement) {
    for (const binding of this.mayChange(statement)) this.tainted.add(binding);
  }

  mayChange(statement) {
    const total = this.summary.of(statement);
    for (const binding of readsIn(statement)) {
      const cell = this.cells.get(binding);
      const value = cell ? cell.value : undefined;
      if (!(value instanceof V.LuaFunction) || !value.node) continue;
      for (const written of this.summary.writesOf(value.node)) total.add(written);
    }
    return total;
  }

  keepTrack(statement) {
    const written = writesIn(statement, false);
    if (!written.size) return;
    let dirty = false;

    for (const binding of readsIn(statement, false)) {
      if (this.tainted.has(binding)) { dirty = true; break; }
    }
    for (const binding of written) {
      if (dirty) this.tainted.add(binding);
      else this.tainted.delete(binding);
    }
  }

  usable(binding) {
    if (!binding || this.tainted.has(binding)) return false;
    if (this.pointWrites && this.pointWrites.has(binding)) return false;
    if (this.depth === 0) return true;
    const last = this.lastWrite.has(binding) ? this.lastWrite.get(binding) : -1;
    return last < this.point;
  }

  markUnfoldable() {
    for (const [binding] of this.values) {
      for (const write of binding.writes) {
        if (!this.isInPrelude(write)) {
          this.unfoldable.add(binding);
          break;
        }
      }
    }
    const assignedTables = new Set();
    walk(this.chunk, {
      enter: (node) => {
        if (node.kind !== Kind.Assignment) return undefined;
        for (const target of node.targets) {
          if (target.kind !== Kind.Index) continue;
          let base = target.base;
          while (base && base.kind === Kind.Index) base = base.base;
          if (base && base.kind === Kind.Name && base.binding && !this.isInPrelude(node)) {
            assignedTables.add(base.binding);
          }
        }
        return undefined;
      },
    });
    for (const binding of assignedTables) this.unfoldable.add(binding);

    for (const [binding, slot] of this.values) {
      if (isScalar(slot.value)) continue;
      for (const read of binding.reads) {
        if (this.isInPrelude(read)) continue;
        const parent = this.parentOf(read);
        const ok = parent && ((parent.kind === Kind.Index && parent.base === read)
          || ((parent.kind === Kind.Call || parent.kind === Kind.MethodCall) && parent.base === read));
        if (!ok) {
          this.unfoldable.add(binding);
          break;
        }
      }
    }
  }

  parentOf(node) {
    if (!this.parents) {
      const parents = new Map();
      const stack = [this.chunk];
      while (stack.length) {
        const at = stack.pop();
        for (const child of children(at)) {
          parents.set(child.node, at);
          stack.push(child.node);
        }
      }
      this.parents = parents;
    }
    return this.parents.get(node);
  }

  isInPrelude(node) {
    for (let at = node; at; at = this.parentOf(at)) {
      if (this.preludeStatements.has(at)) return true;
    }
    return false;
  }

  lookup(binding) {
    if (!binding || this.unfoldable.has(binding) || this.tainted.has(binding)) return undefined;
    return this.values.get(binding);
  }

  fromWrittenValue(binding, depth) {
    if (!binding || binding.kind === 'global') return { ok: false };
    if (this.reading.has(binding) || this.unfoldable.has(binding)) return { ok: false };
    if (this.tainted.has(binding)) return { ok: false };
    const written = soleValueOf(this.soleValues, binding);
    if (!written) return { ok: false };

    const fixed = C.isConstant(written) && (binding.writes || []).length === 0;
    if (!fixed && written.kind !== Kind.Function && written.kind !== Kind.Name) {
      return { ok: false };
    }
    this.reading.add(binding);
    try {
      return this.evaluate(written, depth + 1);
    } finally {
      this.reading.delete(binding);
    }
  }

  orCopy(node, found, depth) {
    if (found.ok || !this.copying) return found;
    const binding = node.binding;
    if (!binding || this.reading.has(binding)) return found;
    const value = this.copyOf(node);
    if (!value) return found;
    this.reading.add(binding);
    try {
      return this.evaluate(value, depth + 1);
    } finally {
      this.reading.delete(binding);
    }
  }

  evaluate(node, depth = 0) {
    if (!node || depth > 64) return { ok: false };
    switch (node.kind) {
      case Kind.Nil: return { ok: true, value: undefined };
      case Kind.True: return { ok: true, value: true };
      case Kind.False: return { ok: true, value: false };
      case Kind.Number: return { ok: true, value: node.value };
      case Kind.String: return { ok: true, value: node.value };
      case Kind.Paren: return this.evaluate(node.expression, depth + 1);
      case Kind.Function:
        return this.protect(() => this.rt.eval(node, this.scope));
      case Kind.Name: {
        if (node.binding && node.binding.kind === 'global') {
          if (!GLOBALS.has(node.binding.name)) return { ok: false };
          return { ok: true, value: this.rt.globals.get(node.binding.name) };
        }
        if (this.live) {
          const cell = this.cells.get(node.binding);
          if (cell && this.usable(node.binding)) return { ok: true, value: cell.value };
          return this.orCopy(node, this.fromWrittenValue(node.binding, depth), depth);
        }
        const slot = this.lookup(node.binding);
        if (slot) return { ok: true, value: slot.value };
        return this.orCopy(node, this.fromWrittenValue(node.binding, depth), depth);
      }
      case Kind.Table: {
        const table = new V.LuaTable();
        const entries = node.entries || [];
        let slot = 1;
        for (let i = 0; i < entries.length; i += 1) {
          const entry = entries[i];
          if (entry.type === 'key') {
            const key = this.evaluate(entry.key, depth + 1);
            const value = this.evaluate(entry.value, depth + 1);
            if (!key.ok || !value.ok || key.value === undefined) return { ok: false };
            const stored = this.protect(() => table.set(key.value, value.value));
            if (!stored.ok) return { ok: false };
            continue;
          }
          const value = this.evaluate(entry.value, depth + 1);
          if (!value.ok) return { ok: false };

          const spread = i === entries.length - 1 && value.values ? value.values : [value.value];
          for (const one of spread) {
            table.set(slot, one);
            slot += 1;
          }
        }
        return { ok: true, value: table };
      }
      case Kind.Index: {
        if (this.staleTable(node.base)) return { ok: false };
        const base = this.evaluate(node.base, depth + 1);
        const key = this.evaluate(node.index, depth + 1);
        if (!base.ok || !key.ok) return { ok: false };
        if (!(base.value instanceof V.LuaTable)) return { ok: false };
        if (this.staleValue(base.value)) return { ok: false };
        return this.protect(() => ops.index(this.rt, base.value, key.value));
      }
      case Kind.Binary: {
        if (node.operator === 'and' || node.operator === 'or') {
          const lhs = this.evaluate(node.lhs, depth + 1);
          if (!lhs.ok) return { ok: false };
          const takeRhs = node.operator === 'and' ? V.truthy(lhs.value) : !V.truthy(lhs.value);
          return takeRhs ? this.evaluate(node.rhs, depth + 1) : lhs;
        }
        const lhs = this.evaluate(node.lhs, depth + 1);
        const rhs = this.evaluate(node.rhs, depth + 1);
        if (!lhs.ok || !rhs.ok) return { ok: false };
        return this.protect(() => this.applyBinary(node.operator, lhs.value, rhs.value));
      }
      case Kind.Unary: {
        const argument = this.evaluate(node.argument, depth + 1);
        if (!argument.ok) return { ok: false };
        return this.protect(() => {
          if (node.operator === '-') return ops.unaryMinus(this.rt, argument.value);
          if (node.operator === 'not') return !V.truthy(argument.value);
          return ops.length(this.rt, argument.value);
        });
      }
      case Kind.Call: {
        const callee = this.evaluate(node.base, depth + 1);
        if (!callee.ok || !V.isCallable(callee.value)) return { ok: false };
        if (this.readsStale(callee.value)) return { ok: false };
        const args = this.evaluateList(node.args, depth + 1);
        if (!args.ok) return { ok: false };
        return this.callDeterministic(callee.value, args.values);
      }
      case Kind.MethodCall: {
        if (this.staleTable(node.base)) return { ok: false };
        const self = this.evaluate(node.base, depth + 1);
        if (!self.ok || this.staleValue(self.value)) return { ok: false };
        const args = this.evaluateList(node.args, depth + 1);
        if (!args.ok) return { ok: false };
        const method = this.protect(() => ops.index(this.rt, self.value, node.method));
        if (!method.ok || !V.isCallable(method.value)) return { ok: false };
        if (this.readsStale(method.value)) return { ok: false };
        return this.callDeterministic(method.value, [self.value, ...args.values]);
      }
      default:
        return { ok: false };
    }
  }

  applyBinary(operator, a, b) {
    switch (operator) {
      case '..': return ops.concat(this.rt, a, b);
      case '==': return ops.equals(this.rt, a, b);
      case '~=': return !ops.equals(this.rt, a, b);
      case '<': return ops.lessThan(this.rt, a, b);
      case '>': return ops.lessThan(this.rt, b, a);
      case '<=': return ops.lessOrEqual(this.rt, a, b);
      case '>=': return ops.lessOrEqual(this.rt, b, a);
      default: return ops.arith(this.rt, operator, a, b);
    }
  }

  evaluateList(nodes, depth) {
    const list = nodes || [];
    const values = [];
    for (let i = 0; i < list.length; i += 1) {
      const result = this.evaluate(list[i], depth);
      if (!result.ok) return { ok: false };
      if (i === list.length - 1 && result.values) values.push(...result.values);
      else values.push(result.value);
    }
    return { ok: true, values };
  }

  callDeterministic(fn, args) {
    if (this.impure.has(fn)) return { ok: false };
    const outcome = effects.record(() => this.callStable(fn, args));

    if (outcome.value.ok) {
      for (const written of outcome.writes) {
        if (written instanceof V.LuaTable) this.caches.add(written);
      }
    }
    return outcome.value;
  }

  callStable(fn, args) {
    const swallows = this.rt.swallows || 0;
    const opening = effects.attempt(() => this.protect(() => this.rt.call(fn, args)));
    const first = opening.value;
    if (!first.ok || (this.rt.swallows || 0) !== swallows) {
      effects.undo(opening);
      return { ok: false };
    }
    const trial = effects.attempt(() => this.protect(() => this.rt.call(fn, args)));
    const second = trial.value;
    effects.undo(trial);
    let stable = second.ok && !trial.escaped && first.value.length === second.value.length;
    const same = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));
    for (let i = 0; stable && i < first.value.length; i += 1) {
      if (!isScalar(first.value[i]) || !same(first.value[i], second.value[i])) stable = false;
    }
    if (!stable) {
      effects.undo(opening);
      return { ok: false };
    }
    effects.commit(opening);
    return { ok: true, value: first.value[0], values: first.value };
  }

  staleValue(value) {
    return !!this.dirty && this.dirty.has(value);
  }

  staleTable(node) {
    if (!this.dirty) return false;
    let base = node;
    while (base && base.kind === Kind.Paren) base = base.expression;
    return !!base && base.kind === Kind.Name && this.dirty.has(base.binding);
  }

  readsStale(value) {
    if (!(value instanceof V.LuaFunction) || !value.node) return false;
    for (const binding of this.summary.readsOf(value.node)) {
      if (!this.usable(binding)) return true;
      if (this.dirty && this.dirty.has(binding)) return true;
    }
    return false;
  }

  protect(fn) {
    const budget = this.rt.steps;
    try {
      return { ok: true, value: fn() };
    } catch (error) {
      this.rt.steps = budget;
      return { ok: false };
    }
  }

  evaluateCopied(node) {
    const kept = this.copying;
    this.copying = true;
    try {
      let inner = node;
      for (let step = 0; step <= 8; step += 1) {
        const direct = this.evaluate(inner);
        if (direct.ok) return direct;
        const next = this.copyOf(inner);
        if (!next) return { ok: false };
        inner = next;
      }
      return { ok: false };
    } finally {
      this.copying = kept;
    }
  }

  copyOf(node) {
    let inner = node;
    while (inner && inner.kind === Kind.Paren) inner = inner.expression;
    if (!inner || inner.kind !== Kind.Name) return null;
    const binding = inner.binding;
    if (!binding || !isLocalBinding(binding)) return null;
    if ((binding.writes || []).length > 1) return null;
    const holder = this.copyHolders().get(binding);
    if (!holder) return null;
    if (!this.positions) this.positions = new Positions(this.chunk);
    if (!this.positions.precedes(holder.statement, inner)) return null;
    return holder.value;
  }

  copyHolders() {
    if (this.holders) return this.holders;
    const holders = new Map();
    const note = (binding, value, statement) => {
      if (!binding || !value) return;
      if (holders.has(binding)) holders.set(binding, null);
      else holders.set(binding, { value, statement });
    };
    walk(this.chunk, {
      enter: (node) => {
        if (node.kind === Kind.LocalDeclaration) {
          const expressions = node.expressions || [];
          if (expressions.length === (node.names || []).length) {
            (node.bindings || []).forEach((binding, at) => note(binding, expressions[at], node));
          }
        } else if (node.kind === Kind.Assignment) {
          const targets = node.targets || [];
          const expressions = node.expressions || [];
          if (targets.length === expressions.length) {
            targets.forEach((target, at) => {
              if (target.kind === Kind.Name) note(target.binding, expressions[at], node);
            });
          }
        }
        return undefined;
      },
    });
    this.holders = holders;
    return holders;
  }

  primeDecoders() {
    this.depth = 0;
    this.pointWrites = null;
    this.dirty = null;
    let made = 0;
    const disturbed = new Set();
    walk(this.chunk, {
      enter: (node) => {
        if (made >= PRIME_LIMIT) return false;
        if (node.kind !== Kind.Call) return undefined;
        const args = node.args || [];
        if (!args.length || !args.every((argument) => C.isConstant(argument)
          || argument.kind === Kind.Name)) return undefined;
        const decoder = this.decoderAt(node.base);
        if (!decoder || this.readsStale(decoder)) return undefined;
        made += 1;

        const trial = effects.record(() => {
          const given = [];
          for (const argument of args) {
            const value = this.evaluateCopied(argument);
            if (!value.ok) return { ok: false };
            given.push(value.value);
          }
          return this.callDeterministic(decoder, given);
        });
        for (const written of trial.writes) disturbed.add(written);
        if (!trial.value.ok) return undefined;
        for (const written of trial.writes) {
          if (written instanceof V.LuaTable) this.caches.add(written);
        }
        return undefined;
      },
    });
    this.distrust(disturbed);
    return made;
  }

  distrust(written) {
    const owners = new Map();
    for (const [binding, cell] of this.cells) owners.set(cell, binding);
    for (const thing of written) {
      const binding = owners.get(thing);
      if (binding) this.tainted.add(binding);
    }
    for (const [binding, slot] of this.values) {
      if (written.has(slot.value) && !this.caches.has(slot.value)) this.unfoldable.add(binding);
    }
  }

  alongCopies(node, accept) {
    let inner = node;
    for (let step = 0; step <= 8 && inner; step += 1) {
      while (inner && inner.kind === Kind.Paren) inner = inner.expression;
      if (!inner) return null;
      const direct = this.evaluate(inner);
      if (direct.ok) return accept(direct.value, null) ? direct.value : null;
      if (inner.kind !== Kind.Name || !isLocalBinding(inner.binding)) return null;
      const slot = this.values.get(inner.binding);
      if (slot && accept(slot.value, inner.binding)) return slot.value;
      inner = this.copyOf(inner);
    }
    return null;
  }

  decoderAt(node) {
    return this.alongCopies(node, (value, binding) => value instanceof V.LuaFunction
      && !!value.node
      && (!binding || (binding.writes || []).every((write) => this.isInPrelude(write))));
  }

  cacheAt(node) {
    return this.alongCopies(node, (value) => this.reachesCache(value));
  }

  reachesCache(table, depth = 0) {
    if (!(table instanceof V.LuaTable) || depth > 8) return false;
    if (this.caches.has(table)) return true;
    const meta = table.metatable;
    return meta ? this.reachesCache(meta.get('__index'), depth + 1) : false;
  }

  cacheLiteralFor(node) {
    if (!this.caches.size || !node || node.kind !== Kind.Index) return null;
    const key = this.evaluateCopied(node.index);
    if (!key.ok || key.value === undefined) return null;
    const table = this.cacheAt(node.base);
    if (!table) return null;
    const found = this.protect(() => ops.index(this.rt, table, key.value));
    if (!found.ok || !isScalar(found.value) || found.value === undefined) return null;
    return C.literalNode(found.value);
  }

  literalFor(node, expanding = false) {
    if (C.isConstant(node)) return null;
    const result = this.evaluate(node);
    if (!result.ok || !isScalar(result.value) || result.value === undefined) return null;
    if (expanding && result.values && result.values.length !== 1) return null;
    return C.literalNode(result.value);
  }
}

module.exports = { Evaluator, writesIn, readsIn };

};

__modules["src/util/flow.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { walk } = require("src/lua/walk.js");

const EXIT = new Set(['error']);

const TRUTHY = new Set([Kind.True, Kind.Number, Kind.String, Kind.Table, Kind.Function]);

function isAlwaysTrue(node) {
  if (!node) return false;
  if (node.kind === Kind.Paren) return isAlwaysTrue(node.expression);
  return TRUTHY.has(node.kind);
}

function bare(node) {
  let current = node;
  while (current && current.kind === Kind.Paren) current = current.expression;
  return current;
}

function hasEscape(body) {
  let found = false;
  walk(body, {
    enter(node) {
      if (found) return false;
      if (node.kind === Kind.Function) return false;
      if (node.kind === Kind.While || node.kind === Kind.Repeat
        || node.kind === Kind.NumericFor || node.kind === Kind.GenericFor) {
        let inner = false;
        walk(node.body, {
          enter(child) {
            if (child.kind === Kind.Function) return false;
            if (child.kind === Kind.Return || child.kind === Kind.Goto) inner = true;
            return undefined;
          },
        });
        if (inner) found = true;
        return false;
      }
      if (node.kind === Kind.Break || node.kind === Kind.Return || node.kind === Kind.Goto) {
        found = true;
      }
      return undefined;
    },
  });
  return found;
}

function divergingCall(node, depth) {
  const call = bare(node);
  if (!call || call.kind !== Kind.Call) return false;
  const base = bare(call.base);
  if (!base) return false;
  if (base.kind === Kind.Name && !base.binding && EXIT.has(base.name)) return true;
  if (base.kind === Kind.Function) return divergesBlock(base.body, depth + 1);
  return false;
}

function diverges(statement, depth = 0) {
  if (!statement || depth > 48) return false;
  switch (statement.kind) {
    case Kind.While:
      return isAlwaysTrue(statement.condition) && !hasEscape(statement.body);
    case Kind.Repeat:
      return divergesBlock(statement.body, depth + 1)
        || (statement.condition && statement.condition.kind === Kind.False
          && !hasEscape(statement.body));
    case Kind.Do:
      return divergesBlock(statement.body, depth + 1);
    case Kind.Return:
      return (statement.expressions || []).length === 1
        && divergingCall(statement.expressions[0], depth);
    case Kind.CallStatement:
      return divergingCall(statement.expression, depth);
    case Kind.If: {
      if (!statement.elseBody) return false;
      if (!divergesBlock(statement.body, depth + 1)) return false;
      for (const clause of statement.elseIfs || []) {
        if (!divergesBlock(clause.body, depth + 1)) return false;
      }
      return divergesBlock(statement.elseBody, depth + 1);
    }
    default:
      return false;
  }
}

function divergesBlock(block, depth = 0) {
  if (!block || depth > 48) return false;
  return (block.statements || []).some((s) => diverges(s, depth + 1));
}

function soleValues(chunk) {
  const values = new Map();
  const rejected = new Set();

  const pair = (binding, list, index, assigned) => {
    if (!binding || binding.kind === 'global' || rejected.has(binding)) return;
    if (values.has(binding) || binding.writes.length !== (assigned ? 1 : 0)) {
      rejected.add(binding);
      values.delete(binding);
      return;
    }
    values.set(binding, { list, index });
  };
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.LocalDeclaration) {
        const bindings = node.bindings || [];
        const expressions = node.expressions || [];
        if (bindings.length === expressions.length) {
          bindings.forEach((binding, i) => pair(binding, expressions, i, false));
        }
        return undefined;
      }
      if (node.kind === Kind.LocalFunction && node.binding) {
        pair(node.binding, [node.body], 0, false);
        return undefined;
      }
      if (node.kind === Kind.Assignment) {
        const targets = node.targets || [];
        const expressions = node.expressions || [];
        if (targets.length === expressions.length) {
          targets.forEach((target, i) => {
            const inner = bare(target);
            if (inner && inner.kind === Kind.Name) pair(inner.binding, expressions, i, true);
          });
        }
      }
      return undefined;
    },
  });
  return values;
}

function copyRoots(values) {
  const roots = new Map();
  for (const binding of values.keys()) {
    let at = binding;
    const seen = new Set([binding]);
    for (;;) {
      const held = bare(soleValueOf(values, at));
      if (!held || held.kind !== Kind.Name || !held.binding) break;
      if (seen.has(held.binding)) break;
      seen.add(held.binding);
      at = held.binding;
    }
    if (at !== binding) roots.set(binding, at);
  }
  return roots;
}

function soleValueOf(values, binding) {
  const at = binding ? values.get(binding) : null;
  return at ? at.list[at.index] : null;
}
module.exports = {
  soleValues,
  soleValueOf,
  copyRoots,
  isAlwaysTrue,
  bare,
  hasEscape,
  diverges,
  divergesBlock,
};

};

__modules["src/util/order.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { framed } = require("src/lua/walk.js");

class Positions {
  constructor(root) {
    this.paths = new Map();
    this.labelled = new Set();
    framed(root, (node, frame) => {
      if (node.kind !== Kind.Block) {
        this.paths.set(node, frame);
        return;
      }
      if (node.statements.some((statement) => statement.kind === Kind.Label)) {
        this.labelled.add(node);
      }
    });
  }

  path(node) {
    return this.paths.get(node) || null;
  }

  precedes(statement, node) {
    const before = this.path(statement);
    const after = this.path(node);
    if (!before || !after) return false;
    let low = before;
    let high = after;
    while (low.depth > high.depth) low = low.up;
    while (high.depth > low.depth) high = high.up;
    if (low === high) return false;
    while (low.up !== high.up) {
      low = low.up;
      high = high.up;
    }
    if (low !== before || low.block !== high.block) return false;
    if (low.at >= high.at) return false;
    if (this.labelled.has(low.block) && this.jumpedInto(low.block, low.at, high.at)) return false;
    return true;
  }

  jumpedInto(block, from, to) {
    const statements = block.statements;
    for (let at = from + 1; at <= to && at < statements.length; at += 1) {
      if (statements[at].kind === Kind.Label) return true;
    }
    return false;
  }
}

module.exports = { Positions };

};

__modules["src/util/purity.js"] = function(module, exports, require) {
'use strict';

const { Kind, unparen } = require("src/lua/ast.js");
const { walk, children, collect } = require("src/lua/walk.js");
const { isGlobalName, isLocalBinding } = require("src/lua/scope.js");
const { Positions } = require("src/util/order.js");

const GLOBALS = new Set([
  'pcall', 'xpcall', 'select', 'type', 'tostring', 'tonumber', 'unpack', 'rawequal',
  'rawget', 'rawset', 'rawlen', 'setmetatable', 'getmetatable', 'newproxy', 'next',
  'ipairs', 'pairs', 'loadstring', 'load', 'gcinfo', 'collectgarbage', 'getfenv',
]);

const TABLES = new Set([
  'math', 'string', 'table', 'debug', 'os', 'coroutine', 'bit', 'bit32', 'utf8', 'jit',
]);

const LIMIT = 96;
let owned = null;

const EFFECTS = new Set([
  'coroutine.yield', 'coroutine.resume', 'coroutine.wrap', 'coroutine.close',
  'os.exit', 'os.remove', 'os.rename', 'os.execute', 'os.setlocale', 'os.tmpname',
  'debug.setupvalue', 'debug.setlocal', 'debug.upvaluejoin', 'debug.setmetatable',
  'debug.setfenv', 'debug.debug',
]);

function hasEffect(base, key) {
  if (!key || key.kind !== Kind.String) return false;
  return EFFECTS.has(`${base.name}.${key.value}`);
}

const IMPURE = new Set(['error', 'assert', 'print', 'pcall_', 'os_exit']);

function localValues(root) {
  const writes = new Map();
  const record = (binding, expr, at, bare) => {
    if (!binding) return;
    let seen = writes.get(binding);
    if (!seen) {
      seen = { count: 0, bare: 0, valued: [] };
      writes.set(binding, seen);
    }
    seen.count += 1;
    if (expr) seen.valued.push({ expr, at });
    else if (bare) seen.bare += 1;
  };

  const filled = new Map();
  const fill = (target, expr) => {
    for (const said of collect(target, (one) => one.kind === Kind.Name)) {
      if (!said.binding) continue;
      let stored = filled.get(said.binding);
      if (!stored) filled.set(said.binding, stored = []);
      stored.push(expr || null);
    }
  };

  const derived = new Map();
  const derive = (binding, expressions) => {
    if (!binding) return;
    derived.set(binding, expressions.filter(Boolean));
  };
  const align = (node, bindings, expressions, bare) => {
    const list = bindings || [];
    for (let i = 0; i < list.length; i += 1) {
      const single = expressions.length === list.length;
      record(list[i], single ? expressions[i] : null, node, bare);
    }
  };
  walk(root, {
    enter(node) {
      if (node.kind === Kind.LocalDeclaration) {
        const expressions = node.expressions || [];
        align(node, node.bindings, expressions, !expressions.length);
      } else if (node.kind === Kind.LocalFunction) {
        record(node.binding, node.body, node, false);
      } else if (node.kind === Kind.Assignment) {
        const targets = node.targets || [];
        const expressions = node.expressions || [];
        for (let i = 0; i < targets.length; i += 1) {
          const target = targets[i];
          if (!target) continue;
          const aligned = targets.length === expressions.length;
          if (target.kind !== Kind.Name) {
            fill(target, aligned ? expressions[i] : null);
            continue;
          }
          record(target.binding, aligned ? expressions[i] : null, node, false);
        }
      } else if (node.kind === Kind.NumericFor) {
        record(node.binding, null, node, false);
        derive(node.binding, [node.start, node.limit, node.step]);
      } else if (node.kind === Kind.GenericFor) {
        align(node, node.bindings, [], false);
        for (const binding of node.bindings || []) derive(binding, node.expressions || []);
      }
      else if (node.kind === Kind.Function) align(node, node.bindings, [], false);
      return undefined;
    },
  });
  const values = new Map();

  const callees = new Map();
  let positions = null;
  for (const [binding, info] of writes) {
    if (!info.valued.length) continue;

    if (info.bare + info.valued.length !== info.count) continue;
    callees.set(binding, info.valued.map((write) => write.expr));
    const reads = binding.reads || [];
    if (info.bare && reads.length) {
      if (!positions) positions = new Positions(root);
      const settled = info.valued.some(
        (write) => reads.every((read) => positions.precedes(write.at, read)));
      if (!settled) continue;
    }
    values.set(binding, info.valued.map((write) => write.expr));
  }
  for (const [binding, info] of writes) {
    if (info.count !== 1 || info.valued.length) derived.delete(binding);
  }
  return { values, derived, callees, filled };
}

function confined(node, facts, seen = new Set(), depth = 0) {
  if (!node || typeof node !== 'object' || depth > LIMIT) return false;
  switch (node.kind) {
    case Kind.Nil: case Kind.True: case Kind.False:
    case Kind.Number: case Kind.String:
      return true;
    case Kind.Function: {
      const region = () => new Set(node.bindings || []);
      if (owned) {
        const before = facts.loose.get(node);
        if (before) {
          for (const binding of before.cells) owned.add(binding);
          return before.ok;
        }
        const mine = new Set();
        const outer = owned;
        facts.loose.set(node, { ok: false, cells: mine });
        owned = mine;
        const found = isRemovableBlock(node.body, facts, new Set(), depth + 1, region());
        owned = outer;
        facts.loose.set(node, { ok: found, cells: mine });
        for (const binding of mine) owned.add(binding);
        return found;
      }
      const known = facts.functions.get(node);
      if (known !== undefined) return known;
      facts.functions.set(node, false);
      const answer = isRemovableBlock(node.body, facts, new Set(), depth + 1, region());
      facts.functions.set(node, answer);
      return answer;
    }
    case Kind.Vararg:
      return false;
    case Kind.Name: {
      if (IMPURE.has(node.name)) return false;
      if (isGlobalName(node)) {
        return GLOBALS.has(node.name) || TABLES.has(node.name);
      }
      const binding = node.binding;
      if (!binding || !isLocalBinding(binding)) return false;
      if (seen.has(binding)) return true;
      seen.add(binding);
      const defs = facts.sourcesOf(binding);
      if (!defs) return false;
      if (!defs.every((def) => confined(def, facts, new Set(seen), depth + 1))) return false;

      const stored = facts.fillsOf(binding);
      return !stored
        || stored.every((one) => !!one && confined(one, facts, new Set(seen), depth + 1));
    }
    case Kind.Paren:
      return confined(node.expression, facts, seen, depth + 1);
    case Kind.Unary:
      return confined(node.argument, facts, seen, depth + 1);
    case Kind.Binary:
      return confined(node.lhs, facts, seen, depth + 1)
        && confined(node.rhs, facts, new Set(seen), depth + 1);
    case Kind.Index:
      if (isGlobalName(node.base) && hasEffect(node.base, node.index)) return false;
      return confined(node.base, facts, seen, depth + 1)
        && confined(node.index, facts, new Set(seen), depth + 1);
    case Kind.Table:
      return (node.entries || []).every((entry) => (
        (!entry.key || confined(entry.key, facts, new Set(seen), depth + 1))
        && confined(entry.value, facts, new Set(seen), depth + 1)));
    case Kind.Call: case Kind.MethodCall: {
      const callable = node.kind === Kind.Call
        ? isPure(node.base, facts, new Set(), depth + 1)
        : confined(node.base, facts, new Set(seen), depth + 1);
      return callable
        && (node.args || []).every((arg) => confined(arg, facts, new Set(seen), depth + 1));
    }
    default:
      return false;
  }
}

class Facts {
  constructor(root) {
    const known = localValues(root);
    this.values = known.values;
    this.derived = known.derived;
    this.callees = known.callees;
    this.filled = known.filled;
    this.functions = new Map();
    this.loose = new Map();
  }

  valuesOf(binding) {
    return (binding && this.values.get(binding)) || null;
  }

  calleeValuesOf(binding) {
    return (binding && this.callees.get(binding)) || null;
  }

  fillsOf(binding) {
    return (binding && this.filled.get(binding)) || null;
  }

  sourcesOf(binding) {
    if (!binding) return null;
    return this.values.get(binding) || this.derived.get(binding) || null;
  }

  isConfined(node) {
    return confined(node, this, new Set(), 0);
  }
}

function uncallable(node, facts, seen = new Set(), depth = 0) {
  if (!node || depth > LIMIT) return false;
  switch (node.kind) {
    case Kind.Nil: case Kind.True: case Kind.False:
    case Kind.Number: case Kind.String:
      return true;

    case Kind.Table:
      return true;
    case Kind.Name: {
      if (isGlobalName(node)) return TABLES.has(node.name);
      const binding = node.binding;
      if (!binding || seen.has(binding)) return false;
      seen.add(binding);

      const defs = facts.calleeValuesOf(binding);
      return !!defs && defs.length > 0
        && defs.every((def) => uncallable(def, facts, new Set(seen), depth + 1));
    }
    case Kind.Paren:
      return uncallable(node.expression, facts, seen, depth + 1);
    default:
      return false;
  }
}

function isPure(node, facts, seen = new Set(), depth = 0) {
  if (!node || depth > LIMIT) return false;
  if (node.kind === Kind.Paren) return isPure(node.expression, facts, seen, depth + 1);
  if (node.kind === Kind.Name) {
    if (IMPURE.has(node.name)) return false;

    if (isGlobalName(node)) return GLOBALS.has(node.name);
    const binding = node.binding;
    if (!binding) return GLOBALS.has(node.name);
    if (seen.has(binding)) return false;
    seen.add(binding);
    const defs = (facts.calleeValuesOf(binding) || [])
      .filter((def) => !uncallable(def, facts, new Set(), depth + 1));
    return defs.length > 0
      && defs.every((def) => isPure(def, facts, new Set(seen), depth + 1));
  }
  if (node.kind === Kind.Index) {
    const base = node.base;
    const key = node.index;
    if (isGlobalName(base)) {
      if (!TABLES.has(base.name)) return false;
      if (hasEffect(base, key)) return false;
      return !key || key.kind === Kind.String;
    }

    return confined(base, facts, new Set(), depth + 1)
      && (!key || confined(key, facts, new Set(), depth + 1));
  }
  if (node.kind === Kind.Function) {
    return confined(node, facts, new Set(), depth + 1);
  }

  if (node.kind === Kind.Binary && (node.operator === 'or' || node.operator === 'and')) {
    const sides = [node.lhs, node.rhs]
      .filter((side) => !uncallable(side, facts, new Set(), depth + 1));
    return sides.length > 0
      && sides.every((side) => isPure(side, facts, seen, depth + 1));
  }

  return confined(node, facts, new Set(), depth + 1);
}

function writesOutside(node, facts) {
  const found = new Set();
  const outer = owned;
  owned = found;
  try {
    return isRemovable(node, facts) ? found : null;
  } finally {
    owned = outer;
  }
}

function targetWrites(target, facts) {
  const found = new Set();
  const outer = owned;
  owned = found;
  try {
    return ownWrite(target, facts, false) ? found : null;
  } finally {
    owned = outer;
  }
}

function isRemovable(node, facts, seen = new Set(), depth = 0) {
  if (!node || typeof node !== 'object') return true;
  if (depth > LIMIT) return false;
  switch (node.kind) {
    case Kind.Nil: case Kind.True: case Kind.False:
    case Kind.Number: case Kind.String: case Kind.Vararg: case Kind.Name:
      return true;
    case Kind.Function:
      return true;
    case Kind.Paren:
      return isRemovable(node.expression, facts, seen, depth + 1);
    case Kind.Unary:
      return isRemovable(node.argument, facts, seen, depth + 1);
    case Kind.Binary:
      return isRemovable(node.lhs, facts, seen, depth + 1)
        && isRemovable(node.rhs, facts, seen, depth + 1);
    case Kind.Index:
      return isRemovable(node.base, facts, seen, depth + 1)
        && isRemovable(node.index, facts, seen, depth + 1);
    case Kind.Table:
      return (node.entries || []).every((entry) => (
        (!entry.key || isRemovable(entry.key, facts, seen, depth + 1))
        && isRemovable(entry.value, facts, seen, depth + 1)));
    case Kind.Call:
      return isPure(node.base, facts, new Set(seen), depth + 1)
        && (node.args || []).every((arg) => isRemovable(arg, facts, seen, depth + 1));
    case Kind.MethodCall:
      return confined(node.base, facts, new Set(), depth + 1)
        && (node.args || []).every((arg) => confined(arg, facts, new Set(), depth + 1));
    default:
      return false;
  }
}

function throughBindings(node, facts) {
  const found = [];
  const chain = (binding) => {
    let inner = binding;
    while (inner && isLocalBinding(inner)) {
      if (found.includes(inner)) return;
      found.push(inner);
      const values = facts ? facts.valuesOf(inner) : null;
      let value = values && values.length === 1 ? values[0] : null;
      while (value && value.kind === Kind.Paren) value = value.expression;
      inner = value && value.kind === Kind.Name ? value.binding : null;
    }
  };
  const visit = (inner) => {
    if (!inner || !inner.kind || inner.kind === Kind.Function) return;
    if (inner.kind === Kind.Name) { chain(inner.binding); return; }
    for (const child of children(inner)) visit(child.node);
  };
  visit(node);
  return found;
}

function reachesLive(node, facts) {
  let found = false;
  walk(node, {
    enter(inner) {
      if (found) return false;

      if (inner.kind === Kind.Function) return false;
      if (inner.kind !== Kind.Call && inner.kind !== Kind.MethodCall) return undefined;
      const reached = [];

      if (inner.kind === Kind.MethodCall || (inner.base && inner.base.kind !== Kind.Name)) {
        reached.push(...throughBindings(inner.base, facts));
      }
      for (const argument of inner.args || []) reached.push(...throughBindings(argument, facts));
      if (reached.some((binding) => (binding.reads || []).length)) found = true;
      return undefined;
    },
  });
  return found;
}

function isSelfContained(node, facts) {
  return isRemovable(node, facts) && !reachesLive(node, facts);
}

const LOADERS = new Set(['load', 'loadstring', 'loadfile', 'dofile', 'require']);

function sealed(fn, facts) {
  const inside = new Set();
  const vouched = new Set();
  walk(fn, {
    enter(node) {
      inside.add(node);
      if (node.kind !== Kind.Call || !facts || !isPure(node.base, facts)) return undefined;
      const names = collect(node.base, (one) => one.kind === Kind.Name);
      if (names.some((one) => LOADERS.has(one.name))) return undefined;
      for (const one of names) vouched.add(one);
      return undefined;
    },
  });
  let clear = true;
  walk(fn, {
    enter(node) {
      if (node.kind !== Kind.Name || vouched.has(node)) return undefined;
      const binding = node.binding;
      if (!binding || !isLocalBinding(binding)) clear = false;
      else if (!binding.declaration || !inside.has(binding.declaration)) clear = false;
      return undefined;
    },
  });
  return clear;
}

function madeHere(node, facts, depth = 0) {
  const inner = unparen(node);
  if (!inner || depth > LIMIT) return false;
  switch (inner.kind) {
    case Kind.Nil:
    case Kind.True:
    case Kind.False:
    case Kind.Number:
    case Kind.String:
      return true;
    case Kind.Function:
      return sealed(inner, facts);
    case Kind.Table:
      return (inner.entries || []).every((entry) => madeHere(entry.value, facts, depth + 1)
        && (entry.type !== 'key' || madeHere(entry.key, facts, depth + 1)));
    default:
      return false;
  }
}

function touchesOwn(call, facts) {
  if (!call || call.kind !== Kind.Call) return false;
  return (call.args || []).every((argument) => madeHere(argument, facts));
}

function plainTable(value, facts, depth = 0) {
  const inner = unparen(value);
  if (!inner || depth > LIMIT) return false;
  if (inner.kind === Kind.Table) return true;
  if (madeHere(inner, facts, depth)) return true;
  if (inner.kind !== Kind.Call) return false;
  const callee = unparen(inner.base);
  if (!callee || callee.kind !== Kind.Name || !isGlobalName(callee)
    || callee.name !== 'setmetatable') return false;
  const args = inner.args || [];
  if (args.length !== 2 || !plainTable(args[0], facts, depth + 1)) return false;
  const meta = unparen(args[1]);
  if (!meta || meta.kind !== Kind.Table) return false;
  return (meta.entries || []).every((entry) => entry.type === 'key' && entry.key
    && entry.key.kind === Kind.String && entry.key.value !== '__newindex');
}

function holdsTable(binding, facts, spare, seen, depth) {
  if (!binding || !isLocalBinding(binding) || seen.has(binding) || depth > LIMIT) return false;
  seen.add(binding);
  if (!spare(binding)) return false;
  const values = facts ? facts.valuesOf(binding) : null;
  if (!values || !values.length) return false;
  return values.every((one) => {
    const inner = unparen(one);
    if (inner && inner.kind === Kind.Name && inner.binding) {
      return holdsTable(inner.binding, facts, spare, seen, depth + 1);
    }
    return plainTable(one, facts, depth + 1);
  });
}

function ownWrite(target, facts, region, depth = 0) {
  if (!target || depth > LIMIT) return false;
  const held = (binding) => !!region && !!region.has && region.has(binding);
  const spare = (binding) => {
    if (!binding.captured || held(binding)) return true;
    if (!owned) return false;
    owned.add(binding);
    return true;
  };
  if (target.kind === Kind.Name) {
    const binding = target.binding;
    if (!binding || !isLocalBinding(binding)) return false;
    return spare(binding);
  }
  if (target.kind === Kind.Index) {
    const base = unparen(target.base);
    if (!base || base.kind !== Kind.Name) return false;
    return holdsTable(base.binding, facts, spare, new Set(), depth + 1);
  }
  return false;
}

function declaredBy(statement, into) {
  if (statement.kind === Kind.LocalDeclaration) {
    for (const binding of statement.bindings || []) into.add(binding);
  } else if (statement.kind === Kind.LocalFunction) into.add(statement.binding);
  else if (statement.kind === Kind.NumericFor) into.add(statement.binding);
  else if (statement.kind === Kind.GenericFor) {
    for (const binding of statement.bindings || []) into.add(binding);
  }
}
function isRemovableBlock(block, facts, seen = new Set(), depth = 0, inFunction = false) {
  if (!block || depth > LIMIT) return false;
  const region = inFunction instanceof Set ? new Set(inFunction) : inFunction;
  return (block.statements || []).every((s) => {
    const ok = isRemovableStatement(s, facts, seen, depth + 1, region);
    if (region instanceof Set) declaredBy(s, region);
    return ok;
  });
}

function isRemovableStatement(statement, facts, seen = new Set(), depth = 0, inFunction = false) {
  if (!statement || depth > LIMIT) return false;
  const block = (b) => isRemovableBlock(b, facts, seen, depth + 1, inFunction);
  const value = (e) => isRemovable(e, facts, seen, depth + 1);
  switch (statement.kind) {
    case Kind.LocalDeclaration:
      return (statement.expressions || []).every(value);
    case Kind.Assignment:
      return (statement.targets || []).every((target) => ownWrite(target, facts, inFunction))
        && (statement.expressions || []).every(value);
    case Kind.LocalFunction:
    case Kind.Label:
      return true;
    case Kind.Return:
      return inFunction && (statement.expressions || []).every(value);
    case Kind.Break:
    case Kind.Continue:
      return inFunction;
    case Kind.CallStatement:
      return value(statement.expression);
    case Kind.Do:
      return block(statement.body);
    case Kind.While:
    case Kind.Repeat:
      return value(statement.condition) && block(statement.body);
    case Kind.NumericFor:
      return value(statement.start) && value(statement.limit) && value(statement.step)
        && block(statement.body);
    case Kind.GenericFor:
      return (statement.expressions || []).every(value) && block(statement.body);
    case Kind.If:
      return value(statement.condition) && block(statement.body)
        && (statement.elseIfs || []).every((clause) => (
          value(clause.condition) && block(clause.body)))
        && (!statement.elseBody || block(statement.elseBody));
    default:
      return false;
  }
}

module.exports = {
  TABLES,
  LOADERS,
  Facts,
  isRemovable,
  isSelfContained,
  sealed,
  touchesOwn,
  throughBindings,
  writesOutside,
  targetWrites,
};

};

__modules["src/util/writes.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { walk } = require("src/lua/walk.js");

function declaredIn(root) {
  const declared = new Set();
  walk(root, {
    enter: (node) => {
      for (const binding of node.bindings || []) if (binding) declared.add(binding);
      if (node.binding && (node.kind === Kind.LocalFunction || node.kind === Kind.NumericFor)) {
        declared.add(node.binding);
      }
      return undefined;
    },
  });
  return declared;
}

function asFunction(node) {
  let value = node;
  while (value && value.kind === Kind.Paren) value = value.expression;
  return value && value.kind === Kind.Function ? value : null;
}

class Writes {
  constructor(chunk, writesIn, readsIn) {
    this.writesIn = writesIn;
    this.readsIn = readsIn;
    this.carriers = new Map();
    this.direct = new Map();
    this.mentions = new Map();
    this.resolved = new Map();
    this.reachedReads = new Map();
    this.collect(chunk);
  }

  collect(chunk) {
    const carry = (binding, fn) => {
      if (!binding || !fn) return;
      if (!this.carriers.has(binding)) this.carriers.set(binding, new Set());
      this.carriers.get(binding).add(fn);
    };
    walk(chunk, {
      enter: (node) => {
        if (node.kind === Kind.LocalFunction) carry(node.binding, node.body);
        else if (node.kind === Kind.FunctionDeclaration) {
          if (node.target && node.target.kind === Kind.Name) carry(node.target.binding, node.body);
        } else if (node.kind === Kind.LocalDeclaration || node.kind === Kind.Assignment) {
          const slots = node.kind === Kind.LocalDeclaration ? (node.bindings || []) : null;
          (node.expressions || []).forEach((expression, index) => {
            const fn = asFunction(expression);
            if (!fn) return;
            if (slots) { carry(slots[index], fn); return; }
            const target = (node.targets || [])[index];
            if (target && target.kind === Kind.Name) carry(target.binding, fn);
          });
        }
        if (node.kind === Kind.Function) this.summarise(node);
        return undefined;
      },
    });
  }

  summarise(fn) {
    const own = declaredIn(fn);
    const keep = (bindings) => {
      const out = new Set();
      for (const binding of bindings) if (!own.has(binding)) out.add(binding);
      return out;
    };
    this.direct.set(fn, keep(this.writesIn(fn.body, true)));
    this.mentions.set(fn, keep(this.readsIn(fn.body)));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const [fn, direct] of this.direct) this.resolved.set(fn, new Set(direct));
    for (const [fn, mentioned] of this.mentions) {
      this.reachedReads.set(fn, new Set(mentioned));
    }
    for (let growing = true; growing;) {
      growing = false;
      for (const [fn, mentioned] of this.mentions) {
        const written = this.resolved.get(fn);
        const read = this.reachedReads.get(fn);
        for (const binding of mentioned) {
          for (const other of this.carriers.get(binding) || []) {
            for (const one of this.resolved.get(other) || []) {
              if (written.has(one)) continue;
              written.add(one);
              growing = true;
            }
            for (const one of this.reachedReads.get(other) || []) {
              if (read.has(one)) continue;
              read.add(one);
              growing = true;
            }
          }
        }
      }
    }
  }

  readsOf(fn) {
    this.close();
    const read = this.reachedReads.get(fn);
    if (!read) return new Set();
    const written = this.resolved.get(fn) || new Set();
    const out = new Set();
    for (const binding of read) if (!written.has(binding)) out.add(binding);
    return out;
  }

  allReadsOf(fn) {
    this.close();
    return this.reachedReads.get(fn) || new Set();
  }

  carriersOf(binding) {
    return this.carriers.get(binding) || new Set();
  }

  writesOf(fn) {
    this.close();
    return this.resolved.get(fn) || new Set();
  }

  of(statement) {
    const total = new Set(this.writesIn(statement, false));
    for (const binding of this.readsIn(statement)) {
      for (const fn of this.carriers.get(binding) || []) {
        for (const written of this.writesOf(fn)) total.add(written);
      }
    }
    return total;
  }
}

module.exports = { Writes, declaredIn };

};

__modules["src/vm/blocks.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { unparen, bindingOf } = require("src/vm/detect.js");

const FLIP = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };

function cutOf(condition, pos) {
  const node = unparen(condition);
  if (!node || node.kind !== Kind.Binary || !FLIP[node.operator]) return null;
  let operator = node.operator;
  let side = unparen(node.lhs);
  let bound = unparen(node.rhs);
  if (bindingOf(side) !== pos) {
    if (bindingOf(bound) !== pos) return null;
    operator = FLIP[operator];
    const swap = side;
    side = bound;
    bound = swap;
  }
  if (!bound || bound.kind !== Kind.Number) return null;
  if (operator === '<') return { lo: null, hi: bound.value };
  if (operator === '<=') return { lo: null, hi: bound.value + 1 };
  if (operator === '>') return { lo: bound.value + 1, hi: null };
  return { lo: bound.value, hi: null };
}

function extractLeaves(vm) {
  const leaves = [];
  const pos = vm.container.pos;

  const visit = (block, lo, hi) => {
    const statements = block.statements;
    if (statements.length === 1 && statements[0].kind === Kind.If && statements[0].elseBody) {
      const branch = statements[0];
      const clauses = [{ condition: branch.condition, body: branch.body }]
        .concat(branch.elseIfs || []);
      const cuts = clauses.map((clause) => cutOf(clause.condition, pos));
      if (cuts.every(Boolean)) {
        let low = lo;
        let high = hi;
        for (let i = 0; i < clauses.length; i += 1) {
          if (cuts[i].hi !== null) {
            visit(clauses[i].body, low, Math.min(high, cuts[i].hi));
            low = Math.max(low, cuts[i].hi);
          } else {
            visit(clauses[i].body, Math.max(low, cuts[i].lo), high);
            high = Math.min(high, cuts[i].lo);
          }
        }
        visit(branch.elseBody, low, high);
        return;
      }
    }
    leaves.push({ lo, hi, statements, id: null, index: leaves.length });
  };

  visit(vm.container.dispatch.body, -Infinity, Infinity);
  return leaves;
}

function jumpTargets(expression, out = new Set(), depth = 0) {
  const node = unparen(expression);
  if (!node || depth > 64) return out;
  if (node.kind === Kind.Number) {
    out.add(node.value);
    return out;
  }
  if (node.kind === Kind.Binary && node.operator === 'or') {
    jumpTargets(node.lhs, out, depth + 1);
    jumpTargets(node.rhs, out, depth + 1);
    return out;
  }
  if (node.kind === Kind.Binary && node.operator === 'and') {
    jumpTargets(node.rhs, out, depth + 1);
    return out;
  }
  return out;
}

function assignIds(leaves, ids) {
  const byId = new Map();
  const conflicts = [];
  for (const id of ids) {
    const leaf = leaves.find((candidate) => id >= candidate.lo && id < candidate.hi);
    if (!leaf) {
      conflicts.push({ id, reason: 'outside every interval' });
      continue;
    }
    if (leaf.id !== null) {
      conflicts.push({ id, reason: `interval already taken by ${leaf.id}` });
      continue;
    }
    leaf.id = id;
    byId.set(id, leaf);
  }
  const dead = leaves.filter((leaf) => leaf.id === null);
  return { byId, dead, conflicts };
}

module.exports = { extractLeaves, assignIds };

};

__modules["src/vm/cfg.js"] = function(module, exports, require) {
'use strict';

const { Kind } = require("src/lua/ast.js");
const { walk } = require("src/lua/walk.js");
const { unparen, bindingOf } = require("src/vm/detect.js");
const { extractLeaves, assignIds } = require("src/vm/blocks.js");
const { buildBlock, terminator } = require("src/vm/ir.js");

function closureSites(vm) {
  const sites = new Map();
  walk(vm.container.fn, {
    enter: (node) => {
      if (node.kind !== Kind.Call) return undefined;
      const creator = vm.creatorFor
        ? vm.creatorFor(node.base)
        : vm.creators.get(bindingOf(node.base));
      if (!creator) return undefined;
      const first = unparen(node.args[0]);
      if (!first || first.kind !== Kind.Number) return undefined;
      const existing = sites.get(first.value);
      const site = {
        blockId: first.value,
        creator,
        arity: creator.arity,
        vararg: creator.vararg,
        upvalsExpression: node.args[1] || null,
        call: node,
      };
      if (existing) existing.push(site);
      else sites.set(first.value, [site]);
      return undefined;
    },
  });
  return sites;
}

function successorIds(term) {
  if (term.kind === 'goto') return [term.target];
  if (term.kind === 'branch') {
    return term.whenFalse === null ? [term.whenTrue] : [term.whenTrue, term.whenFalse];
  }
  return [];
}

function buildGraph(vm) {
  const leaves = extractLeaves(vm);
  const built = leaves.map((leaf) => {
    const block = buildBlock(vm, leaf);
    block.terminator = terminator(block);
    return block;
  });

  const sites = closureSites(vm);
  const ids = new Set([vm.entry.blockId]);
  for (const id of sites.keys()) ids.add(id);
  for (const block of built) for (const id of successorIds(block.terminator)) ids.add(id);

  const assigned = assignIds(leaves, [...ids].sort((a, b) => a - b));
  const nodes = new Map();
  for (const block of built) {
    if (block.leaf.id === null) continue;
    block.id = block.leaf.id;
    block.successors = [];
    block.predecessors = [];
    nodes.set(block.id, block);
  }
  const missing = [];
  for (const block of nodes.values()) {
    for (const id of successorIds(block.terminator)) {
      const target = nodes.get(id);
      if (!target) {
        missing.push({ from: block.id, to: id });
        continue;
      }
      block.successors.push(target);
      target.predecessors.push(block);
    }
  }

  return {
    vm,
    blocks: nodes,
    sites,
    dead: assigned.dead,
    conflicts: assigned.conflicts,
    missing,
    unsupported: built.filter((block) => block.unsupported.length),
    unknown: [...nodes.values()].filter((block) => block.terminator.kind === 'unknown'),
  };
}

function reachable(graph, entryId, stops) {
  const seen = new Set();
  const order = [];
  const entry = graph.blocks.get(entryId);
  if (!entry) return { seen, order };
  const queue = [entry];
  seen.add(entry.id);
  while (queue.length) {
    const block = queue.shift();
    order.push(block);
    for (const next of block.successors) {
      if (seen.has(next.id)) continue;
      if (stops.has(next.id) && next.id !== entryId) continue;
      seen.add(next.id);
      queue.push(next);
    }
  }
  return { seen, order };
}

function reversePostorder(entry, members) {
  const visited = new Set();
  const post = [];
  const stack = [{ block: entry, index: 0 }];
  visited.add(entry.id);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index < frame.block.successors.length) {
      const next = frame.block.successors[frame.index];
      frame.index += 1;
      if (!visited.has(next.id) && members.has(next.id)) {
        visited.add(next.id);
        stack.push({ block: next, index: 0 });
      }
      continue;
    }
    post.push(frame.block);
    stack.pop();
  }
  return post.reverse();
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

function solveLiveness(fn, posKey) {
  for (const block of fn.blocks) {
    block.use = new Set([...block.liveIn].filter((key) => key !== posKey));
    block.def = new Set([...block.written].filter((key) => key !== posKey));
    block.liveInRegs = new Set(block.use);
    block.liveOutRegs = new Set();
  }
  const order = [...fn.blocks].reverse();
  for (let round = 0; round < 10000; round += 1) {
    let changed = false;
    for (const block of order) {
      const out = new Set();
      for (const next of block.successors) {
        if (!fn.members.has(next.id)) continue;
        for (const key of next.liveInRegs) out.add(key);
      }
      const inSet = new Set(block.use);
      for (const key of out) if (!block.def.has(key)) inSet.add(key);
      if (!sameSet(out, block.liveOutRegs) || !sameSet(inSet, block.liveInRegs)) changed = true;
      block.liveOutRegs = out;
      block.liveInRegs = inSet;
    }
    if (!changed) break;
  }
}

function buildCfg(vm) {
  const graph = buildGraph(vm);
  const entryIds = new Set([vm.entry.blockId, ...graph.sites.keys()]);

  const descriptors = [];
  descriptors.push({
    id: vm.entry.blockId,
    kind: 'main',
    arity: vm.entry.arity,
    vararg: vm.entry.vararg,
    site: null,
  });
  for (const [id, sites] of graph.sites) {
    if (id === vm.entry.blockId) continue;
    const site = sites[0];
    descriptors.push({
      id, kind: 'closure', arity: site.arity, vararg: site.vararg, site, sites,
    });
  }

  const functions = [];
  const owner = new Map();
  const shared = [];
  for (const descriptor of descriptors) {
    const entry = graph.blocks.get(descriptor.id);
    if (!entry) {
      graph.missing.push({ from: null, to: descriptor.id });
      continue;
    }
    const { seen } = reachable(graph, descriptor.id, entryIds);
    const fn = {
      ...descriptor,
      entry,
      members: seen,
      blocks: reversePostorder(entry, seen),
    };
    for (const id of seen) {
      const previous = owner.get(id);
      if (previous !== undefined && previous !== descriptor.id) {
        shared.push({ block: id, functions: [previous, descriptor.id] });
        continue;
      }
      owner.set(id, descriptor.id);
    }
    solveLiveness(fn, vm.posKey);
    functions.push(fn);
  }

  const orphans = [...graph.blocks.keys()].filter((id) => !owner.has(id));
  return { ...graph, functions, owner, shared, orphans };
}

module.exports = { reversePostorder, buildCfg };

};

__modules["src/vm/detect.js"] = function(module, exports, require) {
'use strict';

const { Kind, unparen } = require("src/lua/ast.js");
const { walk, children, collect } = require("src/lua/walk.js");

const isName = (node) => !!node && node.kind === Kind.Name;
const bindingOf = (node) => {
  const inner = unparen(node);
  return isName(inner) ? inner.binding || null : null;
};

function parentMap(root) {
  const parents = new Map();
  walk(root, {
    enter(node, info) {
      if (info) parents.set(node, info.parent);
      return undefined;
    },
  });
  return parents;
}

function valueFlow(chunk) {
  const writes = new Map();
  const moves = new Map();
  const record = (binding, value) => {
    if (!binding) return;
    const list = writes.get(binding) || [];
    list.push(value || null);
    writes.set(binding, list);
    const source = value ? bindingOf(value) : null;
    if (!source) return;
    const targets = moves.get(source) || [];
    targets.push(binding);
    moves.set(source, targets);
  };
  walk(chunk, {
    enter(node) {
      if (node.kind === Kind.Assignment) {
        const targets = node.targets || [];
        const expressions = node.expressions || [];
        const aligned = targets.length === expressions.length;
        targets.forEach((target, at) => {
          record(bindingOf(target), aligned ? expressions[at] : null);
        });
      } else if (node.kind === Kind.LocalDeclaration) {
        const expressions = node.expressions || [];

        if (!expressions.length) return undefined;
        const aligned = expressions.length === (node.names || []).length;
        (node.bindings || []).forEach((binding, at) => {
          record(binding, aligned ? expressions[at] : null);
        });
      } else if (node.kind === Kind.LocalFunction) record(node.binding, node.body);
      else if (node.kind === Kind.NumericFor) record(node.binding, null);
      else if (node.kind === Kind.GenericFor) {
        for (const binding of node.bindings || []) record(binding, null);
      }
      return undefined;
    },
  });
  return { writes, moves };
}

function carriersOf(target, flow) {
  if (!flow || !target) return null;
  if (!flow.carriers) flow.carriers = new Map();
  const known = flow.carriers.get(target);
  if (known) return known;
  const found = new Set([target]);
  const queue = [target];
  while (queue.length) {
    const at = queue.pop();
    for (const holder of flow.moves.get(at) || []) {
      if (found.has(holder)) continue;
      found.add(holder);
      queue.push(holder);
    }
  }
  flow.carriers.set(target, found);
  return found;
}

function carriesBinding(binding, target, flow) {
  if (!binding) return false;
  if (binding === target) return true;
  const found = carriersOf(target, flow);
  return !!found && found.has(binding);
}

function carries(node, target, flow) {
  return carriesBinding(bindingOf(node), target, flow);
}

function carrierTest(target, flow) {
  if (!target) return () => false;
  return (node) => carriesBinding(bindingOf(node), target, flow);
}

function carrierSet(targets, flow) {
  const list = [...targets].filter(Boolean);
  if (!list.length) return () => false;
  return (node) => {
    const binding = bindingOf(node);
    if (!binding) return false;
    return list.some((target) => carriesBinding(binding, target, flow));
  };
}

function mayHold(node, kind, flow, seen = new Set()) {
  const value = unparen(node);
  if (!value) return false;
  if (value.kind === kind) return true;
  const binding = bindingOf(value);
  if (!binding || !flow || seen.has(binding)) return false;
  seen.add(binding);
  for (const written of flow.writes.get(binding) || []) {
    if (written && mayHold(written, kind, flow, seen)) return true;
  }
  return false;
}

function throughCopy(binding, flow) {
  let current = binding;
  for (let guard = 0; flow && current && guard < 8; guard += 1) {
    if ((current.reads || []).length !== 1) break;
    const targets = flow.moves.get(current) || [];
    if (targets.length !== 1) break;
    const written = flow.writes.get(targets[0]) || [];
    if (written.length !== 1 || !written[0]) break;
    current = targets[0];
  }
  return current;
}

function throughSource(binding, flow) {
  let current = binding;
  for (let guard = 0; flow && current && guard < 8; guard += 1) {
    const written = flow.writes.get(current) || [];
    if (written.length !== 1 || !written[0]) break;
    const source = bindingOf(written[0]);
    if (!source || source === current) break;
    current = source;
  }
  return current;
}

const ROLES = [
  ['env', ['getfenv', '_ENV', 'getfenv2']],
  ['unpack', ['unpack']],
  ['newproxy', ['newproxy']],
  ['setmetatable', ['setmetatable']],
  ['getmetatable', ['getmetatable']],
  ['select', ['select']],
];

function globalsUsed(node) {
  const names = new Set();
  walk(node, {
    enter(inner) {
      if (inner.kind === Kind.Name && inner.binding && inner.binding.kind === 'global') {
        names.add(inner.binding.name);
      }
      return undefined;
    },
  });
  return names;
}

function classifyValue(node) {
  const inner = unparen(node);
  if (!inner) return null;

  if (inner.kind === Kind.Table) return 'varargs';
  const globals = globalsUsed(inner);
  for (const [role, candidates] of ROLES) {
    for (const candidate of candidates) {
      if (globals.has(candidate)) return role;
    }
  }

  if (globals.has('table')) return 'unpack';
  return null;
}

function classifyArgument(node, flow) {
  const direct = classifyValue(node);
  if (direct) return direct;
  const binding = bindingOf(unparen(node));
  if (!binding || !flow) return null;
  const seen = new Set([binding]);
  const pending = [binding];
  while (pending.length) {
    const current = pending.shift();
    const written = flow.writes.get(current) || [];
    for (let i = written.length - 1; i >= 0; i -= 1) {
      const value = written[i];
      if (!value) continue;
      const role = classifyValue(value);
      if (role) return role;
      const source = bindingOf(value);
      if (source && !seen.has(source)) {
        seen.add(source);
        pending.push(source);
      }
    }
  }
  return null;
}

function readsVarargs(fn) {
  if (!fn || !fn.isVararg) return false;
  let found = false;
  walk(fn.body, {
    enter(node) {
      if (found) return false;
      if (node.kind === Kind.Function) return false;
      if (node.kind === Kind.Vararg) found = true;
      return undefined;
    },
  });
  return found;
}

function spreadsVarargs(node) {
  const table = unparen(node);
  if (!table || table.kind !== Kind.Table) return false;
  return (table.entries || []).some((entry) => (
    !entry.key && entry.value && unparen(entry.value).kind === Kind.Vararg));
}

function matchContainer(fn, flow) {
  if (!fn || fn.kind !== Kind.Function || readsVarargs(fn)) return null;
  if (!fn.params || fn.params.length !== 4 || !fn.bindings) return null;
  const statements = fn.body.statements;
  if (statements.length < 2) return null;

  const candidates = new Set([fn.bindings[0]]);
  for (const moved of (flow && flow.moves.get(fn.bindings[0])) || []) candidates.add(moved);
  let loopIndex = -1;
  for (let i = 0; i < statements.length; i += 1) {
    const statement = statements[i];
    if (statement.kind === Kind.While && candidates.has(bindingOf(statement.condition))) {
      loopIndex = i;
      break;
    }
  }
  if (loopIndex < 0) return null;
  const pos = bindingOf(statements[loopIndex].condition);

  const declared = new Set();
  const registers = [];
  let spill = null;
  for (let i = 0; i < loopIndex; i += 1) {
    const statement = statements[i];
    if (statement.kind === Kind.LocalDeclaration && statement.bindings) {
      const expressions = statement.expressions || [];
      for (let k = 0; k < statement.bindings.length; k += 1) {
        const binding = statement.bindings[k];
        declared.add(binding);
        const initializer = unparen(expressions[k]);
        if (initializer && initializer.kind === Kind.Table) spill = binding;
        else registers.push(binding);
      }
      continue;
    }
    if (statement.kind === Kind.Assignment) {
      const targets = statement.targets || [];
      const expressions = statement.expressions || [];
      if (targets.length !== expressions.length) return null;
      for (let k = 0; k < targets.length; k += 1) {
        const binding = bindingOf(targets[k]);
        if (!binding || !declared.has(binding)) return null;
        const value = unparen(expressions[k]);
        if (value && value.kind === Kind.Table) spill = binding;
      }
      continue;
    }
    return null;
  }

  const last = statements[statements.length - 1];
  if (!last || last.kind !== Kind.Return || last.expressions.length !== 1) return null;
  const call = unparen(last.expressions[0]);
  if (!call || call.kind !== Kind.Call || call.args.length !== 1) return null;
  const unpackBinding = bindingOf(call.base);
  const returnBinding = bindingOf(call.args[0]);
  if (!unpackBinding || !returnBinding) return null;

  const args = throughCopy(fn.bindings[1], flow);
  const upvals = throughCopy(fn.bindings[2], flow);
  const gcDetect = throughCopy(fn.bindings[3], flow);
  const reserved = new Set([spill, args, upvals, gcDetect]);

  return {
    fn,
    dispatch: statements[loopIndex],
    registers: registers.filter((binding) => !reserved.has(binding)),
    spill,
    unpackBinding,
    returnRegister: returnBinding,
    pos,
    args,
    upvals,
    gcDetect,
  };
}

function matchClosureCreator(fn, containerBinding, flow) {
  if (!fn || fn.kind !== Kind.Function || readsVarargs(fn)) return null;
  if (!fn.params || fn.params.length !== 2 || !fn.bindings) return null;
  const [idParam, upvalsParam] = fn.bindings;
  let found = null;
  walk(fn.body, {
    enter(node) {
      if (node.kind !== Kind.Function) return undefined;
      const body = node.body.statements;

      const tail = body[body.length - 1];
      if (!tail || tail.kind !== Kind.Return || tail.expressions.length !== 1) return undefined;
      const call = unparen(tail.expressions[0]);
      if (!call || call.kind !== Kind.Call || call.args.length !== 4) return undefined;
      if (!carries(call.base, containerBinding, flow)) return undefined;
      if (!carries(call.args[0], idParam, flow)) return undefined;
      if (!carries(call.args[2], upvalsParam, flow)) return undefined;
      if (!mayHold(call.args[1], Kind.Table, flow)) return undefined;
      found = { inner: node, table: call.args[1], gcExpression: call.args[3] };
      return false;
    },
  });
  if (!found) return null;

  let proxyBinding = null;
  walk(fn.body, {
    enter(node) {
      if (proxyBinding) return false;
      if (node.kind !== Kind.Call || node.args.length !== 1) return undefined;
      if (!carries(node.args[0], upvalsParam, flow)) return undefined;
      proxyBinding = bindingOf(node.base);
      return undefined;
    },
  });

  return {
    fn,
    arity: (found.inner.params || []).length,

    vararg: spreadsVarargs(found.table),
    proxyBinding,
  };
}

function matchAllocUpvalue(fn) {
  if (!fn || fn.kind !== Kind.Function || readsVarargs(fn)) return null;
  if ((fn.params || []).length !== 0) return null;
  const statements = fn.body.statements;
  if (statements.length !== 3) return null;
  const [bump, seed, ret] = statements;
  if (bump.kind !== Kind.Assignment || bump.targets.length !== 1) return null;
  const counter = bindingOf(bump.targets[0]);
  if (!counter) return null;
  const sum = unparen(bump.expressions[0]);
  if (!sum || sum.kind !== Kind.Binary || sum.operator !== '+') return null;
  const operands = [bindingOf(sum.lhs), bindingOf(sum.rhs)];
  if (!operands.includes(counter)) return null;
  if (seed.kind !== Kind.Assignment || seed.targets.length !== 1) return null;
  const slot = unparen(seed.targets[0]);
  if (!slot || slot.kind !== Kind.Index || bindingOf(slot.index) !== counter) return null;
  const refs = bindingOf(slot.base);
  if (!refs) return null;
  if (ret.kind !== Kind.Return || bindingOf(ret.expressions[0]) !== counter) return null;
  return { counter, refs };
}

function findUpvalueTable(root, refs, flow) {
  const clears = [];
  walk(root, {
    enter(node) {
      if (node.kind !== Kind.Assignment) return undefined;
      if (!node.expressions.every((expression) => unparen(expression).kind === Kind.Nil)) {
        return undefined;
      }
      for (const target of node.targets || []) {
        const inner = unparen(target);
        if (!inner || inner.kind !== Kind.Index) continue;
        const base = throughSource(bindingOf(inner.base), flow);
        const key = bindingOf(inner.index);
        if (base && key) clears.push({ base, key });
      }
      return undefined;
    },
  });
  const keys = new Set();
  for (const clear of clears) if (clear.base === refs) keys.add(clear.key);
  for (const clear of clears) {
    if (clear.base !== refs && keys.has(clear.key)) return clear.base;
  }
  return null;
}

function findRefHelpers(fns, isRefs, parents) {
  const helpers = new Set();
  for (const fn of fns) {
    let touches = false;
    walk(fn.body, {
      enter(node) {
        if (node.kind !== Kind.Assignment) return undefined;
        for (const target of node.targets || []) {
          const slot = unparen(target);
          if (slot && slot.kind === Kind.Index && isRefs(slot.base)) touches = true;
        }
        return undefined;
      },
    });
    if (!touches) continue;
    const binding = bindingForValue(fn, parents);
    if (binding) helpers.add(binding);
  }
  return helpers;
}

function skipParens(node, parents) {
  let current = node;
  let parent = parents.get(current);
  while (parent && parent.kind === Kind.Paren) {
    current = parent;
    parent = parents.get(current);
  }
  return { node: current, parent };
}

function bindingForValue(node, parents) {
  const { node: outer, parent } = skipParens(node, parents);
  if (!parent) return null;
  if (parent.kind === Kind.Assignment) {
    const at = parent.expressions.indexOf(outer);
    if (at < 0) return null;
    return bindingOf(parent.targets[at]);
  }
  if (parent.kind === Kind.LocalDeclaration) {
    const at = parent.expressions.indexOf(outer);
    if (at < 0 || !parent.bindings) return null;
    return parent.bindings[at] || null;
  }
  if (parent.kind === Kind.LocalFunction) return parent.binding || null;
  return null;
}

function enclosingFunction(node, parents) {
  let current = parents.get(node);
  while (current) {
    if (current.kind === Kind.Function) return current;
    current = parents.get(current);
  }
  return null;
}

function subtreeSet(root) {
  const set = new Set();
  walk(root, {
    enter(node) {
      set.add(node);
      return undefined;
    },
  });
  return set;
}

function functionsOutside(root, excluded) {
  const found = [];
  walk(root, {
    enter(node) {
      if (node === excluded) return false;
      if (node.kind === Kind.Function && node !== root) found.push(node);
      return undefined;
    },
  });
  return found;
}

function statementIn(node, parents) {
  let current = node;
  let parent = parents.get(current);
  while (parent && parent.kind !== Kind.Block) {
    current = parent;
    parent = parents.get(current);
  }
  if (!parent) return null;
  const index = parent.statements.indexOf(current);
  return index < 0 ? null : { block: parent, index };
}

function reaches(definition, use, binding, parents) {
  if (!definition || !use || definition.block !== use.block) return false;
  if (use.index <= definition.index) return false;
  for (const write of (binding && binding.writes) || []) {
    const at = statementIn(write, parents);
    if (!at || at.block !== definition.block) continue;
    if (at.index > definition.index && at.index < use.index) return false;
  }
  return true;
}

function callOf(binding, definition, parents) {
  let best = null;
  for (const read of binding.reads || []) {
    const { node, parent: outer } = skipParens(read, parents);
    if (!outer || outer.kind !== Kind.Call || unparen(outer.base) !== node) continue;
    const use = statementIn(read, parents);
    if (!reaches(definition, use, binding, parents)) continue;
    if (!best || use.index < best.index) best = { call: outer, index: use.index };
  }
  return best ? best.call : null;
}

function copiesOf(binding, flow) {
  const found = [];
  const seen = new Set([binding]);
  const stack = [binding];
  while (stack.length && found.length < 16) {
    const current = stack.pop();
    for (const target of (flow && flow.moves.get(current)) || []) {
      if (seen.has(target)) continue;
      seen.add(target);
      if ((flow.writes.get(target) || []).length !== 1) continue;
      found.push(target);
      stack.push(target);
    }
  }
  return found;
}

function definedAt(binding, flow, parents) {
  const written = (flow && flow.writes.get(binding)) || [];
  if (written.length !== 1 || !written[0]) return null;
  return statementIn(written[0], parents);
}

function findWrapperCall(wrapper, parents, flow) {
  const { parent } = skipParens(wrapper, parents);
  if (parent && parent.kind === Kind.Call && unparen(parent.base) === wrapper) return parent;
  const binding = bindingForValue(wrapper, parents);
  if (!binding) return null;
  const definition = statementIn(wrapper, parents);
  if (!definition) return null;
  const direct = callOf(binding, definition, parents);
  if (direct) return direct;
  for (const alias of copiesOf(binding, flow)) {
    const at = definedAt(alias, flow, parents);
    const call = at ? callOf(alias, at, parents) : null;
    if (call) return call;
  }
  return null;
}

function indexBases(root) {
  const counts = new Map();
  walk(root, {
    enter(node) {
      if (node.kind !== Kind.Index) return undefined;
      const binding = bindingOf(node.base);
      if (binding) counts.set(binding, (counts.get(binding) || 0) + 1);
      return undefined;
    },
  });
  return counts;
}

function environmentBinding(container, claimed) {
  const own = new Set([
    container.spill, container.pos, container.args, container.upvals, container.gcDetect,
    ...container.registers, ...(container.fn.bindings || []),
  ]);
  let best = null;
  let bestCount = 0;
  for (const [binding, count] of indexBases(container.fn)) {
    if (own.has(binding) || claimed.has(binding)) continue;
    if (count > bestCount) {
      best = binding;
      bestCount = count;
    }
  }
  return best;
}

function describe(container, parents, flow) {
  const wrapper = enclosingFunction(container.fn, parents);
  if (!wrapper) return { ok: false, reason: 'container is not wrapped' };

  const wrapperCall = findWrapperCall(wrapper, parents, flow);
  if (!wrapperCall) return { ok: false, reason: 'wrapper is not invoked' };

  const containerBinding = bindingForValue(container.fn, parents);
  if (!containerBinding) return { ok: false, reason: 'container is not bound to a name' };

  const roles = {};
  for (let i = 0; i < wrapperCall.args.length; i += 1) {
    const role = classifyArgument(wrapperCall.args[i], flow);
    const binding = (wrapper.bindings || [])[i];
    if (role && binding && !roles[role]) roles[role] = throughCopy(binding, flow);
  }

  if (!roles.unpack && container.unpackBinding) roles.unpack = container.unpackBinding;

  const inner = functionsOutside(wrapper, container.fn);
  const creators = new Map();
  const creatorFns = new Set();
  let upvalues = null;
  let proxyBinding = null;
  for (const fn of inner) {
    const creator = matchClosureCreator(fn, containerBinding, flow);
    if (creator) {
      creatorFns.add(fn);
      const binding = bindingForValue(fn, parents);
      if (binding) {
        creators.set(binding, creator);
        if (creator.proxyBinding) proxyBinding = creator.proxyBinding;
      }
      continue;
    }
    if (!upvalues) {
      const alloc = matchAllocUpvalue(fn);
      if (alloc) {
        upvalues = {
          alloc: bindingForValue(fn, parents),
          counter: alloc.counter,
          refs: alloc.refs,
          table: findUpvalueTable(wrapper, alloc.refs, flow),
        };
      }
    }
  }
  if (creators.size === 0) return { ok: false, reason: 'no closure creator' };

  if (upvalues) {
    upvalues.isAlloc = carrierTest(upvalues.alloc, flow);
    upvalues.isTable = carrierTest(upvalues.table, flow);
    upvalues.isRefs = carrierTest(upvalues.refs, flow);
    upvalues.helpers = findRefHelpers(
      inner.filter((fn) => !creatorFns.has(fn)),
      upvalues.isRefs,
      parents,
    );
    upvalues.isHelper = carrierSet(upvalues.helpers, flow);
  }
  container.isUpvals = carrierTest(container.upvals, flow);

  const creatorFor = (node) => {
    const binding = bindingOf(node);
    if (!binding) return null;
    const direct = creators.get(binding);
    if (direct) return direct;
    for (const [candidate, creator] of creators) {
      if (carriesBinding(binding, candidate, flow)) return creator;
    }
    return null;
  };

  if (!roles.env) {
    const claimed = new Set([
      ...Object.values(roles), ...creators.keys(), proxyBinding,
      upvalues && upvalues.alloc, upvalues && upvalues.counter,
      upvalues && upvalues.refs, upvalues && upvalues.table,
    ]);
    roles.env = environmentBinding(container, claimed);
  }
  if (!roles.env) return { ok: false, reason: 'no environment argument' };

  let entry = null;
  const containerNodes = subtreeSet(container.fn);
  walk(wrapper, {
    enter(node) {
      if (entry || containerNodes.has(node)) return false;
      if (node.kind !== Kind.Call) return undefined;
      const callee = unparen(node.base);
      if (!callee || callee.kind !== Kind.Call) return undefined;
      const creatorBinding = bindingOf(callee.base);
      const creator = creatorFor(callee.base);
      if (!creator) return undefined;
      const id = unparen(callee.args[0]);
      if (!id || id.kind !== Kind.Number) return undefined;
      entry = {
        blockId: id.value,
        creatorBinding,
        vararg: creator.vararg,
        arity: creator.arity,
        upvalsExpression: callee.args[1] || null,
        call: node,
      };
      return false;
    },
  });
  if (!entry) return { ok: false, reason: 'no entry closure' };

  return {
    ok: true,
    vm: {
      wrapper,
      wrapperCall,
      container,
      containerBinding,
      roles,
      creators,
      creatorFor,
      upvalues,
      proxyBinding,
      entry,
    },
  };
}

function detect(chunk) {
  const parents = parentMap(chunk);
  const flow = valueFlow(chunk);
  const found = [];
  const rejected = [];
  for (const fn of collect(chunk, (node) => node.kind === Kind.Function)) {
    const container = matchContainer(fn, flow);
    if (!container) continue;
    const result = describe(container, parents, flow);
    if (result.ok) found.push(result.vm);
    else rejected.push({ fn, reason: result.reason });
  }
  return { instances: found, rejected, parents };
}

module.exports = {
  unparen,
  bindingOf,
  parentMap,
  carries,
  detect,
};

};

__modules["src/vm/dominators.js"] = function(module, exports, require) {
'use strict';

function reversePostorder(entry, succOf) {
  const visited = new Set([entry]);
  const post = [];
  const stack = [{ node: entry, successors: succOf(entry), index: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index < frame.successors.length) {
      const next = frame.successors[frame.index];
      frame.index += 1;
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push({ node: next, successors: succOf(next), index: 0 });
      continue;
    }
    post.push(frame.node);
    stack.pop();
  }
  return post.reverse();
}

function dominators(entry, succOf, predOf) {
  const order = reversePostorder(entry, succOf);
  const index = new Map();
  order.forEach((node, i) => index.set(node, i));
  const idom = new Map([[entry, entry]]);

  const intersect = (a, b) => {
    let left = a;
    let right = b;
    while (left !== right) {
      while (index.get(left) > index.get(right)) left = idom.get(left);
      while (index.get(right) > index.get(left)) right = idom.get(right);
    }
    return left;
  };

  for (let round = 0; round < 10000; round += 1) {
    let changed = false;
    for (const node of order) {
      if (node === entry) continue;
      let candidate = null;
      for (const pred of predOf(node)) {
        if (!index.has(pred) || !idom.has(pred)) continue;
        candidate = candidate === null ? pred : intersect(pred, candidate);
      }
      if (candidate && idom.get(node) !== candidate) {
        idom.set(node, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { idom, order, index };
}

function dominates(idom, ancestor, node) {
  let current = node;
  for (let guard = 0; guard < 100000; guard += 1) {
    if (current === ancestor) return true;
    const next = idom.get(current);
    if (!next || next === current) return false;
    current = next;
  }
  return false;
}

module.exports = { reversePostorder, dominators, dominates };

};

__modules["src/vm/idioms.js"] = function(module, exports, require) {
'use strict';

const A = require("src/lua/ast.js");
const { Kind } = A;
const { walk, transform, collect } = require("src/lua/walk.js");
const { isAlwaysTrue, bare } = require("src/util/flow.js");
const { isIdentifier } = require("src/lua/format.js");

function sameSimple(a, b) {
  const x = bare(a);
  const y = bare(b);
  if (!x || !y || x.kind !== y.kind) return false;
  if (x.kind === Kind.Name) return x.binding ? x.binding === y.binding : x.name === y.name;
  if (x.kind === Kind.Number || x.kind === Kind.String) return x.value === y.value;
  if (x.kind === Kind.Nil || x.kind === Kind.True || x.kind === Kind.False) return true;
  return false;
}

function nameOf(node) {
  const inner = bare(node);
  return inner && inner.kind === Kind.Name ? inner : null;
}

function matchIncrement(statement) {
  if (!statement || statement.kind !== Kind.Assignment) return null;
  const targets = statement.targets || [];
  const expressions = statement.expressions || [];
  if (targets.length !== 1 || expressions.length !== 1) return null;
  const counter = nameOf(targets[0]);
  const sum = bare(expressions[0]);
  if (!counter || !sum || sum.kind !== Kind.Binary || sum.operator !== '+') return null;
  if (!sameSimple(sum.lhs, counter)) return null;
  return { counter, step: sum.rhs };
}

function matchHalf(node, counter) {
  const conjunction = bare(node);
  if (!conjunction || conjunction.kind !== Kind.Binary || conjunction.operator !== 'and') {
    return null;
  }
  const sides = [bare(conjunction.lhs), bare(conjunction.rhs)];
  const compare = sides.find((side) => side && side.kind === Kind.Binary
    && (side.operator === '>=' || side.operator === '<='));
  const flag = sides.find((side) => side !== compare);
  if (!compare || !flag) return null;
  let negated = false;
  let sign = flag;
  if (sign.kind === Kind.Unary && sign.operator === 'not') {
    negated = true;
    sign = bare(sign.argument);
  }
  if (!sign) return null;
  let operator = compare.operator;
  let variable = compare.lhs;
  let limit = compare.rhs;
  if (counter && !sameSimple(variable, counter)) {
    if (!sameSimple(limit, counter)) return null;
    variable = compare.rhs;
    limit = compare.lhs;
    operator = operator === '>=' ? '<=' : '>=';
  }
  const descending = operator === '>=';

  if (sign.kind === Kind.True || sign.kind === Kind.False) {
    const value = sign.kind === Kind.True ? !negated : negated;
    return {
      descending,
      isNeg: A.boolean(descending ? value : !value),
      counter: variable,
      limit,
    };
  }
  if (sign.kind !== Kind.Name) return null;

  if (descending === negated) return null;
  return {
    descending, isNeg: sign, counter: variable, limit,
  };
}

function matchRange(condition, counter) {
  const test = bare(condition);
  if (!test || test.kind !== Kind.Binary || test.operator !== 'or') return null;
  const left = matchHalf(test.lhs, counter);
  const right = matchHalf(test.rhs, counter);
  if (!left || !right) return null;
  if (left.descending === right.descending) return null;
  if (!sameSimple(left.isNeg, right.isNeg)) return null;
  if (!sameSimple(left.counter, right.counter)) return null;
  if (!sameSimple(left.limit, right.limit)) return null;
  return { counter: left.counter, limit: left.limit, isNeg: left.isNeg };
}

function matchExit(statement, counter) {
  if (!statement || statement.kind !== Kind.If) return null;
  if ((statement.elseIfs || []).length || statement.elseBody) return null;
  const body = (statement.body && statement.body.statements) || [];
  if (body.length !== 1 || body[0].kind !== Kind.Break) return null;
  const test = bare(statement.condition);
  if (!test || test.kind !== Kind.Unary || test.operator !== 'not') return null;
  return matchRange(test.argument, counter);
}

function writtenBindings(root) {
  const written = new Set();
  const add = (node) => {
    const inner = bare(node);
    if (inner && inner.kind === Kind.Name && inner.binding) written.add(inner.binding);
  };
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Assignment) (node.targets || []).forEach(add);
      else if (node.kind === Kind.LocalDeclaration) {
        for (const binding of node.bindings || []) written.add(binding);
      } else if (node.kind === Kind.NumericFor) written.add(node.binding);
      else if (node.kind === Kind.GenericFor) {
        for (const binding of node.bindings || []) written.add(binding);
      }
      return undefined;
    },
  });
  return written;
}

function readsBinding(root, binding) {
  let found = false;
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Name && node.binding === binding) found = true;
      return undefined;
    },
  });
  return found;
}

function findStart(statements, at, counter, step) {
  const opening = (value, index) => {
    const difference = bare(value);
    if (!difference) return null;
    if (difference.kind === Kind.Binary && difference.operator === '-'
      && sameSimple(difference.rhs, step)) {
      return { start: difference.lhs, index };
    }

    const increment = bare(step);
    if (difference.kind === Kind.Number && increment && increment.kind === Kind.Number) {
      return { start: A.number(difference.value + increment.value), index };
    }
    return null;
  };
  for (let i = at - 1; i >= 0; i -= 1) {
    const statement = statements[i];
    if (statement.kind === Kind.LocalDeclaration) {
      const bindings = statement.bindings || [];
      const expressions = statement.expressions || [];
      const slot = bindings.indexOf(counter.binding);
      if (slot < 0) continue;
      if (expressions.length !== bindings.length) return null;
      return opening(expressions[slot], i);
    }
    if (statement.kind !== Kind.Assignment) {
      if (writtenBindings(statement).has(counter.binding)) return null;
      continue;
    }
    const targets = statement.targets || [];
    const expressions = statement.expressions || [];
    const writesCounter = targets.some((target) => sameSimple(target, counter));
    if (!writesCounter) continue;
    if (targets.length !== 1 || expressions.length !== 1) return null;
    return opening(expressions[0], i);
  }
  return null;
}

function rebuildNumericFor(block, at) {
  const loop = block.statements[at];
  if (!loop || loop.kind !== Kind.While || !isAlwaysTrue(loop.condition)) return false;
  const body = (loop.body && loop.body.statements) || [];
  if (body.length < 2) return false;
  const increment = matchIncrement(body[0]);
  if (!increment) return false;
  const range = matchExit(body[1], increment.counter);
  if (!range) return false;
  if (!sameSimple(range.counter, increment.counter)) return false;
  if (!increment.counter.binding) return false;

  const rest = A.block(body.slice(2));
  const written = writtenBindings(rest);

  for (const node of [increment.counter, increment.step, range.limit, range.isNeg]) {
    const named = nameOf(node);
    if (named && named.binding && written.has(named.binding)) return false;
  }
  if (range.isNeg.binding && readsBinding(rest, range.isNeg.binding)) return false;

  const flag = bare(range.isNeg);
  const stride = bare(increment.step);
  if (flag && (flag.kind === Kind.True || flag.kind === Kind.False)
    && stride && stride.kind === Kind.Number && (stride.value < 0) !== (flag.kind === Kind.True)) {
    return false;
  }

  const opening = findStart(block.statements, at, increment.counter, increment.step);
  if (!opening) return false;

  let variable = increment.counter;
  const held = rest.statements;
  for (let k = 0; k < held.length; k += 1) {
    const copy = singleAssign(held[k]);
    if (!copy || !sameSimple(copy.value, increment.counter)) continue;
    if (copy.target.binding === increment.counter.binding) break;
    const ahead = A.block(held.slice(0, k));
    const behind = A.block(held.slice(k + 1));
    if (readsBinding(ahead, increment.counter.binding)) break;
    if (readsBinding(behind, increment.counter.binding)) break;
    if (readsBinding(ahead, copy.target.binding)) break;
    if (writtenBindings(ahead).has(copy.target.binding)) break;
    variable = copy.target;
    rest.statements = held.slice(0, k).concat(held.slice(k + 1));
    break;
  }

  for (const binding of new Set([increment.counter.binding, variable.binding])) {
    for (let i = at + 1; i < block.statements.length; i += 1) {
      const statement = block.statements[i];
      if (readsBinding(statement, binding)) return false;
      if (writtenBindings(statement).has(binding)) break;
    }
  }

  block.statements[at] = A.numericFor(
    variable.name,
    opening.start,
    range.limit,
    increment.step,
    rest,
  );
  return true;
}

function lastWriteBefore(statements, at, binding) {
  for (let i = at - 1; i >= 0; i -= 1) {
    if (writtenBindings(statements[i]).has(binding)) return i;
  }
  return -1;
}

function seedingWrite(statement, target) {
  if (!statement) return null;
  if ((statement.expressions || []).length !== 1) return null;
  if (statement.kind === Kind.LocalDeclaration) {
    if ((statement.names || []).length !== 1) return null;
    if ((statement.bindings || [])[0] !== target.binding) return null;
    return { holder: statement, value: statement.expressions[0], declared: true };
  }
  if (statement.kind !== Kind.Assignment) return null;
  if ((statement.targets || []).length !== 1) return null;
  if (!sameSimple(statement.targets[0], target)) return null;
  return { holder: statement, value: statement.expressions[0], declared: false };
}

function fuseConditional(block, at) {
  const statements = block.statements;
  const branch = statements[at];
  if (!branch || branch.kind !== Kind.If) return false;
  if ((branch.elseIfs || []).length || branch.elseBody) return false;
  const body = (branch.body && branch.body.statements) || [];
  if (body.length !== 1) return false;
  const move = body[0];
  if (!move || move.kind !== Kind.Assignment) return false;
  if ((move.targets || []).length !== 1 || (move.expressions || []).length !== 1) return false;
  const target = nameOf(move.targets[0]);
  if (!target || !target.binding) return false;
  const value = bare(move.expressions[0]);
  if (!value || value.kind === Kind.Vararg) return false;
  if (readsBinding(value, target.binding)) return false;

  let condition = bare(branch.condition);
  let operator = 'and';
  if (condition && condition.kind === Kind.Unary && condition.operator === 'not') {
    condition = bare(condition.argument);
    operator = 'or';
  }
  const guard = nameOf(condition);
  if (!guard || !guard.binding) return false;
  if (guard.binding === target.binding) return false;

  const previous = lastWriteBefore(statements, at, target.binding);
  if (previous < 0) return false;
  const seed = seedingWrite(statements[previous], target);
  if (!seed || !sameSimple(seed.value, guard)) return false;
  for (let i = previous + 1; i < at; i += 1) {
    if (writtenBindings(statements[i]).has(guard.binding)) return false;
  }

  const fused = A.binary(operator, A.name(guard.name), value);
  if (seed.declared) {
    if (previous !== at - 1) return false;
    seed.holder.expressions = [fused];
    statements[at] = A.doStatement(A.block([]));
    return true;
  }
  statements[at] = A.assignment([A.name(target.name)], [fused]);
  return true;
}

function restoreMethodCall(node) {
  if (node.kind !== Kind.Call) return null;
  const args = node.args || [];
  if (!args.length) return null;
  const callee = bare(node.base);
  if (!callee || callee.kind !== Kind.Index) return null;
  const key = bare(callee.index);
  if (!key || key.kind !== Kind.String || !isIdentifier(key.value)) return null;
  if (!sameSimple(callee.base, args[0])) return null;
  return A.methodCall(callee.base, key.value, args.slice(1));
}

function singleAssign(statement) {
  if (!statement || statement.kind !== Kind.Assignment) return null;
  const targets = statement.targets || [];
  const expressions = statement.expressions || [];
  if (targets.length !== 1 || expressions.length !== 1) return null;
  const target = nameOf(targets[0]);
  if (!target || !target.binding) return null;
  return { target, value: expressions[0] };
}

function indexAt(node) {
  const key = bare(node);
  if (!key || key.kind !== Kind.Number) return null;
  if (!Number.isInteger(key.value) || key.value < 1) return null;
  return key.value;
}

function settled(node) {
  const named = nameOf(node);
  if (named) return named.binding ? named : null;
  const inner = bare(node);
  return A.isLiteral(inner) ? inner : null;
}

function usage(root) {
  const reads = new Map();
  const writes = new Map();
  const stored = new Set();
  const note = (map, binding, node) => {
    if (!binding) return;
    const list = map.get(binding);
    if (list) list.push(node);
    else map.set(binding, [node]);
  };
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Assignment) {
        for (const target of node.targets || []) {
          const named = bare(target);
          if (named && named.kind === Kind.Name) {
            stored.add(named);
            note(writes, named.binding, node);
          }
        }
      } else if (node.kind === Kind.LocalDeclaration) {
        if ((node.expressions || []).length) {
          for (const binding of node.bindings || []) note(writes, binding, node);
        }
      } else if (node.kind === Kind.NumericFor) note(writes, node.binding, node);
      else if (node.kind === Kind.GenericFor) {
        for (const binding of node.bindings || []) note(writes, binding, node);
      } else if (node.kind === Kind.Name) note(reads, node.binding, node);
      return undefined;
    },
  });
  for (const [binding, list] of reads) {
    reads.set(binding, list.filter((node) => !stored.has(node)));
  }
  return { reads, writes };
}

function countReads(root, binding) {
  let found = 0;
  const stored = new Set();
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Assignment) {
        for (const target of node.targets || []) {
          const named = bare(target);
          if (named && named.kind === Kind.Name) stored.add(named);
        }
      }
      if (node.kind === Kind.Name && node.binding === binding && !stored.has(node)) {
        found += 1;
      }
      return undefined;
    },
  });
  return found;
}

function countWrites(root, binding) {
  let found = 0;
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Assignment) {
        for (const target of node.targets || []) {
          const named = bare(target);
          if (named && named.kind === Kind.Name && named.binding === binding) found += 1;
        }
      } else if (node.kind === Kind.LocalDeclaration && (node.expressions || []).length) {
        for (const held of node.bindings || []) if (held === binding) found += 1;
      } else if (node.kind === Kind.NumericFor) {
        if (node.binding === binding) found += 1;
      } else if (node.kind === Kind.GenericFor) {
        for (const held of node.bindings || []) if (held === binding) found += 1;
      }
      return undefined;
    },
  });
  return found;
}

function spreadCall(block, at, use) {
  const statements = block.statements;
  const pack = singleAssign(statements[at]);
  if (!pack) return false;
  const held = bare(pack.value);
  if (!held || held.kind !== Kind.Table) return false;
  const entries = held.entries || [];
  if (entries.length !== 1 || entries[0].type === 'key') return false;

  const call = entries[0].value;
  if (!call || (call.kind !== Kind.Call && call.kind !== Kind.MethodCall)) return false;
  const holder = pack.target.binding;
  if ((use.writes.get(holder) || []).length !== 1) return false;

  const taken = [];
  for (let i = at + 1; i < statements.length; i += 1) {
    const slot = singleAssign(statements[i]);
    if (!slot) continue;
    const read = bare(slot.value);
    if (!read || read.kind !== Kind.Index) continue;
    const base = nameOf(read.base);
    if (!base || base.binding !== holder) continue;
    const key = indexAt(read.index);
    if (key === null) return false;
    taken.push({ at: i, key, target: slot.target, binding: slot.target.binding });
  }
  if (!taken.length) return false;

  if (countReads(block, holder) !== taken.length) return false;
  if ((use.reads.get(holder) || []).length !== taken.length) return false;

  const keys = new Set(taken.map((slot) => slot.key));
  if (keys.size !== taken.length) return false;
  for (let key = 1; key <= taken.length; key += 1) if (!keys.has(key)) return false;
  const filled = new Set(taken.map((slot) => slot.binding));
  if (filled.size !== taken.length || filled.has(holder)) return false;

  const moving = new Set(taken.map((slot) => slot.at));
  for (let i = at + 1; i < taken[taken.length - 1].at; i += 1) {
    if (moving.has(i)) continue;
    const written = writtenBindings(statements[i]);
    if (written.has(holder)) return false;
    for (const binding of filled) {
      if (written.has(binding) || readsBinding(statements[i], binding)) return false;
    }
  }

  const order = taken.slice().sort((a, b) => a.key - b.key);

  statements[at] = A.assignment(order.map((slot) => slot.target), [call]);

  for (const slot of taken) statements[slot.at] = A.doStatement(A.block([]));
  return true;
}

function matchIterate(statement) {
  if (!statement || statement.kind !== Kind.Assignment) return null;
  const targets = statement.targets || [];
  const expressions = statement.expressions || [];
  if (!targets.length || targets.length > 2 || expressions.length !== 1) return null;
  const call = expressions[0];
  if (!call || call.kind !== Kind.Call) return null;
  const args = call.args || [];
  if (args.length !== 2) return null;
  const ctrl = nameOf(targets[0]);
  if (!ctrl || !ctrl.binding) return null;
  if (!sameSimple(args[1], ctrl)) return null;
  const second = targets.length === 2 ? nameOf(targets[1]) : null;
  if (targets.length === 2 && (!second || !second.binding)) return null;

  const iterator = settled(call.base);
  const state = settled(args[0]);
  if (!iterator || !state) return null;
  return { ctrl, second, iterator, state };
}

function matchNilExit(statement, ctrl) {
  if (!statement || statement.kind !== Kind.If) return false;
  if ((statement.elseIfs || []).length || statement.elseBody) return false;
  const body = (statement.body && statement.body.statements) || [];
  if (body.length !== 1 || body[0].kind !== Kind.Break) return false;
  const test = bare(statement.condition);
  if (!test) return false;
  if (test.kind === Kind.Unary && test.operator === 'not') {
    return sameSimple(test.argument, ctrl);
  }
  if (test.kind === Kind.Binary && test.operator === '==') {
    const empty = bare(test.rhs);
    return !!empty && empty.kind === Kind.Nil && sameSimple(test.lhs, ctrl);
  }
  return false;
}

function collapseTriple(statements, at, wanted, within, use) {
  if (wanted.length !== 3 || wanted.some((binding) => !binding)) return null;
  if (new Set(wanted).size !== 3) return null;
  const source = lastWriteBefore(statements, at, wanted[2]);
  if (source < 0) return null;
  const statement = statements[source];
  if (!statement || statement.kind !== Kind.Assignment) return null;
  const targets = statement.targets || [];
  const expressions = statement.expressions || [];
  if (targets.length !== 3 || expressions.length !== 1) return null;
  const call = expressions[0];
  if (!call || (call.kind !== Kind.Call && call.kind !== Kind.MethodCall)) return null;
  const named = targets.map(nameOf);
  if (named.some((node) => !node || !node.binding)) return null;
  for (let i = 0; i < 3; i += 1) if (named[i].binding !== wanted[i]) return null;

  for (const binding of wanted) {
    const reads = (use.reads.get(binding) || []).length;
    if (!reads || reads !== countReads(within, binding)) return null;
    const writes = (use.writes.get(binding) || []).length;
    if (writes - countWrites(within, binding) !== 1) return null;
  }
  statements[source] = A.doStatement(A.block([]));
  return call;
}

function rebuildGenericFor(block, at, use) {
  const statements = block.statements;
  const loop = statements[at];
  if (!loop || loop.kind !== Kind.While || !isAlwaysTrue(loop.condition)) return false;
  const body = (loop.body && loop.body.statements) || [];
  if (body.length < 2) return false;
  const step = matchIterate(body[0]);
  if (!step) return false;
  if (!matchNilExit(body[1], step.ctrl)) return false;

  let cut = 2;
  let first = step.ctrl;
  const copy = singleAssign(body[2]);
  if (copy && sameSimple(copy.value, step.ctrl) && copy.target.binding !== step.ctrl.binding) {
    first = copy.target;
    cut = 3;
  }
  const rest = A.block(body.slice(cut));
  const written = writtenBindings(rest);
  for (const node of [step.iterator, step.state]) {
    if (node.binding && written.has(node.binding)) return false;
  }

  if (written.has(step.ctrl.binding)) return false;
  if (first !== step.ctrl && readsBinding(rest, step.ctrl.binding)) return false;
  if (step.second && step.second.binding === step.ctrl.binding) return false;

  const scoped = [step.ctrl.binding, first.binding];
  if (step.second) scoped.push(step.second.binding);
  for (const binding of scoped) {
    for (let i = at + 1; i < statements.length; i += 1) {
      if (readsBinding(statements[i], binding)) return false;
      if (writtenBindings(statements[i]).has(binding)) break;
    }
  }

  const variables = [first.name];
  if (step.second) variables.push(step.second.name);

  const wanted = [step.iterator.binding, step.state.binding, step.ctrl.binding];
  const packed = collapseTriple(statements, at, wanted, loop, use);
  const expressions = packed
    ? [packed]
    : [step.iterator, step.state, A.name(step.ctrl.name)];
  statements[at] = A.genericFor(variables, expressions, rest);
  return true;
}

function spreadAll(block, at, use) {
  const statements = block.statements;
  const pack = singleAssign(statements[at]);
  if (!pack) return false;
  const held = bare(pack.value);
  if (!held || held.kind !== Kind.Table) return false;
  const entries = held.entries || [];
  if (entries.length !== 1 || entries[0].type === 'key') return false;
  const call = entries[0].value;
  if (!call || (call.kind !== Kind.Call && call.kind !== Kind.MethodCall)) return false;
  const binding = pack.target.binding;
  if ((use.writes.get(binding) || []).length !== 1) return false;
  if ((use.reads.get(binding) || []).length !== 1) return false;

  let spreadAt = -1;
  let spread = null;
  for (let i = at + 1; i < statements.length; i += 1) {
    const found = findSpread(statements[i], binding);
    if (!found) continue;
    spreadAt = i;
    spread = found;
    break;
  }
  if (!spread) return false;
  if (countReads(statements[spreadAt], binding) !== 1) return false;

  const reads = readBindings(call);
  for (let i = at + 1; i < spreadAt; i += 1) {
    if (!movable(statements[i])) return false;
    for (const written of writtenBindings(statements[i])) {
      if (reads.has(written)) return false;
    }
  }

  let done = false;
  statements[spreadAt] = transform(statements[spreadAt], (node) => {
    if (done || node !== spread) return node;
    done = true;
    return call;
  });
  if (!done) return false;
  statements[at] = A.doStatement(A.block([]));
  return true;
}

function globalRead(node, name) {
  const inner = bare(node);
  if (!inner) return false;
  if (inner.kind === Kind.Name) {
    if (inner.name !== name) return false;
    return !inner.binding || inner.binding.kind === 'global';
  }
  if (inner.kind !== Kind.Index) return false;
  const key = bare(inner.index);
  if (!key || key.kind !== Kind.String || key.value !== name) return false;
  const base = bare(inner.base);
  if (!base || base.kind !== Kind.Name) return false;
  if (base.binding && base.binding.kind !== 'global') return false;
  return base.name === '_ENV' || base.name === '_G';
}

function spreadsTable(node) {
  if (globalRead(node, 'unpack')) return true;
  const inner = bare(node);
  if (!inner || inner.kind !== Kind.Index) return false;
  const key = bare(inner.index);
  if (!key || key.kind !== Kind.String || key.value !== 'unpack') return false;
  return globalRead(inner.base, 'table');
}

function readBindings(root) {
  const found = new Set();
  walk(root, {
    enter(node) {
      if (node.kind === Kind.Name && node.binding) found.add(node.binding);
      return undefined;
    },
  });
  return found;
}

function movable(statement) {
  if (!statement) return false;
  if (statement.kind === Kind.Do) {
    return !((statement.body && statement.body.statements) || []).length;
  }
  if (statement.kind !== Kind.Assignment) return false;
  for (const target of statement.targets || []) {
    const named = bare(target);
    if (!named || named.kind !== Kind.Name || !named.binding) return false;
  }
  for (const expression of statement.expressions || []) {
    const inner = bare(expression);
    if (!inner) return false;
    if (inner.kind === Kind.Function || A.isLiteral(inner)) continue;
    if (inner.kind === Kind.Name && inner.binding) continue;
    return false;
  }
  return true;
}

function findSpread(statement, binding) {
  let found = null;
  let several = false;
  walk(statement, {
    enter(node) {
      if (node.kind !== Kind.Call) return undefined;
      if (!spreadsTable(node.base)) return undefined;
      const args = node.args || [];
      if (args.length !== 1) return undefined;
      const named = nameOf(args[0]);
      if (!named || named.binding !== binding) return undefined;
      if (found) several = true;
      found = node;
      return undefined;
    },
  });
  return several ? null : found;
}

function collapseHeader(block, at, use) {
  const loop = block.statements[at];
  if (!loop || loop.kind !== Kind.GenericFor) return false;
  const expressions = loop.expressions || [];
  if (expressions.length !== 3) return false;
  const named = expressions.map(nameOf);
  if (named.some((node) => !node || !node.binding)) return false;
  const wanted = named.map((node) => node.binding);
  const packed = collapseTriple(block.statements, at, wanted, loop, use);
  if (!packed) return false;
  loop.expressions = [packed];
  return true;
}

function headerSlots(loop) {
  if (!loop) return null;
  if (loop.kind === Kind.NumericFor) {
    return ["start", "limit", "step"].map((key) => ({
      read: () => loop[key],
      write: (value) => { loop[key] = value; },
      last: false,
    }));
  }
  if (loop.kind === Kind.GenericFor) {
    const count = (loop.expressions || []).length;
    return (loop.expressions || []).map((ignored, index) => ({
      read: () => loop.expressions[index],
      write: (value) => { loop.expressions[index] = value; },
      last: index === count - 1,
    }));
  }
  return null;
}

function statementAbove(statements, at) {
  for (let i = at - 1; i >= 0; i -= 1) {
    const statement = statements[i];
    if (statement.kind !== Kind.Do) return i;
    if (((statement.body && statement.body.statements) || []).length) return i;
  }
  return -1;
}

function inlineHeader(block, at, use) {
  const statements = block.statements;
  const loop = statements[at];
  const slots = headerSlots(loop);
  if (!slots) return false;
  let rebuilt = false;
  for (let round = 0; round < slots.length; round += 1) {
    const above = statementAbove(statements, at);
    if (above < 0) break;
    const assign = singleAssign(statements[above]);
    if (!assign) break;
    const holder = assign.target.binding;
    if ((use.reads.get(holder) || []).length !== 1) break;
    if (countReads(loop, holder) !== 1) break;
    if ((use.writes.get(holder) || []).length !== 1) break;
    if (countWrites(loop, holder) !== 0) break;
    const slot = slots.find((one) => {
      const named = nameOf(one.read());
      return !!named && named.binding === holder;
    });
    if (!slot) break;
    if (slot.last && A.isMultiValue(bare(assign.value))) break;
    slot.write(assign.value);
    statements[above] = A.doStatement(A.block([]));
    rebuilt = true;
  }
  return rebuilt;
}

function copyValue(node) {
  if (Array.isArray(node)) return node.map(copyValue);
  if (!node || typeof node !== 'object') return node;
  const copy = {};
  for (const key of Object.keys(node)) {
    if (key === 'binding' || key === 'bindings' || key === 'declaration') copy[key] = node[key];
    else copy[key] = copyValue(node[key]);
  }
  return copy;
}

function packedItems(node) {
  if (!node) return null;
  const inner = bare(node);
  if (!inner || inner.kind !== Kind.Table) return null;
  const entries = inner.entries || [];
  if (!entries.length) return null;
  const items = [];
  for (const entry of entries) {
    if (entry.type !== 'item') return null;
    items.push(entry.value);
  }
  return items;
}

function spreadArgument(node) {
  if (!node || node.kind !== Kind.Call) return null;
  if (!spreadsTable(node.base)) return null;
  const args = node.args || [];
  return args.length === 1 ? args[0] : null;
}

function selectParts(node) {
  if (!node || node.kind !== Kind.Call) return null;
  if (!globalRead(node.base, 'select')) return null;
  const args = node.args || [];
  if (args.length !== 2) return null;
  const index = bare(args[0]);
  if (!index || index.kind !== Kind.Number) return null;
  if (!Number.isInteger(index.value) || index.value < 1) return null;
  return { skip: index.value - 1, values: args[1] };
}

function droppable(node) {
  const inner = bare(node);
  if (!inner) return false;
  return inner.kind === Kind.Name || A.isLiteral(inner);
}

function varargPack(items) {
  if (!items || !items.length) return false;
  if (!A.isMultiValue(items[items.length - 1])) return false;
  for (let i = 0; i < items.length - 1; i += 1) {
    if (!droppable(items[i])) return false;
  }
  return true;
}

function passVarargs(node) {
  const spread = spreadArgument(node);
  if (spread) {
    const items = packedItems(spread);

    if (!items || items.length !== 1 || !varargPack(items)) return null;
    return items[0];
  }
  const parts = selectParts(node);
  if (!parts) return null;

  if (!parts.skip) return A.isMultiValue(parts.values) ? parts.values : null;
  const items = packedItems(spreadArgument(parts.values));
  if (!items || !varargPack(items)) return null;

  if (items.length !== parts.skip + 1) return null;
  return items[items.length - 1];
}

function carriesVarargs(items) {
  if (!items || items.length !== 1) return false;
  const inner = bare(items[0]);
  return !!inner && inner.kind === Kind.Vararg;
}

function ownersOf(root, wanted) {
  const owners = new Map();
  const stack = [root];
  walk(root, {
    enter(node) {
      if (wanted.has(node)) owners.set(node, stack[stack.length - 1]);
      if (node.kind === Kind.Function) stack.push(node);
      return undefined;
    },
    leave(node) {
      if (node.kind === Kind.Function) stack.pop();
    },
  });
  return owners;
}

function inlineVarargPack(root, statements, at, use) {
  const assign = singleAssign(statements[at]);
  if (!assign) return false;
  const holder = assign.target.binding;
  if (!holder) return false;
  const packed = bare(assign.value);
  const items = packedItems(packed);
  if (!carriesVarargs(items)) return false;
  const writes = use.writes.get(holder) || [];
  if (writes.length !== 1 || writes[0] !== statements[at]) return false;
  const reads = use.reads.get(holder) || [];
  if (!reads.length) return false;
  const spreads = collect(root, (node) => {
    const inner = bare(spreadArgument(node));
    return !!inner && inner.kind === Kind.Name && inner.binding === holder;
  });

  if (spreads.length !== reads.length) return false;

  const owners = ownersOf(root, new Set([statements[at]].concat(spreads)));
  const home = owners.get(statements[at]);
  if (!home) return false;
  for (const spread of spreads) {
    if (owners.get(spread) !== home) return false;
  }
  transform(root, (node) => {
    if (spreads.indexOf(node) < 0) return node;
    return A.call(node.base, [copyValue(packed)]);
  });

  statements[at] = A.doStatement(A.block([]));
  return true;
}

function run(context, counters) {
  let rebuilt = 0;
  walk(context.chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;

      for (let i = 0; i < node.statements.length; i += 1) {
        if (fuseConditional(node, i)) rebuilt += 1;
      }
      for (let i = 0; i < node.statements.length; i += 1) {
        if (rebuildNumericFor(node, i)) rebuilt += 1;
      }
      return undefined;
    },
  });

  const packs = usage(context.chunk);
  walk(context.chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      for (let i = 0; i < node.statements.length; i += 1) {
        if (spreadAll(node, i, packs)) rebuilt += 1;
      }
      for (let i = 0; i < node.statements.length; i += 1) {
        if (spreadCall(node, i, packs)) rebuilt += 1;
      }
      return undefined;
    },
  });
  const spread = usage(context.chunk);
  walk(context.chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      for (let i = 0; i < node.statements.length; i += 1) {
        if (rebuildGenericFor(node, i, spread)) rebuilt += 1;
      }
      for (let i = 0; i < node.statements.length; i += 1) {
        if (inlineHeader(node, i, spread)) rebuilt += 1;
      }
      for (let i = 0; i < node.statements.length; i += 1) {
        if (collapseHeader(node, i, spread)) rebuilt += 1;
      }
      return undefined;
    },
  });

  const carried = usage(context.chunk);
  const packed = [];
  walk(context.chunk, {
    enter(node) {
      if (node.kind !== Kind.Block) return undefined;
      for (let i = 0; i < node.statements.length; i += 1) packed.push([node.statements, i]);
      return undefined;
    },
  });
  for (const [statements, at] of packed) {
    if (inlineVarargPack(context.chunk, statements, at, carried)) rebuilt += 1;
  }

  transform(context.chunk, (node) => {
    const passed = passVarargs(node);
    if (passed) {
      rebuilt += 1;
      return passed;
    }
    const method = restoreMethodCall(node);
    if (!method) return node;
    rebuilt += 1;
    return method;
  });
  if (counters) counters.idioms += rebuilt;
  return rebuilt;
}

module.exports = { run, usage, movable };

};

__modules["src/vm/ir.js"] = function(module, exports, require) {
'use strict';

const { Kind, isMultiValue } = require("src/lua/ast.js");
const { CHILDREN } = require("src/lua/walk.js");
const { unparen, bindingOf } = require("src/vm/detect.js");

const REF = 'VmRef';
const LIVE = 'VmLive';

const ref = (index, slot) => ({ kind: REF, index, slot });
const live = (reg) => ({ kind: LIVE, reg });

function mapNode(node, fn) {
  const spec = CHILDREN[node.kind];
  const copy = { ...node };
  if (!spec) return copy;
  for (const key of Object.keys(spec)) {
    const type = spec[key];
    const value = node[key];
    if (value === undefined || value === null) continue;
    if (type === 'node') copy[key] = fn(value);
    else if (type === 'list') copy[key] = value.map(fn);
    else if (type === 'clauses') {
      copy[key] = value.map((clause) => ({
        ...clause,
        condition: fn(clause.condition),
        body: fn(clause.body),
      }));
    } else if (type === 'entries') {
      copy[key] = value.map((entry) => ({
        ...entry,
        key: entry.key ? fn(entry.key) : entry.key,
        value: fn(entry.value),
      }));
    }
  }
  return copy;
}

function registerSet(vm) {
  if (!vm.regSet) {
    vm.regSet = new Set(vm.container.registers);
    vm.regSet.add(vm.container.pos);
    vm.posKey = `r${vm.container.pos.id}`;
    vm.returnKey = `r${vm.container.returnRegister.id}`;
  }
  return vm.regSet;
}

function registerKey(vm, node) {
  const inner = unparen(node);
  if (!inner) return null;
  if (inner.kind === Kind.Name) {
    const binding = inner.binding;
    return binding && registerSet(vm).has(binding) ? `r${binding.id}` : null;
  }
  if (inner.kind === Kind.Index && vm.container.spill) {
    if (bindingOf(inner.base) !== vm.container.spill) return null;
    const key = unparen(inner.index);
    if (key && key.kind === Kind.Number) return `s${key.value}`;
    return null;
  }
  return null;
}

function isAlias(vm, target) {
  const binding = bindingOf(target);
  if (!binding) return false;
  const { args, upvals, gcDetect } = vm.container;
  return binding === args || binding === upvals || binding === gcDetect;
}

function isAliasMove(vm, statement) {
  return statement.targets.length === 1 && isAlias(vm, statement.targets[0]);
}

function isCalling(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.kind === Kind.Call || node.kind === Kind.MethodCall) return true;
  const spec = CHILDREN[node.kind];
  if (!spec) return false;
  for (const key of Object.keys(spec)) {
    const type = spec[key];
    const value = node[key];
    if (value === undefined || value === null) continue;
    if (type === 'node') {
      if (isCalling(value)) return true;
    } else if (type === 'list') {
      for (const child of value) if (isCalling(child)) return true;
    } else if (type === 'clauses') {
      for (const clause of value) {
        if (isCalling(clause.condition) || isCalling(clause.body)) return true;
      }
    } else if (type === 'entries') {
      for (const entry of value) {
        if ((entry.key && isCalling(entry.key)) || isCalling(entry.value)) return true;
      }
    }
  }
  return false;
}

function isOrdered(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.kind === Kind.Call || node.kind === Kind.MethodCall) return true;
  if (node.kind === Kind.Index) return true;
  const spec = CHILDREN[node.kind];
  if (!spec) return false;
  for (const key of Object.keys(spec)) {
    const type = spec[key];
    const value = node[key];
    if (value === undefined || value === null) continue;
    if (type === 'node') {
      if (isOrdered(value)) return true;
    } else if (type === 'list') {
      for (const child of value) if (isOrdered(child)) return true;
    } else if (type === 'clauses') {
      for (const clause of value) {
        if (isOrdered(clause.condition) || isOrdered(clause.body)) return true;
      }
    } else if (type === 'entries') {
      for (const entry of value) {
        if ((entry.key && isOrdered(entry.key)) || isOrdered(entry.value)) return true;
      }
    }
  }
  return false;
}

function buildBlock(vm, leaf) {
  registerSet(vm);
  const statements = [];
  const version = new Map();
  const liveIn = new Set();
  const written = new Set();
  const unsupported = [];

  const readRegister = (key) => {
    const at = version.get(key);
    if (at) return ref(at.index, at.slot);
    if (!written.has(key)) liveIn.add(key);
    return live(key);
  };

  const substitute = (node) => {
    if (!node || typeof node !== 'object') return node;
    const key = registerKey(vm, node);
    if (key) return readRegister(key);
    if (node.kind === Kind.Paren) {
      const inner = substitute(node.expression);
      if (isMultiValue(unparen(node)) && inner && typeof inner === 'object') {
        inner.truncated = true;
      }
      return inner;
    }
    return mapNode(node, substitute);
  };

  for (const source of leaf.statements) {
    if (source.kind === Kind.CallStatement) {
      statements.push({
        index: statements.length,
        targets: [],
        exprs: [substitute(source.expression)],
        ordered: true,
        source,
      });
      continue;
    }
    if (source.kind !== Kind.Assignment) {
      unsupported.push(source);
      continue;
    }
    if (isAliasMove(vm, source)) continue;

    const exprs = source.expressions.map(substitute);
    const targets = source.targets.map((target) => {
      const key = registerKey(vm, target);
      if (key) return { reg: key, node: null };
      const inner = unparen(target);
      if (inner.kind === Kind.Index) {
        return {
          reg: null,
          node: { ...inner, base: substitute(inner.base), index: substitute(inner.index) },
        };
      }
      return { reg: null, node: { ...inner } };
    });
    const split = targets.length > 1 && exprs.length === targets.length;
    const parts = split
      ? targets.map((target, at) => ({ targets: [target], exprs: [exprs[at]], at }))
      : [{ targets, exprs, at: -1 }];
    for (const part of parts) {
      if (part.at >= 0 && isAlias(vm, source.targets[part.at])
        && !isOrdered(part.exprs[0])) continue;
      const index = statements.length;
      statements.push({
        index,
        targets: part.targets,
        exprs: part.exprs,
        ordered: part.exprs.some(isOrdered) || part.targets.some((entry) => entry.node !== null),
        source,
      });
      for (let slot = 0; slot < part.targets.length; slot += 1) {
        const { reg } = part.targets[slot];
        if (!reg) continue;
        version.set(reg, { index, slot });
        written.add(reg);
      }
    }
  }

  return {
    leaf,
    statements,
    liveIn,
    written,
    unsupported,
    exit: version.get(vm.posKey) || null,
  };
}

function exprAt(statement, slot) {
  if (!statement) return null;
  if (statement.exprs.length === statement.targets.length) {
    return statement.exprs[slot] || null;
  }
  if (statement.targets.length === 1) return statement.exprs[0] || null;
  return null;
}

function definition(block, node) {
  if (!node || node.kind !== REF) return null;
  return exprAt(block.statements[node.index], node.slot);
}

function peel(block, node, depth = 0) {
  let current = node;
  let guard = depth;
  while (current && current.kind === REF && guard < 256) {
    const next = definition(block, current);
    if (!next) return current;
    current = next;
    guard += 1;
  }
  return current;
}

function classifyExit(block, node, depth = 0) {
  if (depth > 64) return { kind: 'unknown' };
  const value = peel(block, node, depth);
  if (!value) return { kind: 'return' };
  if (value.kind === Kind.Number) return { kind: 'goto', target: value.value };
  if (value.kind === Kind.Nil) return { kind: 'return' };
  if (value.kind === Kind.Index) return { kind: 'return' };
  if (value.kind === Kind.Binary && value.operator === 'or') {
    const left = classifyExit(block, value.lhs, depth + 1);
    const right = classifyExit(block, value.rhs, depth + 1);
    if (left.kind !== 'guarded') return { kind: 'unknown' };
    if (right.kind === 'goto') {
      return {
        kind: 'branch',
        condition: left.condition,
        whenTrue: left.target,
        whenFalse: right.target,
      };
    }
    if (right.kind === 'return') {
      return {
        kind: 'branch', condition: left.condition, whenTrue: left.target, whenFalse: null,
      };
    }
    return { kind: 'unknown' };
  }
  if (value.kind === Kind.Binary && value.operator === 'and') {
    const target = classifyExit(block, value.rhs, depth + 1);
    if (target.kind !== 'goto') return { kind: 'unknown' };

    return { kind: 'guarded', condition: value.lhs, target: target.target };
  }
  return { kind: 'unknown' };
}

function terminator(block) {
  if (!block.exit) return { kind: 'unknown', index: null };
  const statement = block.statements[block.exit.index];
  const value = exprAt(statement, block.exit.slot);
  if (!value) return { kind: 'unknown', index: null };
  const classified = classifyExit(block, value);
  if (classified.kind === 'guarded') {
    return {
      kind: 'branch',
      condition: classified.condition,
      whenTrue: classified.target,
      whenFalse: null,
      index: block.exit.index,
    };
  }
  return { ...classified, index: block.exit.index };
}

module.exports = {
  REF,
  LIVE,
  live,
  mapNode,
  isCalling,
  buildBlock,
  definition,
  peel,
  terminator,
};

};

__modules["src/vm/lift.js"] = function(module, exports, require) {
'use strict';

const A = require("src/lua/ast.js");
const { Kind } = A;
const { isIdentifier } = require("src/lua/format.js");
const { walk, transform } = require("src/lua/walk.js");
const {
  buildWebs, entryKey, defKey, liveness,
} = require("src/vm/webs.js");
const { bindingOf, unparen } = require("src/vm/detect.js");
const {
  REF, LIVE, mapNode, definition, peel, isCalling,
} = require("src/vm/ir.js");
const { structureFunction } = require("src/vm/structure.js");

const isBinding = (node, binding) => !!binding && bindingOf(node) === binding;

const upvalsTest = (vm) => vm.container.isUpvals
  || ((node) => isBinding(node, vm.container.upvals));
const allocTest = (vm) => (vm.upvalues && vm.upvalues.isAlloc)
  || ((node) => !!vm.upvalues && isBinding(node, vm.upvalues.alloc));
const tableTest = (vm) => (vm.upvalues && vm.upvalues.isTable)
  || ((node) => !!vm.upvalues && isBinding(node, vm.upvalues.table));
const refsTest = (vm) => (vm.upvalues && vm.upvalues.isRefs)
  || ((node) => !!vm.upvalues && isBinding(node, vm.upvalues.refs));

function numericIndexOn(node, binding) {
  if (!node || node.kind !== Kind.Index) return null;
  if (!isBinding(node.base, binding)) return null;
  const key = unparen(node.index);
  return key && key.kind === Kind.Number ? key.value : null;
}

function unrepack(body) {
  return transform(body, (node) => {
    if (node.kind !== Kind.Call || (node.args || []).length !== 1) return node;
    if (!node.base || node.base.kind !== Kind.Name || node.base.name !== 'unpack') return node;
    const list = resultList(node.args[0]);
    return list && list.length === 1 ? list[0] : node;
  });
}

function dropTailContinue(statements) {
  while (statements.length && statements[statements.length - 1].kind === Kind.Continue) {
    statements.pop();
  }
  const last = statements[statements.length - 1];
  if (!last || last.kind !== Kind.If) return statements;
  dropTailContinue(last.body.statements);
  for (const clause of last.elseIfs || []) dropTailContinue(clause.body.statements);
  if (last.elseBody) {
    dropTailContinue(last.elseBody.statements);
    if (!last.elseBody.statements.length) last.elseBody = null;
  }
  return statements;
}

function isCellToken(token) {
  return typeof token === 'string'
    && (token.startsWith('alloc:') || token.startsWith('param:'));
}

function numericIndexWhere(node, accepts, resolve) {
  if (!node || node.kind !== Kind.Index) return null;
  if (!accepts(resolve(node.base))) return null;
  const key = unparen(resolve(node.index));
  return key && key.kind === Kind.Number ? key.value : null;
}

function stringIndexOn(node, binding) {
  if (!node || node.kind !== Kind.Index) return null;
  if (!isBinding(node.base, binding)) return null;
  const key = unparen(node.index);
  return key && key.kind === Kind.String ? key.value : null;
}

function eachExpression(fn, visitor) {
  let current = null;
  const walkNode = (node) => {
    if (!node || typeof node !== 'object') return;
    if (visitor(node, current) === false) return;
    if (node.kind === REF || node.kind === LIVE) return;
    mapNode(node, (child) => {
      walkNode(child);
      return child;
    });
  };
  for (const block of fn.blocks) {
    current = block;
    for (const statement of block.statements) {
      for (const expression of statement.exprs) walkNode(expression);
      for (const target of statement.targets) if (target.node) walkNode(target.node);
    }
  }
}

function analyzeArgs(vm, fn) {
  let arity = 0;
  let usesTable = false;
  const args = vm.container.args;
  eachExpression(fn, (node, block) => {
    if (node.kind === Kind.Index && isBinding(node.base, args)) {
      const key = unparen(peel(block, node.index));
      if (key && key.kind === Kind.Number && Number.isInteger(key.value) && key.value > 0) {
        arity = Math.max(arity, key.value);
        return false;
      }
    }
    if (node.kind === Kind.Name && bindingOf(node) === args) usesTable = true;
    return undefined;
  });
  return { arity, usesTable };
}

function collectRefs(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.kind === REF) {
    out.push(node);
    return;
  }
  if (node.kind === LIVE) return;
  mapNode(node, (child) => {
    collectRefs(child, out);
    return child;
  });
}

function collectLive(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.kind === LIVE) {
    out.add(node.reg);
    return;
  }
  if (node.kind === REF) return;
  mapNode(node, (child) => {
    collectLive(child, out);
    return child;
  });
}

const TOP = Symbol('top');

function copyExpression(node) {
  if (!node || typeof node !== 'object') return node;
  const copy = mapNode(node, copyExpression);
  delete copy.binding;
  delete copy.bindings;
  return copy;
}

function isRepack(node) {
  return !!node && node.kind === Kind.Call && node.base && node.base.kind === Kind.Name
    && node.base.name === 'unpack' && (node.args || []).length === 1;
}

function resultList(expr) {
  if (!expr) return null;
  if (expr.kind === Kind.Paren) {
    const bare = unparen(expr);
    return A.isMultiValue(bare) ? null : resultList(bare);
  }
  const inner = expr;
  if (inner.kind === Kind.Table) {
    const entries = inner.entries || [];
    if (!entries.every((entry) => entry.type === 'item')) return null;
    const values = entries.map((entry) => entry.value);

    if (values.length === 1 && isRepack(values[0])) {
      const nested = resultList(values[0]);
      if (nested) return nested;
    }
    return values;
  }
  if (isRepack(inner)) return resultList(inner.args[0]);
  return null;
}

const negated = (expr, flag) => {
  if (!flag) return expr;
  if (expr && expr.kind === Kind.Unary && expr.operator === 'not') return expr.argument;
  return A.unary('not', expr);
};

function analyzeUpvalues(vm, fn) {
  const isUpvals = upvalsTest(vm);
  const isAlloc = allocTest(vm);

  const tokenFromExpression = (block, node, state, tokens) => {
    if (!node) return TOP;
    if (node.kind === REF) return tokens.get(`${node.index}.${node.slot}`) || TOP;
    if (node.kind === LIVE) return state.get(node.reg) || TOP;
    const behind = (operand) => peel(block, operand);
    const slot = numericIndexWhere(node, isUpvals, behind);
    if (slot !== null) return `param:${slot}`;
    if (node.kind === Kind.Call && isAlloc(behind(node.base))) {
      return `alloc:${block.id}:${node.allocSite}`;
    }
    return TOP;
  };

  for (const block of fn.blocks) {
    block.statements.forEach((statement, index) => {
      for (const expression of statement.exprs) {
        if (expression && expression.kind === Kind.Call
          && isAlloc(peel(block, expression.base))) {
          expression.allocSite = index;
        }
      }
    });
  }
  const entryState = new Map();
  const exitState = new Map();
  for (const block of fn.blocks) {
    entryState.set(block, new Map());
    exitState.set(block, new Map());
  }

  const { liveIn: liveBefore, liveOut: liveAfter } = liveness(fn);
  const NONE = new Set();
  const restrict = (state, live) => {
    const out = new Map();
    for (const reg of live) {
      const token = state.get(reg);
      if (token !== undefined) out.set(reg, token);
    }
    return out;
  };

  const transfer = (block) => {
    const state = new Map(entryState.get(block));
    const tokens = new Map();
    block.statements.forEach((statement, index) => {
      const single = statement.targets.length === 1 && statement.exprs.length === 1;
      statement.targets.forEach((target, slot) => {
        const token = single
          ? tokenFromExpression(block, statement.exprs[0], state, tokens)
          : TOP;
        tokens.set(`${index}.${slot}`, token);
        if (target.reg) state.set(target.reg, token);
      });
    });
    block.upvalueTokens = tokens;
    return restrict(state, liveAfter.get(block) || NONE);
  };

  const join = (block, fn2) => {
    const live = liveBefore.get(block) || NONE;
    const merged = new Map();
    for (const pred of block.predecessors) {
      if (!fn2.members.has(pred.id)) continue;
      const state = exitState.get(pred);
      if (!state || !state.size) continue;
      for (const reg of live) {
        const token = state.get(reg);
        if (token === undefined) continue;
        if (!merged.has(reg)) merged.set(reg, token);
        else if (merged.get(reg) !== token) merged.set(reg, TOP);
      }
    }
    return merged;
  };

  for (let round = 0; round < 1000; round += 1) {
    let changed = false;
    for (const block of fn.blocks) {
      const merged = block === fn.entry ? new Map() : join(block, fn);
      const previous = entryState.get(block);
      let differs = previous.size !== merged.size;
      if (!differs) for (const [k, v] of merged) if (previous.get(k) !== v) { differs = true; break; }
      if (differs) {
        entryState.set(block, merged);
        changed = true;
      }
      const out = transfer(block);
      const before = exitState.get(block);
      let outDiffers = before.size !== out.size;
      if (!outDiffers) for (const [k, v] of out) if (before.get(k) !== v) { outDiffers = true; break; }
      if (outDiffers) {
        exitState.set(block, out);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const block of fn.blocks) block.upvalueEntry = entryState.get(block);
  return { entryState, exitState, tokenFromExpression };
}
class Lifter {
  constructor(vm, cfg, options = {}) {
    this.vm = vm;
    this.cfg = cfg;
    this.options = options;
    this.warnings = [];
    this.counter = options.counter || 0;
    this.byId = new Map(cfg.functions.map((fn) => [fn.id, fn]));
    this.vmBindings = new Set(vm.wrapper && vm.wrapper.bindings ? vm.wrapper.bindings : []);
    this.roleBindings = new Set(Object.keys(vm.roles).map((key) => vm.roles[key]));
    this.roleOf = new Map(Object.keys(vm.roles).map((key) => [vm.roles[key], key]));
    this.isUpvalueTable = tableTest(vm);
    this.isRefsTable = refsTest(vm);
    this.isRefHelper = (vm.upvalues && vm.upvalues.isHelper) || (() => false);
    this.active = new Set();
  }

  fresh(prefix) {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }

  warn(kind, detail) {
    this.warnings.push({ kind, ...detail });
  }

  creatorFor(node) {
    if (!node) return null;
    if (this.vm.creatorFor) return this.vm.creatorFor(node);
    const binding = bindingOf(node);
    return (binding && this.vm.creators.get(binding)) || null;
  }

  isHelperCall(block, node) {
    if (!node || node.kind !== Kind.Call) return false;
    const callee = peel(block, node.base);
    const binding = bindingOf(callee);
    if (!binding) return false;
    if (!this.vmBindings.has(binding) && !this.isRefHelper(callee)) return false;
    if (this.roleBindings.has(binding)) return false;
    if (this.creatorFor(callee)) return false;
    if (binding === this.vm.containerBinding) return false;
    return true;
  }

  tokenAt(block, index, slot) {
    return block.upvalueTokens ? block.upvalueTokens.get(`${index}.${slot}`) : TOP;
  }

  isNoise(block, statement, index) {
    for (const target of statement.targets) {
      if (target.node && this.isRefsTable(peel(block, target.node.base))) return true;
    }
    if (statement.exprs.length === 1 && this.isHelperCall(block, statement.exprs[0])) {
      return statement.targets.every((target) => target.reg !== null);
    }

    if (statement.targets.length && !statement.ordered
      && statement.targets.every((target, slot) => target.reg
        && isCellToken(this.tokenAt(block, index, slot)))) {
      return true;
    }
    return false;
  }

  varFor(ctx, key) {
    let existing = ctx.regVars.get(key);
    if (!existing) {
      existing = this.fresh('v');
      ctx.regVars.set(key, existing);
    }
    ctx.used.add(existing);
    return existing;
  }

  cellFor(ctx, token) {
    if (token === TOP || token === undefined || token === null) return null;
    const existing = ctx.cells.get(token);
    if (existing) {
      ctx.used.add(existing);
      return existing;
    }
    if (typeof token !== 'string' || !token.startsWith('alloc:')) return null;
    const name = this.fresh('u');
    ctx.cells.set(token, name);
    ctx.cellToken.set(name, token);
    ctx.used.add(name);
    return name;
  }

  argsTable(ctx) {
    const entries = ctx.params.map((name) => ({ type: 'item', value: A.name(name) }));
    entries.push({ type: 'item', value: A.vararg() });
    return A.table(entries);
  }

  roleValue(role) {
    if (role === 'varargs') {
      const given = this.options.varargs;
      return given ? copyExpression(given) : A.table([{ type: 'item', value: A.vararg() }]);
    }
    if (role === 'env') return A.name('_ENV');
    return A.name(role);
  }

  renderVm(node, ctx, render) {
    const vm = this.vm;
    const container = vm.container;
    if (node.kind === Kind.Index) {
      const base = peel(ctx.block, node.base);
      if (this.isUpvalueTable(base)) {
        const name = this.cellFor(ctx, ctx.tokenOf(node.index));
        if (name) return A.name(name);
      }
      const onEnv = isBinding(base, vm.roles.env);
      const onArgs = isBinding(base, container.args);
      if (onEnv || onArgs) {
        const key = unparen(render(node.index));
        if (onEnv) {
          if (key && key.kind === Kind.String && isIdentifier(key.value)) return A.name(key.value);
          return A.index(A.name('_ENV'), key);
        }
        if (key && key.kind === Kind.Number && Number.isInteger(key.value)
          && key.value >= 1 && key.value <= ctx.params.length) {
          return A.name(ctx.params[key.value - 1]);
        }
        return A.index(this.argsTable(ctx), key);
      }
    }
    if (node.kind === Kind.Call) {
      const creator = this.creatorFor(peel(ctx.block, node.base));
      if (creator) {
        const lifted = this.liftSite(node, ctx);
        if (lifted) return lifted;
      }
    }
    if (node.kind === Kind.Name) {
      const binding = bindingOf(node);
      if (binding && binding === container.args) {
        return this.argsTable(ctx);
      }
      const role = binding ? this.roleOf.get(binding) : null;
      if (role) return this.roleValue(role);
    }
    return mapNode(node, render);
  }

  liftSite(node, ctx) {
    const args = node.args || [];
    const id = unparen(peel(ctx.block, args[0]));
    if (!id || id.kind !== Kind.Number) return null;
    const fn = this.byId.get(id.value);
    if (!fn) {
      this.warn('missing-closure', { id: id.value, block: ctx.block.id });
      return null;
    }
    return this.liftFunction(fn, this.closureUpvalues(args[1], ctx), ctx.depth + 1);
  }

  closureUpvalues(expression, ctx) {
    let node = expression;
    for (let guard = 0; guard < 64 && node && node.kind === REF; guard += 1) {
      node = definition(ctx.block, node);
    }
    const inner = node ? unparen(node) : null;
    if (!inner || inner.kind !== Kind.Table) {
      if (expression) this.warn('opaque-upvalues', { block: ctx.block.id });
      return [];
    }
    return (inner.entries || []).map((entry, i) => {
      if (entry.type !== 'item') return null;
      const token = ctx.tokenOf(entry.value);
      const name = this.cellFor(ctx, token);
      if (!name) {
        this.warn('opaque-upvalue', { block: ctx.block.id, slot: i + 1, token: String(token) });
      }
      return name;
    });
  }

  prepareBlock(block, ctx) {
    const cached = ctx.emitters.get(block);
    if (cached) return cached;
    const emitter = {
      block, statements: [], condition: null, returns: null,
    };
    ctx.emitters.set(block, emitter);
    this.fillEmitter(emitter, block, ctx);
    return emitter;
  }

  fillEmitter(emitter, block, ctx) {
    const vm = this.vm;
    const stmts = block.statements;
    const term = block.terminator;
    const keyOf = (i, slot) => `${i}.${slot}`;

    const nameOfEntry = (reg) => ctx.webs.find(entryKey(block, reg));
    const nameOfDef = (i, slot) => ctx.webs.find(defKey(block, i, slot));
    ctx.block = block;

    const writes = new Map();
    stmts.forEach((statement, i) => statement.targets.forEach((target) => {
      if (!target.reg) return;
      if (!writes.has(target.reg)) writes.set(target.reg, []);
      writes.get(target.reg).push(i);
    }));
    const lastWrite = (reg) => {
      const list = writes.get(reg);
      return list ? list[list.length - 1] : -1;
    };

    const refsCache = new Map();
    const refsOf = (i) => {
      let list = refsCache.get(i);
      if (list) return list;
      list = [];
      for (const expr of stmts[i].exprs) collectRefs(expr, list);
      for (const target of stmts[i].targets) if (target.node) collectRefs(target.node, list);
      refsCache.set(i, list);
      return list;
    };
    const liveOf = (i) => {
      const set = new Set();
      for (const expr of stmts[i].exprs) collectLive(expr, set);
      for (const target of stmts[i].targets) if (target.node) collectLive(target.node, set);
      return set;
    };
    const condRefs = [];
    if (term.kind === 'branch') collectRefs(term.condition, condRefs);

    const condTargets = new Set(condRefs.map((node) => node.index));
    const control = new Set();
    const stack = term.index === null || term.index === undefined ? [] : [term.index];
    while (stack.length) {
      const i = stack.pop();
      if (control.has(i)) continue;
      control.add(i);
      for (const node of refsOf(i)) {
        if (condTargets.has(node.index)) continue;
        const target = stmts[node.index].targets[node.slot];
        if (target && target.reg === vm.posKey) stack.push(node.index);
      }
    }
    stmts.forEach((statement, i) => {
      if (this.isNoise(block, statement, i)) control.add(i);
    });

    let retAt = null;
    const canLeave = term.kind === 'return' || term.kind === 'unknown'
      || (term.kind === 'branch' && term.whenFalse === null);
    if (canLeave) {
      const list = (writes.get(vm.returnKey) || []).filter((i) => !control.has(i));
      const candidate = list.length ? list[list.length - 1] : null;
      if (candidate !== null) {
        let read = condRefs.some((node) => node.index === candidate);
        for (let i = candidate + 1; !read && i < stmts.length; i += 1) {
          read = refsOf(i).some((node) => node.index === candidate);
        }
        if (!read) {
          retAt = candidate;
          control.add(candidate);
        }
      }
    }
    const tailRefs = retAt === null ? [] : refsOf(retAt);

    const body = [];
    for (let i = 0; i < stmts.length; i += 1) if (!control.has(i)) body.push(i);

    const plan = (pinned) => {
      const drop = new Set();
      const counts = new Map();
      const host = new Map();
      for (let round = 0; round <= stmts.length + 1; round += 1) {
        counts.clear();
        host.clear();
        const bump = (list, at) => {
          for (const node of list) {
            const key = keyOf(node.index, node.slot);
            counts.set(key, (counts.get(key) || 0) + 1);
            host.set(key, at);
          }
        };
        for (const i of body) if (!drop.has(i)) bump(refsOf(i), i);
        bump(tailRefs, stmts.length);
        bump(condRefs, stmts.length);
        let changed = false;
        for (const i of body) {
          if (drop.has(i) || this.isNeeded(block, stmts[i], i, counts, pinned, lastWrite)) continue;
          drop.add(i);
          changed = true;
        }
        if (!changed) break;
      }
      const materialized = new Set();
      for (const i of body) {
        if (drop.has(i)) continue;
        const multi = stmts[i].targets.length > 1;
        stmts[i].targets.forEach((target, slot) => {
          if (!target.reg) return;
          const key = keyOf(i, slot);
          const live = block.liveOutRegs.has(target.reg) && lastWrite(target.reg) === i;
          if (multi || live || pinned.has(key) || (counts.get(key) || 0) !== 1) {
            materialized.add(key);
          }
        });
      }
      return { drop, counts, host, materialized };
    };

    const hazards = (decision) => {
      const { drop, host, materialized } = decision;
      const positionOf = (start) => {
        let key = start;
        for (let guard = 0; guard < 512; guard += 1) {
          const at = host.get(key);
          if (at === undefined || at >= stmts.length || drop.has(at)) return stmts.length;
          const target = stmts[at].targets[0];
          if (stmts[at].targets.length !== 1 || !target || !target.reg) return at;
          const next = keyOf(at, 0);
          if (materialized.has(next)) return at;
          key = next;
        }
        return stmts.length;
      };
      const pinned = new Set();
      for (const i of body) {
        if (drop.has(i) || stmts[i].targets.length !== 1) continue;
        const key = keyOf(i, 0);
        if (materialized.has(key) || !stmts[i].targets[0].reg) continue;
        const at = positionOf(key);
        for (const reg of liveOf(i)) {
          for (const write of writes.get(reg) || []) {
            if (write > i && write < at && !drop.has(write) && !control.has(write)) pinned.add(key);
          }
        }
      }
      return pinned;
    };

    const build = (decision) => {
      const {
        drop, counts, materialized,
      } = decision;

      const mark = this.warnings.length;
      const out = [];
      const violations = [];
      let violation = null;

      const kinds = new Map();
      const kindOf = (i) => {
        if (kinds.has(i)) return kinds.get(i);
        const statement = stmts[i];
        let answer = 'read';
        if (statement.targets.some((target) => target.node !== null)) answer = 'store';
        else if (statement.exprs.some(isCalling)) answer = 'call';
        kinds.set(i, answer);
        return answer;
      };
      let seen = -1;
      let acted = -1;
      let stored = -1;
      const note = (i) => {
        const kind = kindOf(i);
        let crossed = stored;
        if (kind === 'store') crossed = seen;
        else if (kind === 'call') crossed = acted;
        if (i < crossed) {
          if (violation === null) violation = { small: i, large: crossed };
          violations.push({ small: i, large: crossed });
        }
        if (i > seen) seen = i;
        if (kind !== 'read' && i > acted) acted = i;
        if (kind === 'store' && i > stored) stored = i;
      };
      const render = (node) => {
        if (!node || typeof node !== 'object') return node;
        if (node.kind === LIVE) return A.name(this.varFor(ctx, nameOfEntry(node.reg)));
        if (node.kind === REF) {
          const key = keyOf(node.index, node.slot);
          if (materialized.has(key)) {
            return A.name(this.varFor(ctx, nameOfDef(node.index, node.slot)));
          }
          if (control.has(node.index) || drop.has(node.index)) {
            this.warn('dangling-value', { block: block.id, at: node.index });
            return A.nil();
          }
          const value = render(definition(block, node));
          if (stmts[node.index].ordered) note(node.index);

          return A.isMultiValue(value) ? A.paren(value) : value;
        }
        const rendered = this.renderVm(node, ctx, render);

        return node.truncated && A.isMultiValue(rendered) ? A.paren(rendered) : rendered;
      };

      const emitted = body.filter((i) => {
        if (drop.has(i)) return false;
        const statement = stmts[i];
        if (statement.targets.some((target) => !target.reg)) return true;
        if (statement.targets.some((target, slot) => materialized.has(keyOf(i, slot)))) return true;
        return statement.targets.every((target, slot) => (counts.get(keyOf(i, slot)) || 0) === 0);
      });
      for (const i of emitted) {
        out.push(...this.renderStatement(i, stmts[i], ctx, { render, note, block }));
      }
      const condition = term.kind === 'branch' ? render(term.condition) : null;
      const returns = retAt === null ? null : render(stmts[retAt].exprs[0]);
      return {
        out, condition, returns, violation, violations, warnings: this.warnings.splice(mark),
      };
    };
    let pinned = new Set();
    let built = null;

    const rounds = body.length + 16;
    for (let attempt = 0; attempt < rounds; attempt += 1) {
      const decision = plan(pinned);
      const forced = hazards(decision);
      let grew = false;
      for (const key of forced) if (!pinned.has(key)) { pinned.add(key); grew = true; }
      if (grew) continue;
      built = build(decision);
      if (!built.violation) break;
      const inlinable = (i) => !decision.drop.has(i)
        && !decision.materialized.has(keyOf(i, 0));
      const pin = (i) => {
        for (let slot = 0; slot < stmts[i].targets.length; slot += 1) pinned.add(keyOf(i, slot));
      };
      let progress = false;
      for (const { small, large } of built.violations) {
        if (inlinable(small)) { pin(small); progress = true; } else if (inlinable(large)) {
          pin(large); progress = true;
        }
      }

      if (!progress) break;
    }
    if (!built) built = build(plan(pinned));

    if (built.violation) {
      const { small, large } = built.violation;
      this.warn('evaluation-order', { block: block.id, small, large });
    }
    this.warnings.push(...built.warnings);

    emitter.statements = built.out;
    emitter.condition = () => built.condition || A.nil();
    emitter.returns = () => {
      const value = built.returns;
      if (!value) return A.returnStatement([]);
      const list = resultList(value);
      if (list) return A.returnStatement(list);
      return A.returnStatement([A.call(A.name('unpack'), [value])]);
    };
  }

  renderStatement(index, statement, ctx, aux) {
    const vm = this.vm;
    const { render, note, block } = aux;
    const only = statement.targets.length === 1 ? statement.targets[0] : null;
    if (only && only.node && this.isUpvalueTable(peel(block, only.node.base))) {
      const cell = this.cellFor(ctx, ctx.tokenOf(only.node.index));
      if (cell) {
        const value = render(statement.exprs[0]);
        if (statement.ordered) note(index);
        return [A.assignment([A.name(cell)], [value])];
      }
    }
    const targets = statement.targets.map((target, slot) => (target.reg
      ? A.name(this.varFor(ctx, ctx.webs.find(defKey(block, index, slot))))
      : render(target.node)));
    const exprs = statement.exprs.map(render);

    if (targets.length === 1 && exprs.length === 1) exprs[0] = A.unparen(exprs[0]);
    if (statement.ordered) note(index);

    if (!targets.length) return exprs.length ? [A.callStatement(exprs[0])] : [];

    return [A.assignment(targets, exprs)];
  }

  isNeeded(block, statement, index, counts, pinned, lastWrite) {
    if (statement.ordered) return true;
    return statement.targets.some((target, slot) => {
      if (!target.reg) return true;
      if (pinned.has(`${index}.${slot}`)) return true;
      if (block.liveOutRegs.has(target.reg) && lastWrite(target.reg) === index) return true;
      return (counts.get(`${index}.${slot}`) || 0) > 0;
    });
  }

  labelFor(block, ctx) {
    if (!block) return [];
    const id = block.id;
    if (!ctx.structured.labels.has(id) || ctx.labelled.has(id)) return [];
    ctx.labelled.add(id);
    return [{ kind: Kind.Label, name: `L${id}` }];
  }

  emitRegion(region, ctx) {
    const out = [];
    if (!region || !region.items) return out;
    for (const item of region.items) {
      if (item.kind === 'block') {
        out.push(...this.labelFor(item.block, ctx));
        out.push(...this.prepareBlock(item.block, ctx).statements);
      } else if (item.kind === 'return') {
        out.push(this.prepareBlock(item.block, ctx).returns());
      } else if (item.kind === 'raw') {
        this.warn('unknown-exit', { block: item.block.id });
        out.push(A.returnStatement([]));
      } else if (item.kind === 'if') {
        const emitter = this.prepareBlock(item.block, ctx);
        out.push(A.ifStatement(
          negated(emitter.condition(), item.negate),
          A.block(this.emitRegion(item.then, ctx)),
          [],
          item.else ? A.block(this.emitRegion(item.else, ctx)) : null,
        ));
      } else if (item.kind === 'while') {
        out.push(...this.labelFor(item.loop && item.loop.header, ctx));
        out.push(...this.emitWhile(item, ctx));
      } else if (item.kind === 'repeat') {
        out.push(...this.labelFor(item.loop && item.loop.header, ctx));
        const emitter = this.prepareBlock(item.latch, ctx);
        const body = [...this.emitRegion(item.body, ctx), ...emitter.statements];
        out.push(A.repeatStatement(A.block(dropTailContinue(body)), negated(emitter.condition(), item.negate)));
      } else if (item.kind === 'loop') {
        out.push(...this.labelFor(item.loop && item.loop.header, ctx));
        out.push(A.whileStatement(
          A.boolean(true),
          A.block(dropTailContinue(this.emitRegion(item.body, ctx))),
        ));
      } else if (item.kind === 'break') {
        out.push(A.breakStatement());
      } else if (item.kind === 'continue') {
        out.push({ kind: Kind.Continue });
      } else if (item.kind === 'goto') {
        out.push({ kind: Kind.Goto, label: `L${item.target}` });
      } else if (item.kind === 'labelled') {
        ctx.labelled.add(item.id);
        out.push({ kind: Kind.Label, name: `L${item.id}` });
        out.push(...this.emitRegion(item.region, ctx));
      } else if (item.kind === 'seq') {
        out.push(...this.emitRegion(item, ctx));
      } else {
        this.warn('unhandled-region', { kind: item.kind });
      }
    }
    return out;
  }

  emitWhile(item, ctx) {
    const emitter = this.prepareBlock(item.header, ctx);
    const test = negated(emitter.condition(), item.negate);
    const body = this.emitRegion(item.body, ctx);
    const out = [];
    if (emitter.statements.length === 0) {
      out.push(A.whileStatement(test, A.block(dropTailContinue(body))));
    } else {
      out.push(A.whileStatement(A.boolean(true), A.block(dropTailContinue([
        ...emitter.statements,
        A.ifStatement(negated(test, true), A.block([A.breakStatement()]), [], null),
        ...body,
      ]))));
    }
    if (item.exitReturn) out.push(emitter.returns());
    return out;
  }

  liftFunction(fn, upvalues, depth) {
    if (depth > 200 || this.active.has(fn)) {
      this.warn('recursive-closure', { id: fn.id });
      return A.func([], A.block([]), false);
    }
    this.active.add(fn);
    const shape = analyzeArgs(this.vm, fn);
    const info = analyzeUpvalues(this.vm, fn);
    const structured = structureFunction(fn);
    for (const warning of structured.warnings) this.warn(warning.kind, { ...warning, fn: fn.id });

    const params = [];
    for (let i = 1; i <= shape.arity; i += 1) params.push(this.fresh('a'));
    const inLoop = new Set();
    for (const loop of structured.loops.values()) {
      for (const member of loop.members) inLoop.add(member.id);
    }
    const ctx = {
      fn,
      depth,
      params,
      structured,
      inLoop,
      labelled: new Set(),
      webs: buildWebs(fn),
      regVars: new Map(),
      cells: new Map(),
      cellToken: new Map(),
      used: new Set(),
      emitters: new Map(),
      block: fn.entry,
      tokenFrom: info.tokenFromExpression,
      tokenOf: null,
    };
    ctx.tokenOf = (node) => ctx.tokenFrom(
      ctx.block,
      node,
      ctx.block.upvalueEntry,
      ctx.block.upvalueTokens,
    );
    upvalues.forEach((name, i) => {
      if (name) ctx.cells.set(`param:${i + 1}`, name);
    });

    for (const block of fn.blocks) this.prepareBlock(block, ctx);
    const hoisted = this.declareCells(ctx, fn);
    const body = this.emitRegion(structured.region, ctx);
    const mentioned = new Set();
    walk(A.block(body), {
      enter(node) {
        if (node.kind === Kind.Name) mentioned.add(node.name);
        return undefined;
      },
    });
    const declared = [...ctx.regVars.values()].filter((name) => mentioned.has(name));
    const cells = hoisted.filter((name) => mentioned.has(name));
    if (declared.length || cells.length) {
      body.unshift(A.localDecl([...declared, ...cells], []));
    }
    this.active.delete(fn);
    return A.func(params, A.block(body), !!fn.vararg || shape.usesTable);
  }

  declareCells(ctx, fn) {
    const hoisted = [];
    const byId = new Map(fn.blocks.map((block) => [String(block.id), block]));
    for (const [name, token] of ctx.cellToken) {
      if (!ctx.used.has(name)) continue;
      const owner = byId.get(token.split(':')[1]);
      const emitter = owner ? ctx.emitters.get(owner) : null;
      if (owner && emitter && ctx.inLoop.has(owner.id)) {
        emitter.statements.unshift(A.localDecl([name], []));
      } else {
        hoisted.push(name);
      }
    }
    return hoisted;
  }

  lift() {
    const fn = this.byId.get(this.vm.entry.blockId);
    if (!fn) {
      this.warn('missing-entry', { id: this.vm.entry.blockId });
      return {
        body: A.block([]), params: [], isVararg: false, warnings: this.warnings, counter: 0,
      };
    }
    const lifted = this.liftFunction(fn, [], 0);
    return {
      body: unrepack(lifted.body),
      params: lifted.params,
      isVararg: lifted.isVararg,
      warnings: this.warnings,
      counter: this.counter,
    };
  }
}

function liftVm(vm, cfg, options = {}) {
  return new Lifter(vm, cfg, options).lift();
}

module.exports = { resultList, liftVm };

};

__modules["src/vm/structure.js"] = function(module, exports, require) {
'use strict';

const { dominators, dominates } = require("src/vm/dominators.js");

const EXIT = { id: 'EXIT' };

function fallsOut(block, members) {
  const term = block.terminator;
  if (term.kind === 'return' || term.kind === 'unknown') return true;
  if (term.kind === 'branch' && term.whenFalse === null) return true;
  return block.successors.filter((next) => members.has(next.id)).length === 0;
}

function adjacency(fn) {
  const succ = new Map([[EXIT, []]]);
  const pred = new Map([[EXIT, []]]);
  for (const block of fn.blocks) {
    succ.set(block, []);
    if (!pred.has(block)) pred.set(block, []);
  }
  const link = (from, to) => {
    succ.get(from).push(to);
    pred.get(to).push(from);
  };
  for (const block of fn.blocks) {
    for (const next of block.successors) {
      if (!fn.members.has(next.id)) continue;
      link(block, next);
    }
    if (fallsOut(block, fn.members)) link(block, EXIT);
  }
  return { succ, pred };
}

function findLoops(fn, idom, succ) {
  const loops = new Map();
  for (const block of fn.blocks) {
    for (const next of succ.get(block)) {
      if (next === EXIT) continue;
      if (!dominates(idom, next, block)) continue;
      let loop = loops.get(next);
      if (!loop) {
        loop = { header: next, latches: [], members: new Set([next]), follow: null, exits: [] };
        loops.set(next, loop);
      }
      loop.latches.push(block);
    }
  }
  for (const loop of loops.values()) {
    const stack = [...loop.latches];
    for (const latch of loop.latches) loop.members.add(latch);
    while (stack.length) {
      const block = stack.pop();
      if (block === loop.header) continue;
      for (const previous of block.predecessors) {
        if (!fn.members.has(previous.id)) continue;
        if (loop.members.has(previous)) continue;
        loop.members.add(previous);
        stack.push(previous);
      }
    }
    const candidates = new Set();
    for (const member of loop.members) {
      for (const next of succ.get(member)) {
        if (next === EXIT || loop.members.has(next)) continue;
        candidates.add(next);
        loop.exits.push({ from: member, to: next });
      }
    }
    if (candidates.size === 1) [loop.follow] = [...candidates];
    else loop.candidates = [...candidates];
  }
  return loops;
}

function structureFunction(fn) {
  const { succ, pred } = adjacency(fn);
  const forward = dominators(fn.entry, (n) => succ.get(n) || [], (n) => pred.get(n) || []);
  const backward = dominators(EXIT, (n) => pred.get(n) || [], (n) => succ.get(n) || []);
  const loops = findLoops(fn, forward.idom, succ);
  const rpo = forward.index;
  const warnings = [];
  const labels = new Set();
  const placed = new Set();

  for (const loop of loops.values()) {
    if (loop.follow || !loop.candidates || !loop.candidates.length) continue;
    const ranked = [...loop.candidates].sort((a, b) => (rpo.get(a) || 0) - (rpo.get(b) || 0));
    const after = ranked.find((c) => dominates(backward.idom, c, loop.header));
    const left = after || ranked.find((c) => (succ.get(loop.header) || []).includes(c));
    loop.follow = left || ranked[0];
    if (!left) {
      warnings.push({
        kind: 'multiple-loop-exits',
        header: loop.header.id,
        exits: ranked.map((c) => c.id),
      });
    }
  }

  const byId = new Map(fn.blocks.map((block) => [block.id, block]));
  const blockOf = (id) => {
    const found = byId.get(id);
    return found && fn.members.has(id) ? found : null;
  };

  const insideLoop = (loop, block) => {
    if (block === loop.follow || block === EXIT) return false;
    if (loop.members.has(block)) return true;
    if (!dominates(forward.idom, loop.header, block)) return false;
    return !loop.follow || !dominates(forward.idom, loop.follow, block);
  };

  const keywordFor = (target, ctx) => {
    const depth = ctx.loops.length - 1;
    for (let i = depth; i >= 0; i -= 1) {
      const loop = ctx.loops[i];
      if (target === loop.header) return i === depth ? { kind: 'continue', loop } : null;
      if (target === loop.follow) return i === depth ? { kind: 'break', loop } : null;
    }
    return null;
  };

  const jumpTo = (target, ctx) => {
    const keyword = keywordFor(target, ctx);
    if (keyword) return keyword;
    labels.add(target.id);
    return { kind: 'goto', target: target.id };
  };

  const emit = (start, follow, ctx, entering) => {
    const items = [];
    let current = start;
    for (let guard = 0; current && guard < 100000; guard += 1) {
      if (current === follow) break;

      if (!(entering && guard === 0)) {
        const keyword = keywordFor(current, ctx);
        if (keyword) {
          items.push(keyword);
          break;
        }
      }
      if (placed.has(current)) {
        items.push(jumpTo(current, ctx));
        break;
      }
      const loop = loops.get(current);
      if (loop && !ctx.loops.includes(loop)) {
        items.push(emitLoop(loop, ctx));
        current = loop.follow;
        continue;
      }
      placed.add(current);
      items.push({ kind: 'block', block: current });
      const term = current.terminator;
      if (term.kind === 'return' || term.kind === 'unknown') {
        items.push({ kind: term.kind === 'return' ? 'return' : 'raw', block: current });
        break;
      }
      if (term.kind === 'goto') {
        const target = blockOf(term.target);
        if (!target) {
          warnings.push({ kind: 'missing-target', from: current.id, to: term.target });
          break;
        }
        if (target === follow) break;
        const loopAt = loops.get(target);
        const jump = jumpTo(target, ctx);
        if (jump.kind === 'goto' && !placed.has(target)
          && (!loopAt || !ctx.loops.includes(loopAt))) {
          labels.delete(target.id);
          current = target;
          continue;
        }
        items.push(jump);
        break;
      }
      if (term.kind === 'branch') {
        const join = backward.idom.get(current);
        let limit = join && join !== EXIT && join !== current ? join : null;

        const inner = ctx.loops[ctx.loops.length - 1];
        if (limit && inner && !insideLoop(inner, limit)) limit = null;
        items.push(emitBranch(current, term, limit, ctx));
        if (!limit || limit === follow || placed.has(limit)) break;
        current = limit;
        continue;
      }
      break;
    }
    return { kind: 'seq', items };
  };
  const isEmpty = (region) => !region || !region.items || region.items.length === 0;

  const emitBranch = (block, term, limit, ctx) => {
    const whenTrue = blockOf(term.whenTrue);
    const whenFalse = term.whenFalse === null ? null : blockOf(term.whenFalse);
    const thenRegion = whenTrue ? emit(whenTrue, limit, ctx) : { kind: 'seq', items: [] };
    const elseRegion = whenFalse ? emit(whenFalse, limit, ctx)
      : { kind: 'seq', items: [{ kind: 'return', block }] };
    if (isEmpty(thenRegion) && !isEmpty(elseRegion)) {
      return {
        kind: 'if', block, condition: term.condition, negate: true, then: elseRegion, else: null,
      };
    }
    return {
      kind: 'if',
      block,
      condition: term.condition,
      negate: false,
      then: thenRegion,
      else: isEmpty(elseRegion) ? null : elseRegion,
    };
  };

  const emitLoop = (loop, ctx) => {
    const inner = { ...ctx, loops: [...ctx.loops, loop] };
    const header = loop.header;
    const term = header.terminator;

    if (term.kind === 'branch') {
      const whenTrue = blockOf(term.whenTrue);
      const whenFalse = term.whenFalse === null ? null : blockOf(term.whenFalse);
      const trueInside = whenTrue && loop.members.has(whenTrue);
      const falseInside = whenFalse && loop.members.has(whenFalse);
      const leaves = (node) => node === loop.follow || (node === null && loop.follow === null);
      if (trueInside && !falseInside && leaves(whenFalse)) {
        placed.add(header);
        return {
          kind: 'while',
          loop,
          header,
          condition: term.condition,
          negate: false,
          body: emit(whenTrue, header, inner, true),
          exitReturn: whenFalse === null,
        };
      }
      if (falseInside && !trueInside && leaves(whenTrue)) {
        placed.add(header);
        return {
          kind: 'while',
          loop,
          header,
          condition: term.condition,
          negate: true,
          body: emit(whenFalse, header, inner, true),
          exitReturn: false,
        };
      }
    }

    if (loop.latches.length === 1 && loop.latches[0] !== header) {
      const latch = loop.latches[0];
      const latchTerm = latch.terminator;
      if (latchTerm.kind === 'branch') {
        const whenTrue = blockOf(latchTerm.whenTrue);
        const whenFalse = latchTerm.whenFalse === null ? null : blockOf(latchTerm.whenFalse);
        const exitsTrue = whenFalse === header && whenTrue === loop.follow;
        const exitsFalse = whenTrue === header && whenFalse === loop.follow;
        if (exitsTrue || exitsFalse) {
          placed.add(latch);
          const body = emit(header, latch, inner, true);
          return {
            kind: 'repeat',
            loop,
            latch,
            condition: latchTerm.condition,
            negate: exitsFalse,
            body,
          };
        }
      }
    }

    warnings.push({ kind: 'unstructured-loop', header: header.id });
    return { kind: 'loop', loop, header, body: emit(header, null, inner, true) };
  };
  const region = emit(fn.entry, null, { loops: [] });

  const positionOf = new Map(fn.blocks.map((block, at) => [block, at]));
  const tails = [];
  for (let guard = 0; guard < 10000; guard += 1) {
    let pending = null;
    let earliest = Infinity;
    for (const id of labels) {
      const block = byId.get(id);
      if (!block || placed.has(block)) continue;
      const at = positionOf.has(block) ? positionOf.get(block) : Infinity;
      if (at < earliest) { earliest = at; pending = block; }
    }
    if (!pending) break;
    tails.push({ kind: 'labelled', id: pending.id, region: emit(pending, null, { loops: [] }) });
  }
  if (tails.length) region.items.push(...tails);

  const unplaced = fn.blocks.filter((block) => !placed.has(block));
  for (const block of unplaced) warnings.push({ kind: 'unplaced-block', block: block.id });

  return {
    fn, region, labels, loops, warnings, unplaced, dom: forward, postDom: backward,
  };
}

module.exports = { structureFunction };

};

__modules["src/vm/webs.js"] = function(module, exports, require) {
'use strict';

class Webs {
  constructor() {
    this.parent = new Map();
  }

  find(key) {
    let root = key;
    while (this.parent.has(root) && this.parent.get(root) !== root) {
      root = this.parent.get(root);
    }
    let node = key;
    while (this.parent.has(node) && this.parent.get(node) !== node) {
      const next = this.parent.get(node);
      this.parent.set(node, root);
      node = next;
    }
    if (!this.parent.has(key)) this.parent.set(key, root);
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

const entryKey = (block, reg) => `E${block.id}|${reg}`;

const defKey = (block, index, slot) => `D${block.id}|${index}.${slot}`;

function liveness(fn) {
  const liveIn = new Map();
  const liveOut = new Map();
  for (const block of fn.blocks) {
    liveIn.set(block, new Set(block.liveIn));
    liveOut.set(block, new Set());
  }
  const order = [...fn.blocks].reverse();
  for (let round = 0; round < 10000; round += 1) {
    let changed = false;
    for (const block of order) {
      const out = liveOut.get(block);
      const into = liveIn.get(block);
      for (const next of block.successors) {
        if (!fn.members.has(next.id)) continue;
        for (const reg of liveIn.get(next) || []) {
          if (out.has(reg)) continue;
          out.add(reg);
          changed = true;
        }
      }
      for (const reg of out) {
        if (block.written.has(reg) || into.has(reg)) continue;
        into.add(reg);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { liveIn, liveOut };
}

function exitKey(block, reg) {
  const stmts = block.statements;
  for (let i = stmts.length - 1; i >= 0; i -= 1) {
    const targets = stmts[i].targets;
    for (let slot = targets.length - 1; slot >= 0; slot -= 1) {
      if (targets[slot].reg === reg) return defKey(block, i, slot);
    }
  }
  return entryKey(block, reg);
}

function buildWebs(fn) {
  const webs = new Webs();
  const { liveIn } = liveness(fn);
  for (const block of fn.blocks) {
    for (const reg of liveIn.get(block) || []) {
      const key = entryKey(block, reg);
      webs.find(key);
      for (const pred of block.predecessors) {
        if (!fn.members.has(pred.id)) continue;
        webs.union(key, exitKey(pred, reg));
      }
    }
  }
  return webs;
}

module.exports = { buildWebs, entryKey, defKey, liveness };

};

const promDeobf = __require('src/index.js');
global.__promDeobf = promDeobf;
// === END BUNDLE ===

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Channel],
});
const runningScans = new Set();
const paginationMenus = new Map();
const robuxTickets = new Map(); // channelId -> { userId, robloxUser, gamepass, checked, purchased }
let robuxConfig = null; // { staffRoleId, categoryId, gamepass }
const obfTemp = new Map(); // userId -> { source, fileName, isBuyerUser }
const whsWebhookUrls = new Map(); // messageId -> webhookUrl
const whsPanelOwners = new Map(); // messageId -> authorId
const altListMenus = new Map();
const extractCarouselMenus = new Map();
const EXPIRY_MS = 5 * 60 * 1000;
let isReady = false;
let lastReady = Date.now();
let registering = false;
let reconnecting = false;
// ============================================================
// BASIC HELPERS
// ============================================================
const saveLibrary = () => writeJSON(LIBRARY_FILE, library);
const saveConfig = () => writeJSON(CONFIG_FILE, config);
function isOwner(userId) {
  return userId === OWNER_ID;
}

// Auto-role for alt accounts: remove all roles, add ALT role
async function applyAltRole(member) {
  if (!member || !member.roles) return;
  try {
    const ALT_ROLE_ID = "1537881754185113670";
    const rolesToRemove = member.roles.cache.filter(r => r.id !== member.guild.id);
    for (const [roleId] of rolesToRemove) {
      try { await member.roles.remove(roleId); } catch {}
    }
    try { await member.roles.add(ALT_ROLE_ID); } catch {}
    console.log("✅ Alt role applied to: " + member.user.tag);
  } catch (e) {
    console.error("Alt role error:", e.message);
  }
}
async function isBuyer(userId, member) {
  const uid = userId || member?.id;
  if (!uid) return false;
  if (uid === OWNER_ID) return true;
  // Fast path: local guild member check
  if (member?.roles?.cache?.has(BUYER_ROLE_ID)) {
    console.log(`👑 isBuyer: ${uid} → YES (local member)`);
    return true;
  }
  // Main guild fetch
  try {
    let mainGuild = client.guilds.cache.get(GUILD_ID);
    if (!mainGuild) {
      console.log(`👑 isBuyer: fetching guild ${GUILD_ID}...`);
      mainGuild = await client.guilds.fetch(GUILD_ID);
    }
    if (!mainGuild) {
      console.warn(`⚠️ isBuyer: main guild not found`);
      return false;
    }
    // Fetch member with force
    let mainMember = mainGuild.members.cache.get(uid);
    if (!mainMember) {
      console.log(`👑 isBuyer: fetching member ${uid} from main guild...`);
      mainMember = await mainGuild.members.fetch({ user: uid, force: true });
    }
    if (!mainMember) {
      console.log(`👑 isBuyer: ${uid} → NO (not in main guild)`);
      return false;
    }
    // Check roles cache
    if (mainMember.roles.cache.has(BUYER_ROLE_ID)) {
      console.log(`👑 isBuyer: ${uid} → YES (role in cache)`);
      return true;
    }
    // Force fetch roles if cache seems incomplete
    if (mainMember.roles.cache.size <= 1) {
      console.log(`👑 isBuyer: force-fetching roles for ${uid}...`);
      try {
        await mainMember.roles.fetch();
        if (mainMember.roles.cache.has(BUYER_ROLE_ID)) {
          console.log(`👑 isBuyer: ${uid} → YES (roles fetched)`);
          return true;
        }
      } catch (roleErr) {
        console.warn(`⚠️ isBuyer roles fetch: ${roleErr.message}`);
      }
    }
    // Last resort: check via list of role IDs
    const roleIds = [...mainMember.roles.cache.keys()];
    console.log(`👑 isBuyer: ${uid} roles = [${roleIds.join(", ")}] (looking for ${BUYER_ROLE_ID})`);
    if (roleIds.includes(BUYER_ROLE_ID)) {
      console.log(`👑 isBuyer: ${uid} → YES (role ID match)`);
      return true;
    }
    console.log(`👑 isBuyer: ${uid} → NO (buyer role not found)`);
    return false;
  } catch (e) {
    console.warn(`⚠️ isBuyer ERROR for ${uid}: ${e.message}`);
    // Final fallback: check local member if available
    if (member?.roles?.cache?.has(BUYER_ROLE_ID)) {
      console.log(`👑 isBuyer: ${uid} → YES (fallback local)`);
      return true;
    }
    return false;
  }
}
function channelAllowed(target) {
  if (!config.allowedChannelId) return true;
  return target.channelId === config.allowedChannelId;
}
async function hasPrinceStatus(userId) {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    const member = await mainGuild.members.fetch(userId, { force: true });
    if (!member?.presence?.activities) return false;
    for (const act of member.presence.activities) {
      if (act.type === 4 && act.state && act.state.toLowerCase().includes(".gg/tbbauzu8cw")) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
// Check if user has Server Tag (guild-specific avatar = server identity/profile)
function hasServerTag(member) {
  // Legacy wrapper — now checks status requirement
  return memberHasPrinceStatus(member);
}
// Check if guild supports Server Tag feature
function guildSupportsServerTag(guild) {
  if (!guild) return false;
  // Server Identity/Tag feature is available in all guilds that have it enabled
  // Check for common features that indicate server identity support
  const features = guild.features || [];
  return features.includes("GUILD_SERVER_GUIDE") || 
         features.includes("MEMBER_VERIFICATION_GATE_ENABLED") ||
         features.includes("NEWS") ||
         true; // Most modern guilds support server identity
}
async function isInMainGuild(userId) {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    await mainGuild.members.fetch(userId, { force: true });
    return true;
  } catch {
    return false;
  }
}
function memberHasPrinceStatus(member) {
  if (!member?.presence?.activities) return false;
  for (const act of member.presence.activities) {
    if (act.type === 4 && act.state && act.state.toLowerCase().includes(".gg/tbbauzu8cw")) {
      return true;
    }
  }
  return false;
}
async function syncPrinceRole(member) {
  try {
    if (!member || member.guild.id !== GUILD_ID) return;
    if (member.user.bot) return;
    // Force-fetch to get latest server avatar data (no stale cache)
    try { member = await member.guild.members.fetch(member.id, { force: true }); } catch {}
    const hasStatus = memberHasPrinceStatus(member);
    const hasRole = member.roles.cache.has(PRINCE_ROLE_ID);
    console.log(`👑 Check ${member.user.tag}: hasStatus=${hasStatus} hasRole=${hasRole}`);
    if (hasStatus && !hasRole) {
      await member.roles.add(PRINCE_ROLE_ID, "Prince status detected").catch(() => {});
      console.log(`👑 + Prince role: ${member.user.tag}`);
    } else if (!hasStatus && hasRole) {
      await member.roles.remove(PRINCE_ROLE_ID, "Prince status removed").catch(() => {});
      console.log(`👑 - Prince role: ${member.user.tag}`);
    }
  } catch (e) {
    console.warn(`⚠️ syncPrinceRole: ${e.message}`);
  }
}
async function syncAllPrinceRoles() {
  try {
    const mainGuild = await client.guilds.fetch(GUILD_ID);
    await mainGuild.members.fetch();
    let added = 0, removed = 0, skipped = 0;
    for (const member of mainGuild.members.cache.values()) {
      if (member.user.bot) { skipped++; continue; }
      try {
        const hasStatus = memberHasPrinceStatus(member);
        const hasRole = member.roles.cache.has(PRINCE_ROLE_ID);
        if (hasStatus && !hasRole) {
          await member.roles.add(PRINCE_ROLE_ID, "Startup sync: status detected").catch(() => {});
          added++;
        } else if (!hasStatus && hasRole) {
          await member.roles.remove(PRINCE_ROLE_ID, "Startup sync: no status").catch(() => {});
          removed++;
        }
      } catch (e) {
        console.warn(`⚠️ syncAll member ${member.user?.tag}: ${e.message}`);
      }
    }
    console.log(`👑 Startup role sync done: +${added} -${removed} ~${skipped} bots`);
  } catch (e) {
    console.warn(`⚠️ syncAllPrinceRoles: ${e.message}`);
  }
}
// ============================================================
// PERMISSION CHECK — REGULAR USER COMMANDS
// Owner / Buyer → bypass all
// Regular → status + channel + guild checks
// ============================================================
async function checkRegularPermission(msg, needsFileReply = false) {
  // Owner or Buyer → full bypass
  if (isOwner(msg.author.id) || await isBuyer(msg.author.id, msg.member)) {
    return { allowed: true, isBuyer: true };
  }

  const isDM = !msg.guild;

  // Regular users CANNOT use in DMs
  if (isDM) {
    return { allowed: false, reason: "❌ not here, dumbass.", isBuyer: false };
  }

  // Cross-server check: must be in main guild
  if (msg.guild.id !== GUILD_ID) {
    const inMain = await isInMainGuild(msg.author.id);
    if (!inMain) {
      return { allowed: false, reason: "❌ join in main server first bro `.gg/TBBAUZu8cW`.", isBuyer: false };
    }
  }

  const hasStatus = await hasPrinceStatus(msg.author.id);
  const noStatusMsg = "❌ put `.gg/TBBAUZu8cW` in your status first bro.";

  // If channel is restricted
  if (!channelAllowed(msg)) {
    if (hasStatus) {
      return { allowed: false, reason: "❌ not here, dumbass.", isBuyer: false };
    } else {
      return { allowed: false, reason: noStatusMsg, isBuyer: false };
    }
  }

  // Must have status or server tag
  if (!hasStatus) {
    return { allowed: false, reason: noStatusMsg, isBuyer: false };
  }

  if (needsFileReply && !isReplyingToFile(msg)) {
    return { allowed: false, reason: "❌ reply to a file or forwarded file, dumbass.", isBuyer: false };
  }

  return { allowed: true, isBuyer: false };
}
function isReplyingToFile(msg) {
  const ref = msg.reference?.messageId;
  if (!ref) return false;
  const channel = msg.channel;
  const repliedMsg = channel.messages.cache.get(ref);
  if (!repliedMsg) return false;
  if (repliedMsg.attachments.size > 0) return true;
  for (const snap of repliedMsg.messageSnapshots?.values?.() || []) {
    if (snap.attachments.size > 0) return true;
  }
  return false;
}
function replyUser(message, payload) {
  const body = typeof payload === "string" ? { content: payload } : { ...payload };
  body.allowedMentions = { ...(body.allowedMentions || {}), repliedUser: true };
  return message.reply(body);
}

// Detect obfuscator type and confidence
function detectObfuscator(src) {
  if (!src || typeof src !== "string") return { name: "Unknown", confidence: 0 };
  const s = src;
  let sc = {};
  sc.Luraph = 0; sc.WeAreDevs = 0; sc.Prometheus = 0; sc.Luarmor = 0;
  sc.PolSec = 0; sc["25ms"] = 0; sc.Moonveil = 0; sc["MoonSec V3"] = 0;
  sc.Solara = 0; sc.Hydrogen = 0; sc.Wave = 0; sc.Evon = 0;
  sc["Synapse X"] = 0; sc["Script-Ware"] = 0; sc.Krnl = 0; sc.Fluxus = 0;
  sc.Delta = 0; sc.Celery = 0; sc.Electron = 0; sc.Comet = 0;
  sc["Vega X"] = 0; sc.IronBrew = 0; sc.DarkEccentric = 0; sc.Axon = 0;
  sc.ProtoSmasher = 0; sc.Elysian = 0; sc.SirHurt = 0; sc.CocoZ = 0;
  sc.Zaptosis = 0; sc["Obfuscator.Lua"] = 0; sc.LuaMinify = 0;
  sc["Base64-Encoded"] = 0; sc["XOR-Encrypted"] = 0; sc.Bytecode = 0;
  sc["VM-Obfuscated"] = 0; sc.Unobfuscate = 0;
  
  // ── Luraph ──
  if (/Luraph|luraph/i.test(s)) sc.Luraph += 50;
  if (/\[=\[[\s\S]{200,}\]\]/.test(s)) sc.Luraph += 20;
  if (/loadstring\s*\(\s*[A-Za-z0-9+/=]{200,}\s*\)/.test(s)) sc.Luraph += 15;
  if (/setmetatable\s*\(\s*\{\s*\}\s*,\s*\{\s*__index/.test(s)) sc.Luraph += 10;
  
  // ── WeAreDevs ──
  if (/WeAreDevs|WAD_|wad_|wearedevs/i.test(s)) sc.WeAreDevs += 50;
  if (/--\s*\/\/?\s*WeAreDevs/i.test(s)) sc.WeAreDevs += 30;
  if (/M\s*\(\s*-?\d+\s*[+\-*]\s*-?\d+\s*\)/.test(s)) sc.WeAreDevs += 25;
  if (/local\s+[A-Za-z_]+\s*=\s*\{(?:"\{(?:\\.|[^"\\])*"\s*[,;]\s*){5,}/.test(s)) sc.WeAreDevs += 20;
  if (/\bz\s*\[\s*[A-Za-z_][A-Za-z0-9_]*\s*\]/.test(s)) sc.WeAreDevs += 15;
  if (/return\s*\(\s*function\s*\(/.test(s)) sc.WeAreDevs += 10;
  
  // ── Prometheus ──
  if (/Prometheus|prometheus/i.test(s)) sc.Prometheus += 50;
  if (/--\s*This file was generated using/i.test(s)) sc.Prometheus += 30;
  if (/loadstring\s*\(\s*function\s*\(\s*\)\s*return\s*["']/.test(s)) sc.Prometheus += 20;
  if (/string\.char\s*\(\s*\d+\s*(?:,\s*\d+\s*){5,}\)/.test(s)) sc.Prometheus += 15;
  if (/pcall\s*\(\s*loadstring/.test(s)) sc.Prometheus += 10;
  
  // ── Luarmor ──
  if (/Luarmor|luarmor/i.test(s)) sc.Luarmor += 50;
  if (/_G\s*\[\s*["']luarmor/i.test(s)) sc.Luarmor += 30;
  if (/string\.dump\s*\(/.test(s)) sc.Luarmor += 20;
  if (/luarmor\.net|luarmor\.gg/i.test(s)) sc.Luarmor += 20;
  
  // ── PolSec ──
  if (/PolSec|polsec/i.test(s)) sc.PolSec += 50;
  if (/polsec\.gg/i.test(s)) sc.PolSec += 30;
  if (/PolSecure|polsecure/i.test(s)) sc.PolSec += 20;
  
  // ── 25ms ──
  if (/\b25ms\b|25MS/.test(s)) sc["25ms"] += 50;
  if (/25ms\.to|25ms\.gg/i.test(s)) sc["25ms"] += 25;
  
  // ── Moonveil ──
  if (/Moonveil|moonveil/i.test(s)) sc.Moonveil += 50;
  if (/moonveil\.gg/i.test(s)) sc.Moonveil += 25;
  
  // ── MoonSec V3 ──
  if (/MoonSec|moonsec|MoonSec V3/i.test(s)) sc["MoonSec V3"] += 50;
  if (/moonsec\.net|moonsec\.gg/i.test(s)) sc["MoonSec V3"] += 25;
  
  // ── Solara ──
  if (/Solara|solara/i.test(s)) sc.Solara += 50;
  if (/solara\.gg|solara\.app/i.test(s)) sc.Solara += 25;
  
  // ── Hydrogen ──
  if (/Hydrogen|hydrogen/i.test(s)) sc.Hydrogen += 50;
  if (/hydrogen\.gg|hydrogen\.exe/i.test(s)) sc.Hydrogen += 25;
  
  // ── Wave ──
  if (/\bWave\b|wave\.exe/i.test(s)) sc.Wave += 45;
  
  // ── Evon ──
  if (/Evon|evon/i.test(s)) sc.Evon += 45;
  if (/evon\.gg/i.test(s)) sc.Evon += 25;
  
  // ── Synapse X ──
  if (/Synapse|synapse|Synapse X/i.test(s)) sc["Synapse X"] += 45;
  if (/syn\.|synapse\.cc/i.test(s)) sc["Synapse X"] += 25;
  
  // ── Script-Ware ──
  if (/Script-Ware|ScriptWare|script-ware/i.test(s)) sc["Script-Ware"] += 45;
  if (/sw\.|scriptware/i.test(s)) sc["Script-Ware"] += 20;
  
  // ── Krnl ──
  if (/Krnl|krnl/i.test(s)) sc.Krnl += 45;
  if (/krnl\.gg|krnl\.ca/i.test(s)) sc.Krnl += 25;
  
  // ── Fluxus ──
  if (/Fluxus|fluxus/i.test(s)) sc.Fluxus += 45;
  if (/fluxteam|fluxus\.gg/i.test(s)) sc.Fluxus += 25;
  
  // ── Delta ──
  if (/Delta|delta/i.test(s)) sc.Delta += 40;
  if (/delta\.gg|deltaexec/i.test(s)) sc.Delta += 25;
  
  // ── Celery ──
  if (/Celery|celery/i.test(s)) sc.Celery += 40;
  if (/celery\.gg|celeryexec/i.test(s)) sc.Celery += 25;
  
  // ── Electron ──
  if (/Electron|electron/i.test(s)) sc.Electron += 40;
  if (/electron\.gg/i.test(s)) sc.Electron += 25;
  
  // ── Comet ──
  if (/Comet|comet/i.test(s)) sc.Comet += 40;
  if (/comet\.gg/i.test(s)) sc.Comet += 25;
  
  // ── Vega X ──
  if (/Vega X|VegaX|vegax/i.test(s)) sc["Vega X"] += 40;
  if (/vegax\.gg/i.test(s)) sc["Vega X"] += 25;
  
  // ── More Obfuscators ──
  // ── IronBrew ──
  if (/IronBrew|ironbrew|IB2|IB_/i.test(s)) sc.IronBrew += 50;
  if (/ironbrew\.io/i.test(s)) sc.IronBrew += 25;
  
  // ── DarkEccentric ──
  if (/DarkEccentric|darkeccentric|DE_/i.test(s)) sc.DarkEccentric += 50;
  
  // ── Axon ──
  if (/\bAxon\b|axon\.exe/i.test(s)) sc.Axon += 45;
  
  // ── ProtoSmasher ──
  if (/ProtoSmasher|protosmasher/i.test(s)) sc.ProtoSmasher += 45;
  
  // ── Elysian ──
  if (/Elysian|elysian/i.test(s)) sc.Elysian += 45;
  
  // ── SirHurt ──
  if (/SirHurt|sirhurt/i.test(s)) sc.SirHurt += 45;
  
  // ── CocoZ ──
  if (/CocoZ|cocoz/i.test(s)) sc.CocoZ += 45;
  
  // ── Zaptosis ──
  if (/Zaptosis|zaptosis/i.test(s)) sc.Zaptosis += 45;
  
  // ── Obfuscator.Lua ──
  if (/Obfuscator\.Lua|obfuscator\.lua/i.test(s)) sc["Obfuscator.Lua"] += 45;
  
  // ── LuaMinify ──
  if (/luamin|lua_min|minified\slua/i.test(s)) sc.LuaMinify += 35;
  
  // ── Base64-Encoded ──
  if (/loadstring\s*\(\s*game:HttpGet.*base64|base64decode|base64_decode/i.test(s)) sc["Base64-Encoded"] += 35;
  
  // ── XOR-Encrypted ──
  if (/xor\s*\(|bit\.bxor|string\.char\s*\(\s*\d+\s*%/i.test(s)) sc["XOR-Encrypted"] += 30;
  
  // ── Bytecode ──
  if (/string\.dump|loadstring\s*\(\s*\\x/i.test(s)) sc.Bytecode += 40;
  if (/\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}.*\\x[0-9a-fA-F]{2}/.test(s)) sc.Bytecode += 20;
  
  // ── VM-Obfuscated (general fallback) ──
  let vmScore = 0;
  if (/loadstring\s*\(/.test(s)) vmScore += 10;
  if (/\\x[0-9a-fA-F]{2}/.test(s)) vmScore += 10;
  if (/string\.char\s*\(/.test(s)) vmScore += 10;
  if (/setmetatable|getmetatable/.test(s)) vmScore += 5;
  if (/pcall\s*\(|xpcall\s*\(/.test(s)) vmScore += 5;
  if (/\bassert\s*\(/.test(s)) vmScore += 5;
  sc["VM-Obfuscated"] = vmScore;
  
  // ── Unobfuscate (clean script) ──
  const allObfScores = Object.values(sc).reduce((a, b) => a + b, 0) - (sc.Unobfuscate || 0);
  if (allObfScores < 15) {
    if (/function\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/.test(s)) sc.Unobfuscate += 25;
    if (/--\s*\[/.test(s)) sc.Unobfuscate += 10;
    if (/local\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=/.test(s) && !/local\s+[A-Za-z_]+\s*=\s*\{/.test(s)) sc.Unobfuscate += 10;
    if (/print\s*\(|warn\s*\(|error\s*\(/.test(s)) sc.Unobfuscate += 5;
  }
  
  // Cap scores
  for (const k of Object.keys(sc)) sc[k] = Math.min(sc[k], 100);
  
  // Sort and return best
  const entries = Object.entries(sc).map(([name, score]) => ({ name, score }));
  entries.sort((a, b) => b.score - a.score);
  
  const best = entries[0];
  if (best.score < 15) return { name: "Unknown", confidence: 0 };
  return { name: best.name, confidence: best.score };
}
function getEmbedColor(isBuyerUser) {
  return REGULAR_COLOR;
}
function getFinderTitle(isBuyerUser) {
  return "Finder Source Results";
}
// ============================================================
// FILE HELPERS
// ============================================================
function normalize(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\.[^/.]+$/, "").replace(/[_\-.()[\]{}]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeBase(name) {
  let n = normalize(name);
  n = n.replace(/\s*\d+$/, "").trim();
  n = n.replace(/\s*(copy|ver|version|v)\s*\d*$/i, "").trim();
  n = n.replace(/\s+/g, " ").trim();
  return n;
}
function ext(name) {
  const match = String(name || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}
function isImage(name, contentType) {
  return String(contentType || "").toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif|heic|heif)$/i.test(String(name || ""));
}
function isAllowedFileType(name, contentType) {
  const e = ext(name);
  return (e === "txt" || e === "lua") && !isImage(name, contentType);
}
function isZipFile(name, contentType) {
  const e = ext(name);
  return e === "zip" || String(contentType || "").toLowerCase().includes("zip");
}
function isHtmlFile(name, contentType) {
  const e = ext(name);
  return e === "html" || e === "htm" || String(contentType || "").toLowerCase().includes("html");
}
function idForFile() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id;
  do {
    id = "";
    for (let i = 0; i < 4; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (library.files.some(file => file.id === id));
  return id;
}
function getFile(id) {
  const f = library.files.find(file => file.id === String(id || "").trim()) || null;
  if (f && Number(f.size || 0) === 36) return null; // skip unavailable placeholder files
  return f;
}
async function getFreshUrl(file) {
  try {
    const ch = await client.channels.fetch(file.channelId);
    const orig = await ch.messages.fetch(file.messageId);
    let fresh = orig.attachments.get(file.attachmentId);
    if (!fresh) {
      for (const s of orig.messageSnapshots?.values?.() || []) {
        fresh = s.attachments?.get(file.attachmentId);
        if (fresh) break;
      }
    }
    if (fresh?.url) {
      file.url = fresh.url;
      saveLibrary();
      return fresh.url;
    }
  } catch (e) {
    console.warn(`⚠️ Could not refresh URL for ${file.filename}:`, e.message);
  }
  return null;
}
function findFiles(query) {
  query = normalize(query);
  if (!query) return [];
  const tokens = query.split(" ").filter(Boolean);
  const seenNames = new Set();
  return library.files
    .filter(file => Number(file.size || 0) !== 36) // skip unavailable placeholder files
    .map(file => {
    const name = normalize(file.filename);
    let score = 0;
    if (name === query) score += 5000;
    if (name.startsWith(query)) score += 2000;
    if (name.includes(query)) score += 1000;
    for (const token of tokens) {
      if (name === token) score += 500;
      else if (name.startsWith(token)) score += 200;
      else if (name.includes(token)) score += 100;
    }
    return { file, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter(item => {
      const normName = normalize(item.file.filename);
      if (seenNames.has(normName)) return false;
      seenNames.add(normName);
      return true;
    })
    .map(item => item.file);
}
async function fetchMessages(channel, before) {
  const options = { limit: 100 };
  if (before) options.before = before;
  return await channel.messages.fetch(options);
}
function attachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isAllowedFileType(a.name, a.contentType)) {
      result.push({ attachment: a, forwarded: false });
    }
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isAllowedFileType(a.name, a.contentType)) {
        result.push({ attachment: a, forwarded: true });
      }
    }
  }
  return result;
}
function allAttachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isAllowedFileType(a.name, a.contentType)) result.push(a);
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isAllowedFileType(a.name, a.contentType)) result.push(a);
    }
  }
  return result;
}
function zipAttachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isZipFile(a.name, a.contentType)) result.push(a);
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isZipFile(a.name, a.contentType)) result.push(a);
    }
  }
  return result;
}
function extractAttachmentsOf(message) {
  const result = [];
  for (const a of message.attachments?.values?.() || []) {
    if (isZipFile(a.name, a.contentType)) result.push(a);
  }
  for (const s of message.messageSnapshots?.values?.() || []) {
    for (const a of s.attachments?.values?.() || []) {
      if (isZipFile(a.name, a.contentType)) result.push(a);
    }
  }
  return result;
}
function getMaxFileSize(guild) {
  const tier = guild?.premiumTier || 0;
  if (tier >= 3) return { size: 1000 * 1024 * 1024, label: "1000MB" };
  if (tier >= 2) return { size: 750 * 1024 * 1024, label: "750MB" };
  if (tier >= 1) return { size: 500 * 1024 * 1024, label: "500MB" };
  return { size: 300 * 1024 * 1024, label: "300MB" };
}
async function scanChannel(channel) {
  if (!channel?.isTextBased?.() || !channel.messages) throw new Error("Not a readable text channel.");
  if (runningScans.has(channel.id)) throw new Error("Already scanning.");
  runningScans.add(channel.id);
  try {
    const existingBases = new Set(library.files.map(f => normalizeBase(f.filename)));
    const existingFullNames = new Set(library.files.map(f => normalize(f.filename)));
    const found = [];
    let before = null, messages = 0, pages = 0, skippedDup = 0, replacedDup = 0;
    while (true) {
      const batch = await fetchMessages(channel, before);
      pages++; if (!batch.size) break;
      for (const msg of batch.values()) {
        messages++;
        for (const item of attachmentsOf(msg)) {
          const a = item.attachment;
          const filename = a.name || "unknown_file";
          const baseName = normalizeBase(filename);
          const fullName = normalize(filename);
          const fileSize = Number(a.size || 0);
          const url = a.url || a.proxyURL || a.proxy_url;
          if (!baseName || !url) continue;
          // Skip files that are unavailable (exactly 36 bytes = Discord unavailable placeholder)
          if (fileSize === 36) continue;
          const isDupBase = existingBases.has(baseName);
          const isDupFull = existingFullNames.has(fullName);
          if (isDupBase || isDupFull) {
            skippedDup++;
            continue;
          }
          existingBases.add(baseName);
          existingFullNames.add(fullName);
          found.push({
            id: idForFile(), filename, url, size: fileSize,
            contentType: a.contentType || null, channelId: msg.channelId,
            messageId: msg.id, attachmentId: String(a.id), forwarded: item.forwarded,
            createdTimestamp: msg.createdTimestamp || Date.now(), scannedAt: Date.now()
          });
        }
      }
      const oldest = batch.last();
      if (!oldest || batch.size < 100) break;
      before = oldest.id;
    }
    library.files.push(...found);
    library.files.sort((a, b) => Number(a.createdTimestamp || 0) - Number(b.createdTimestamp || 0));
    saveLibrary();
    const libraryTotal = library.files.length;
    const channelTotal = library.files.filter(f => f.channelId === channel.id).length;
    console.log(`📂 Scan done | #${channel.name} | ${messages} msgs | ${found.length} new | ${replacedDup} replaced | ${skippedDup} skipped | ${pages} pages`);
    return { messages, found: found.length, replaced: replacedDup, skipped: skippedDup, total: libraryTotal, channelTotal };
  } finally { runningScans.delete(channel.id); }
}
async function downloadURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
async function forwardTxt(source, destination) {
  if (!source?.isTextBased?.()) throw new Error("Source not readable.");
  if (!destination?.isTextBased?.()) throw new Error("Dest not writable.");
  let before = null, messages = 0, sent = 0;
  const sendBatch = [];
  while (true) {
    const batch = await fetchMessages(source, before);
    if (!batch.size) break;
    for (const msg of batch.values()) {
      messages++;
      for (const a of allAttachmentsOf(msg)) {
        sendBatch.push(
          downloadURL(a.url)
            .then(buf => destination.send({ files: [new AttachmentBuilder(buf, { name: a.name || "file" })] }))
            .then(() => sent++)
            .catch(e => console.error(`⚠️ Forward: ${e.message}`))
        );
      }
    }
    const oldest = batch.last();
    if (!oldest || batch.size < 100) break;
    before = oldest.id;
  }
  await Promise.allSettled(sendBatch);
  return { messages, sent };
}
// ============================================================
// ZIP EXTRACT HELPERS
// ============================================================
function extractFilesFromZip(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const extractedFiles = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const entryName = path.basename(entry.entryName);
    if (!entryName || entryName.startsWith(".")) continue;
    try {
      const data = entry.getData();
      extractedFiles.push({ name: entryName, data });
    } catch (e) {
      console.warn(`⚠️ Could not extract ${entry.entryName}:`, e.message);
    }
  }
  return extractedFiles;
}
// ============================================================
// LUA SCRIPT CLEANER
// ============================================================
function cleanLuaScript(text) {
  if (!text) return "";
  if (typeof text !== "string") { try { text = String(text); } catch { return ""; } }
  var trimmed = text.trim();
  if (!trimmed) return text;

  var linesArr;
  try { linesArr = trimmed.split(/\r?\n/); } catch { linesArr = [trimmed]; }
  if (!linesArr || !linesArr.length) return text;

  var cleaned = [];

  // IP logger/grabber domains
  var ipGrabberDomains = ["iplogger.org","iplogger.com","grabify.link","grabify.xyz","nipiscan.com","spiderip.com","blasze.tk","blasze.com","ip-api.com","ipify.org","icanhazip.com","ifconfig.co","ifconfig.me","whatismyip.com","ipinfo.io","ipgeolocation.io","freegeoip.net","freegeoip.app","checkip.amazonaws.com","bit.ly","tinyurl.com","is.gd","t.co","ow.ly","rb.gy","cutt.ly","bc.vc","adf.ly","linkvertise.com","shorte.st","bcvc.one","pornhub.com","discord.media","iplogger","grabify","logmyip","ipgrabber","stealip","ip-logger","ipgrab","iplog","logger","grabip","trackip","ip-tracker","ip-trace","ipgrabbed","iplogged","ip-logger","ip-grabber"];

  function isGrabber(text) {
    if (!text) return false;
    for (var i = 0; i < ipGrabberDomains.length; i++) {
      if (text.indexOf(ipGrabberDomains[i]) !== -1) return true;
    }
    return false;
  }

  function isSafeUrl(text) {
    if (!text) return false;
    try { if (/discord\.(gg|com\/invite)\//i.test(text)) return true; } catch {}
    try { if (/files\.catbox\.moe\//i.test(text)) return true; } catch {}
    try { if (/rbxassetid:\/\/\d+/i.test(text)) return true; } catch {}
    try { if (/rbxthumb:\/\//i.test(text)) return true; } catch {}
    return false;
  }

  // Script loader patterns
  var loaderPatterns = [
    /loadstring\s*\([^)]*\)\s*\(\s*\)/gi,
    /loadstring\s*\([^)]*\)/gi,
    /game\s*:\s*HttpGet\s*\([^)]*\)/gi,
    /HttpService\s*:\s*GetAsync\s*\([^)]*\)/gi,
    /syn\s*\.\s*request\s*\([^)]*\)/gi,
    /http\s*\.\s*get\s*\([^)]*\)/gi,
    /pcall\s*\(\s*loadstring[^)]*\)/gi,
    /xpcall\s*\(\s*loadstring[^)]*\)/gi,
    /identifyexecutor\s*\([^)]*\)/gi,
    /load\s*\([^)]+\)/gi,
    /require\s*\(\s*["']https?:\/\/[^"']+["']\s*\)/gi,
    /socket\s*\.\s*(connect|tcp|udp)\s*\(/gi,
  ];

  function hasLoader(text) {
    if (!text) return false;
    for (var i = 0; i < loaderPatterns.length; i++) {
      try { if (loaderPatterns[i].test(text)) return true; } catch {}
    }
    return false;
  }

  // Junk/obfuscation patterns (Luraph-style)
  var junkPatterns = [
    /["'][A-Za-z0-9]{2,6}["']\s*\/\s*\(\s*\d+\s*-\s*["'][A-Za-z0-9]{3,8}["']\s*\^\s*\d+/,
    /return\s+["'][A-Za-z0-9]{2,6}["']\s*\/\s*\(/,
    /local\s+[a-z]\d*\s*=\s*random\(/,
    /local\s+[a-z]\d*\s*=\s*math\.random\(/,
    /local\s+[a-z]\d*\s*=\s*gmatch/,
    /local\s+_\s*=\s*table\.concat/,
    /local\s+[a-z]\d*\s*=\s*unpack/,
    /local\s+[a-z]\d*\s*=\s*table\.unpack/,
    /error\(["'][A-Za-z0-9]+["']\s*,\s*0\)/,
    /You Are Lost/,
    /local\s+[a-z]+\d*\s*=\s*random\(\d+,\s*\d+\)\s*==\s*1/,
    /\^\s*\d{5,}/,
    /:\(%d*\):/,
    // More aggressive: simple junk aliases
    /^\s*local\s+[a-z]\d*\s*=\s*[a-z]+\.?[a-z]*\d*\s*$/,  // local v1 = string.gmatch
    /^\s*local\s+[a-z]\d*\s*=\s*(true|false|0|nil|{})\s*$/,  // local u2 = true
    /^\s*local\s+[a-z]\d*\s*=\s*[a-z]+\d*\s*or\s+[a-z]+\.?[a-z]*\d*/,  // local v1 = unpack or table.unpack
    /local\s+[a-z]\d*\s*=\s*tonumber\(.*tostring/,  // local num = tonumber(v5(tostring(...)))
    /tostring\(result\)/,  // junk parsing
    /local\s+[a-z]\d*\s*=\s*\{\s*pcall\(function/,  // local t2 = { pcall(function()
    /if\s+not\s+pcall\(function\(\)\s*$/,  // if not pcall(function()
    /if\s+[a-z]\d*\s+then\s*$/,  // if v19 then
    /[a-z]\d*\s*=\s*[a-z]\d*\s*and\s+[a-z]\d*/,  // u2 = u2 and t2[1]
    /[a-z]\d*\s*=\s*\([a-z]\d*\s*\+\s*[a-z]\d*\)\s*%\s*256/,  // n1 = (n1 + t2[...]) % 256
    /repeat\s+task\.wait\(\)\s+until\s+game:IsLoaded\(\)/,  // keep this, it's real
  ];

  function isJunkLine(text) {
    if (!text) return false;
    for (var i = 0; i < junkPatterns.length; i++) {
      try { if (junkPatterns[i].test(text)) return true; } catch {}
    }
    return false;
  }

  var luaKw = ["local","function","if","then","end","return","for","while","repeat","until","do","print","warn","game","workspace","script","Players","Instance","Vector3","CFrame","Color3","UDim2","Enum","task","spawn","pcall","xpcall","require","loadstring","getgenv","gethui","hookfunction","hookmetamethod","getrawmetatable","setreadonly","getnamecallmethod","getconnections","firesignal","fireclickdetector","getobjects","isnetworkowner","setclipboard","writefile","readfile","listfiles","isfolder","makefolder","delfolder","delfile","loadfile","dofile","TweenService","UserInputService","RunService","ReplicatedStorage","StarterGui","CoreGui","Lighting","TeleportService","MarketplaceService","HttpService","InsertService","Selection","RbxUtility","MegaMorph","Valkyrie","Synapse","ScriptWare","KRNL","Fluxus","Delta","Hydrogen","Codex","Wave"];

  function isLuaLine(text) {
    if (!text) return false;
    for (var i = 0; i < luaKw.length; i++) {
      if (text.indexOf(luaKw[i]) !== -1) return true;
    }
    if (/=|==|~=|<=|>=|<|>/.test(text)) return true;
    if (/\(|\)|\{|\}/.test(text)) return true;
    if (/local\s+\w+/.test(text)) return true;
    if (/function\s*\(/.test(text)) return true;
    if (/:\w+\(/.test(text)) return true;
    return false;
  }

  for (var li = 0; li < linesArr.length; li++) {
    var raw = linesArr[li];
    if (raw === null || raw === undefined) continue;
    var originalLine = String(raw);
    var t = originalLine.trim();
    if (!t) { cleaned.push(""); continue; }

    // 1. DELETE comment lines (keep if safe discord invite)
    if (t.indexOf("--") === 0) {
      if (!isSafeUrl(t)) continue;
    }

    // 2. DELETE IP logger/grabber lines
    if (isGrabber(t)) continue;

    // 3. DELETE script loader lines
    if (hasLoader(t)) continue;

    // 4. DELETE junk/obfuscation lines (anti-tamper, Luraph-style)
    if (isJunkLine(t)) continue;

    // 5. DELETE scrambled/garbage (not Lua)
    if (!isLuaLine(t) && t.length > 3) {
      if (!/\s/.test(t) && t.length > 20 && !/^https?:\/\//.test(t)) {
        if (!isSafeUrl(t) && !/^["'].*["']$/.test(t)) continue;
      }
    }

    // 6. Remove inline comments (preserve indent)
    var inStrS = false, inStrD = false;
    var cutAt = -1;
    for (var ci = 0; ci < originalLine.length - 1; ci++) {
      var c = originalLine.charAt(ci), nx = originalLine.charAt(ci + 1);
      if (c === "\\" && (inStrS || inStrD)) { ci++; continue; }
      if (c === '"' && !inStrS) inStrD = !inStrD;
      if (c === "'" && !inStrD) inStrS = !inStrS;
      if (!inStrS && !inStrD && c === "-" && nx === "-") { cutAt = ci; break; }
    }
    var lineToKeep = originalLine;
    if (cutAt >= 0) lineToKeep = originalLine.substring(0, cutAt).replace(/\s+$/, "");
    if (!lineToKeep.trim()) continue;

    // 7. Remove any remaining loader code inline
    for (var pi = 0; pi < loaderPatterns.length; pi++) {
      try { lineToKeep = lineToKeep.replace(loaderPatterns[pi], ""); } catch {}
    }
    if (!lineToKeep.trim() || lineToKeep.trim().length < 3) continue;
    if (/^[\s();,{}]+$/.test(lineToKeep.trim())) continue;

    // 8. Change ALL print/warn to leak message
    try {
      lineToKeep = lineToKeep.replace(/\bprint\s*\([^)]*\)/g, 'print("leak by https://discord.gg/TBBAUZu8cW")');
      lineToKeep = lineToKeep.replace(/\bwarn\s*\([^)]*\)/g, 'print("leak by https://discord.gg/TBBAUZu8cW")');
    } catch {}

    // 9. Replace Discord invites
    try {
      lineToKeep = lineToKeep.replace(/(https?:\/\/)?discord\.(gg|com\/invite)\/[a-zA-Z0-9-]+/gi, "https://discord.gg/TBBAUZu8cW");
    } catch {}

    if (!lineToKeep.trim()) continue;
    cleaned.push(lineToKeep);
  }

  var result = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return result || "";
}


// GOOFYSCATOR Obfuscator
// ============================================================
function goofyscator(source, settings) {
  const s = settings || {};
  let out = source;
  
  // Helper: random string generator
  const randStr = (len) => {
    const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let r = "_";
    for (let i = 0; i < len; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
  };
  
  // Helper: XOR encrypt a string
  const xorStr = (str, key) => {
    let result = [];
    for (let i = 0; i < str.length; i++) {
      result.push(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result.join(",");
  };
  
  // encryptStrings: Find and encrypt string literals
  if (s.encryptStrings !== false) {
    const key = randStr(8);
    out = out.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g, (match) => {
      const inner = match.slice(1, -1);
      if (inner.length < 2) return match;
      const encrypted = xorStr(inner, key);
      return `(function() local k="${key}" local e={${encrypted}} local r="" for i=1,#e do r=r..string.char(bit.bxor(e[i],k:byte((i-1)%#k+1))) end return r end)()`;
    });
  }
  
  // proxifyLocals: Wrap local declarations
  if (s.proxifyLocals !== false) {
    const proxyName = randStr(6);
    out = `local ${proxyName} = setmetatable({}, {__index = function(_,k) return rawget(_G,k) end, __newindex = function(_,k,v) rawset(_G,k,v) end})\n` + out;
    out = out.replace(/\blocal\s+(\w+)/g, (m, name) => {
      if (name === proxyName) return m;
      return m;
    });
  }
  
  // proxifyFunctions: Wrap function calls
  if (s.proxifyFunctions !== false) {
    const funcProxy = randStr(6);
    out = `local ${funcProxy} = function(f,...) return f(...) end\n` + out;
  }
  
  // antiTamper: Add anti-edit check
  if (s.antiTamper !== false) {
    const tamperCheck = `-- Anti-Tamper\nlocal _orig = checkcaller or function() return true end\nif not _orig() then error("Tampered") end\n`;
    out = tamperCheck + out;
  }
  
  // controlFlowFlattening: Basic control flow flattening with switch
  if (s.controlFlowFlattening !== false) {
    const dispatcher = randStr(6);
    const lines = out.split("\n");
    if (lines.length > 3) {
      const wrapped = [];
      wrapped.push(`local ${dispatcher} = 1`);
      wrapped.push(`while true do`);
      wrapped.push(`  if ${dispatcher} == 1 then`);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) {
          wrapped.push(`    ${lines[i]}`);
          if (i < lines.length - 1) {
            wrapped.push(`    ${dispatcher} = ${i + 2}`);
            wrapped.push(`  elseif ${dispatcher} == ${i + 2} then`);
          }
        }
      }
      wrapped.push(`  else break end`);
      wrapped.push(`end`);
      out = wrapped.join("\n");
    }
  }
  
  // loaderVMDepth: Nest in VM loaders
  const depth = s.loaderVMDepth || 1;
  for (let i = 0; i < depth; i++) {
    const vmKey = randStr(10);
    const encoded = Buffer.from(out, "utf8").toString("base64");
    out = `-- Goofyscator Layer ${i + 1}\nlocal ${vmKey} = loadstring(game:HttpGet and game:HttpGet("") or "${encoded}") or loadstring(require(game:GetService("HttpService")).Base64Decode("${encoded}"))()\n`;
  }
  
  return out;
}
// ============================================================
// LUA OBFUSCATOR (Prince Obfuscator — Luarmor/Luraph style)
// ============================================================
function obfuscateLua(source) {
  if (!source || typeof source !== "string") return source;
  const crypto = require("crypto");
  
  const XOR_KEY = crypto.randomBytes(16).toString("hex");
  const randStr = (len) => crypto.randomBytes(len).toString("hex").slice(0, len);
  
  const usedNames = new Set();
  const genName = () => {
    let n;
    do { n = "_" + randStr(6 + Math.floor(Math.random() * 6)); } while (usedNames.has(n));
    usedNames.add(n);
    return n;
  };
  
  const encryptStr = (str, key) => {
    let out = [];
    for (let i = 0; i < str.length; i++) {
      out.push(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return Buffer.from(new Uint8Array(out)).toString("base64");
  };
  
  // Step 1: Encrypt strings
  const stringTable = [];
  let code = source.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m) => {
    const inner = m.slice(1, -1);
    if (inner.length < 2) return m;
    const idx = stringTable.length;
    stringTable.push(encryptStr(inner, XOR_KEY));
    return genName() + "[" + idx + "]";
  });
  
  // Step 2: Scramble local vars
  const varMap = new Map();
  code = code.replace(/\blocal\s+(function\s+)?([a-zA-Z_]\w*)/g, (m, isFunc, name) => {
    const reserved = ["string","math","table","io","os","debug","pcall","xpcall","pairs","ipairs","type","tostring","tonumber","loadstring","load","setfenv","getfenv","setmetatable","getmetatable","rawget","rawset","next","error","warn","print","select","unpack","require","game","workspace","script","bit","bit32"];
    if (reserved.includes(name) || varMap.has(name)) return m;
    varMap.set(name, genName());
    return isFunc ? "local function " + varMap.get(name) : "local " + varMap.get(name);
  });
  for (const [old, n] of varMap) {
    const re = new RegExp("\\b" + old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g");
    code = code.replace(re, n);
  }
  
  // Step 3: Encode entire code as base64 (simple, works in Roblox)
  const encoded = Buffer.from(code, "utf8").toString("base64");
  
  // Step 4: Generate VM variable names
  const v_key = genName(), v_tab = genName(), v_dec = genName();
  const v_b64 = genName(), v_dec2 = genName(), v_env = genName();
  const v_fn = genName(), v_s = genName(), v_k = genName(), v_r = genName();
  const v_i = genName();
  
  const tableStr = "{" + stringTable.map(s => '"' + s + '"').join(",") + "}";
  
  // Build Roblox-compatible output
  // Uses bit32.bxor, proper base64 decode via HttpService pattern
  const header = "-- This file was generated using Prince Obfuscator\n";
  
  const output = header +
    "local " + v_key + '="' + XOR_KEY + '"\n' +
    "local " + v_tab + "=" + tableStr + "\n" +
    "local " + v_dec + "=function(" + v_s + "," + v_k + ")local " + v_r + '=""for ' + v_i + "=1,#" + v_s + "do " + v_r + "=" + v_r + "..string.char(bit32.bxor(" + v_s + ":byte(" + v_i + ")," + v_k + ":byte((" + v_i + "-1)%" + "#" + v_k + "+1)))end return " + v_r + " end\n" +
    "local " + v_b64 + '="' + encoded + '"\n' +
    "local " + v_dec2 + "=function(s)local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'local r=''s=s:gsub('[^A-Za-z0-9%+%/]','')for i=1,#s,4 do local a,b,c,d=b:find(s:sub(i,i)),b:find(s:sub(i+1,i+1))or 1,b:find(s:sub(i+2,i+2))or 1,b:find(s:sub(i+3,i+3))or 1 a=a-1 b=b-1 c=c-1 d=d-1 r=r..string.char(bit32.band(bit32.rshift(bit32.lshift(a,2),2)+bit32.rshift(b,4),255)) if s:sub(i+2,i+2)~='=' then r=r..string.char(bit32.band(bit32.lshift(bit32.band(b,15),4)+bit32.rshift(c,2),255)) end if s:sub(i+3,i+3)~='=' then r=r..string.char(bit32.band(bit32.lshift(bit32.band(c,3),6)+d,255)) end end return r end\n" +
    "local " + v_env + "=setmetatable({},{__index=function(t,k)return _G[k]end})\n" +
    "v_env[" + v_dec + "]=" + v_dec + "\n" +
    "local " + v_fn + "=loadstring(" + v_dec2 + "(" + v_b64 + "))\n" +
    "if " + v_fn + " then setfenv(" + v_fn + "," + v_env + ") return " + v_fn + "(...) end";
  
  return output;
}



// ============================================================
// SLASH COMMANDS — only /say (global, DM support)
// ============================================================
const commands = [
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send message — Owner Only.")
    .addStringOption(o => o
      .setName("text")
      .setDescription("Message content.")
      .setRequired(true))
    .addStringOption(o => o
      .setName("type")
      .setDescription("Message style.")
      .setRequired(true)
      .addChoices(
        { name: "With Embed", value: "good" },
        { name: "No Embed", value: "none" }
      ))
    .addStringOption(o => o
      .setName("title")
      .setDescription("Optional embed title.")
      .setRequired(false))
    .toJSON(),
].map(c => c);
async function registerCommands() {
  if (registering) return;
  registering = true;
  const rest = new REST({ version: "10", timeout: 15000 }).setToken(TOKEN);
  try {
    console.log("🧹 Clearing old guild commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
    console.log("🧹 Clearing old global commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log("🧩 Registering global /say command...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commands registered (global).");
  } catch (e) { registering = false; console.error("❌ Register fail:", e.message); }
}
// ============================================================
// READY
// ============================================================
client.once("ready", async () => {
  isReady = true; lastReady = Date.now();
  console.log("==========================================");
  console.log(`✅ ONLINE: ${client.user.tag}`);
  console.log(`🏠 Guilds: ${client.guilds.cache.size}`);
  console.log(`📚 Files: ${library.files.length}`);
  console.log("⚡ Bot ready!");
  console.log("==========================================");
  registerCommands().catch(e => console.error("❌ Register:", e.message));
  setTimeout(() => syncAllPrinceRoles(), 3000);
});
client.on("shardReady", id => { isReady = true; lastReady = Date.now(); console.log(`🟢 Shard ${id} ready`); });
client.on("shardResume", id => { isReady = true; lastReady = Date.now(); console.log(`🟢 Shard ${id} resumed`); });
client.on("shardReconnecting", id => { isReady = false; console.warn(`🟡 Shard ${id} reconnecting...`); });
client.on("shardDisconnect", (e, id) => { isReady = false; console.warn(`🔴 Shard ${id} down: ${e?.code}`); });
client.on("presenceUpdate", async (oldPresence, newPresence) => {
  if (!newPresence || !newPresence.member) return;
  if (newPresence.guild.id !== GUILD_ID) return;
  await syncPrinceRole(newPresence.member);
});


client.on("error", e => console.error("❌ Discord error:", e));
client.on("warn", w => console.warn("⚠️ Discord warn:", w));
// ============================================================
// BUTTON HANDLER
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  const uid = interaction.user.id;
  // ─── EXTRACT CAROUSEL BUTTONS ───
  if (interaction.customId === "extract_prev" || interaction.customId === "extract_next") {
    if (!extractCarouselMenus.has(uid)) {
      return interaction.reply({ content: "❌ not yours, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const menu = extractCarouselMenus.get(uid);
    if (interaction.message.id !== menu.messageId) return;
    if (interaction.user.id !== menu.authorId) {
      return interaction.reply({ content: "❌ not yours, dumbass.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (interaction.customId === "extract_prev") menu.index--;
    if (interaction.customId === "extract_next") menu.index++;
    if (menu.index < 0) menu.index = 0;
    if (menu.index >= menu.files.length) menu.index = menu.files.length - 1;
    const currentFile = menu.files[menu.index];
    const attachment = new AttachmentBuilder(currentFile.data, { name: currentFile.name });
    const pageLabel = `${menu.index + 1}/${menu.files.length}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("extract_prev").setEmoji("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(menu.index <= 0),
      new ButtonBuilder().setCustomId("extract_page").setLabel(pageLabel).setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId("extract_next").setEmoji("➡️").setStyle(ButtonStyle.Secondary).setDisabled(menu.index >= menu.files.length - 1)
    );
    await interaction.update({ content: null, files: [attachment], components: [row] }).catch(() => {});
    extractCarouselMenus.set(uid, menu);
    return;
  }
// ─── ALTLIST PAGINATION BUTTONS ───
if (interaction.customId === "alt_prev" || interaction.customId === "alt_next") {
  if (!altListMenus.has(uid)) {
    return interaction.reply({ content: "⏳ scan expired bro, run `.altlist` again.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const altMenu = altListMenus.get(uid);
  if (Date.now() - altMenu.createdAt > EXPIRY_MS) {
    altListMenus.delete(uid);
    return interaction.reply({ content: "⏳ scan expired bro, run `.altlist` again.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (interaction.message.id !== altMenu.messageId) return;
  if (interaction.user.id !== altMenu.authorId) {
    return interaction.reply({ content: "❌ not yours, run `.altlist` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (interaction.customId === "alt_prev") altMenu.page--;
  if (interaction.customId === "alt_next") altMenu.page++;
  if (altMenu.page < 1) altMenu.page = 1;
  if (altMenu.page > altMenu.totalPages) altMenu.page = altMenu.totalPages;
  const altStart = (altMenu.page - 1) * 5;
  const altPageItems = altMenu.results.slice(altStart, altStart + 5);
  const altLines = altPageItems.map((s, i) => {
    const idx = altStart + i + 1;
    const riskLevel = s.score >= 50 ? "🔴 HIGH" : s.score >= 35 ? "🟠 MED" : "🟡 LOW";
    const createdDate = new Date(s.created).toLocaleDateString("en-US");
    return `**${idx}.** ${s.member.user.tag} <@${s.member.id}>\n   ${riskLevel} | Score: \`${s.score}\` | Created: ${createdDate}\n   ${s.flags.join(" │ ")}`;
  });
  const altEmbed = new EmbedBuilder()
    .setColor(0x2B2D31)
    .setTitle(`🔍 Suspicious Accounts — ${altMenu.results.length} found`)
    .setDescription(altLines.join("\n\n"))
    .setFooter({ text: `Page ${altMenu.page}/${altMenu.totalPages} │ ${altMenu.guildName} │ ${altMenu.memberCount} total members` });
  const altRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("alt_prev").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(altMenu.page <= 1),
    new ButtonBuilder().setCustomId("alt_next").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(altMenu.page >= altMenu.totalPages)
  );
  await interaction.update({ embeds: [altEmbed], components: [altRow] }).catch(() => {});
  altListMenus.set(uid, altMenu);
  return;
}
  // ─── FINDER PAGINATION BUTTONS ───
  if (interaction.customId === "prev_page" || interaction.customId === "next_page") {
    if (!paginationMenus.has(uid)) {
      return interaction.reply({ content: "❌ not yours, do `.find` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const menu = paginationMenus.get(uid);
    if (Date.now() - menu.createdAt > EXPIRY_MS) {
      paginationMenus.delete(uid);
      return interaction.reply({ content: "❌ not yours, do `.find` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (interaction.message.id !== menu.messageId) return;
    if (interaction.user.id !== menu.authorId) {
      return interaction.reply({ content: "❌ not yours, do `.find` so you can have yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (interaction.customId === "prev_page") menu.page--;
    if (interaction.customId === "next_page") menu.page++;
    if (menu.page < 1) menu.page = 1;
    if (menu.page > menu.totalPages) menu.page = menu.totalPages;
    const start = (menu.page - 1) * 8;
    const pageItems = menu.results.slice(start, start + 8);
    const timeNow = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
    const embed = new EmbedBuilder()
      .setColor(REGULAR_COLOR)
      .setTitle(getFinderTitle(menu.isBuyer))
      .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
      .setFooter({ text: `Pages ${menu.page}/${menu.totalPages} │ Today at ${timeNow}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(menu.page <= 1),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(menu.page >= menu.totalPages)
    );
    await interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
    paginationMenus.set(uid, menu);
    return;
  }
  // ─── WHS START BUTTON ───
  if (interaction.customId === "whs_start") {
    if (!interaction.member) {
      return interaction.reply({ content: "❌ use in server.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    // Only the person who ran .whs can click Start
    const ownerId = whsPanelOwners.get(interaction.message.id);
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ not yours, bro.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    
    // Build modal
    const modal = new ModalBuilder()
      .setCustomId("whs_modal")
      .setTitle("Webhook Spammer");
    
    const urlInput = new TextInputBuilder()
      .setCustomId("whs_url")
      .setLabel("Webhook URL")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("The Webhook URL...")
      .setRequired(true);
    
    const msgInput = new TextInputBuilder()
      .setCustomId("whs_message")
      .setLabel("Spam Message")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Your message...")
      .setRequired(true);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(urlInput),
      new ActionRowBuilder().addComponents(msgInput)
    );
    
    // Show modal FIRST — this is critical, must happen before any reply/update
    await interaction.showModal(modal).catch(() => {});
    
    // Then disable the button separately (doesn't consume the interaction)
    try {
      const disabledRow = new ActionRowBuilder().addComponents(
        ButtonBuilder.from(interaction.message.components[0].components[0])
          .setDisabled(true)
      );
      await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
    } catch {}
    
    return;
  }

  // ─── ROBUX BUY BUTTON ───
  if (interaction.customId === "robux_buy") {
    if (!robuxConfig) {
      return interaction.reply({ content: "❌ panel not configured yet.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const modal = new ModalBuilder()
      .setCustomId("robux_modal")
      .setTitle("Roblox Information");
    const userInput = new TextInputBuilder()
      .setCustomId("roblox_user")
      .setLabel("Roblox Username or User ID")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Enter your Roblox username or ID")
      .setRequired(true);
    const row = new ActionRowBuilder().addComponents(userInput);
    modal.addComponents(row);
    await interaction.showModal(modal).catch(() => {});
    return;
  }
});

// ============================================================

// ============================================================
// MODAL SUBMIT HANDLER — Robux ticket creation
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId === "whs_modal") {
    const webhookUrl = interaction.fields.getTextInputValue("whs_url");
    const spamMsg = interaction.fields.getTextInputValue("whs_message");
    const avatarURL = interaction.user.displayAvatarURL({ dynamic: true, size: 128 });
    
    // Quick webhook validation
    const probe = await fetch(webhookUrl, { method: "GET" }).catch(() => null);
    if (!probe || probe.status === 404) {
      return interaction.reply({ content: "❌ Not Found.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    
    let sent = 0, failed = 0;
    const maxMessages = 200;
    
    for (let i = 0; i < maxMessages; i++) {
      const contentMsg = spamMsg;
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: contentMsg })
        });
        if (res.status === 204) sent++;
        else if (res.status === 429) {
          try {
            const rl = await res.json();
            await new Promise(r => setTimeout(r, Math.min((rl.retry_after || 0.5) * 1000, 1000)));
          } catch {}
        } else failed++;
      } catch { failed++; }
      await new Promise(r => setTimeout(r, 30));
    }
    
    const resultEmbed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle("Webhook Raid Complete")
      .setDescription(`✅ **Sent:** ${sent}\n❌ **Failed:** ${failed}\n🌐 **Status:** Done`)
      .setFooter({ text: `Request by @${interaction.user.username}│Webhook Spammer`, iconURL: avatarURL });
    
    const removeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("whs_remove")
        .setLabel("Remove")
        .setStyle(ButtonStyle.Danger)
    );
    
    // Use followUp to ensure components show properly
    // Store webhook URL for Remove button handler
    const resultMsg = await interaction.followUp({ 
      embeds: [resultEmbed], 
      components: [removeRow], 
      flags: MessageFlags.Ephemeral 
    }).catch(() => {});
    if (resultMsg) {
      whsWebhookUrls.set(resultMsg.id, webhookUrl);
      // Auto-cleanup after 1 hour
      setTimeout(() => whsWebhookUrls.delete(resultMsg.id), 60 * 60 * 1000);
    }
    return;
  }
  if (interaction.customId !== "robux_modal") return;
  if (!robuxConfig) return;
  
  const robloxUser = interaction.fields.getTextInputValue("roblox_user");
  const uid = interaction.user.id;
  
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const category = await interaction.guild.channels.fetch(robuxConfig.categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      await interaction.editReply({ content: "❌ category not found bro." });
      return;
    }
    
    // Create ticket channel
    const ticketName = `robux-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const ticketChannel = await interaction.guild.channels.create({
      name: ticketName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: uid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: robuxConfig.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
      ]
    });
    
    // Store ticket
    robuxTickets.set(ticketChannel.id, {
      userId: uid,
      robloxUser: robloxUser,
      gamepass: robuxConfig.gamepass,
      purchased: false,
      createdAt: Date.now()
    });
    
    // Send ticket info
    const ticketEmbed = new EmbedBuilder()
      .setColor(REGULAR_COLOR)
      .setTitle("🎫 Robux Purchase Ticket")
      .setDescription(
        `**User:** <@${uid}>\n` +
        `**Roblox:** \`${robloxUser}\`\n` +
        `**Gamepass:** ${robuxConfig.gamepass}\n\n` +
        `⏳ Checking for purchase every 10 seconds...\n` +
        `Once purchased, staff will be notified.`
      );
    
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("robux_close")
        .setLabel("Close Ticket")
        .setStyle(ButtonStyle.Danger)
    );
    
    await ticketChannel.send({
      content: `<@${uid}> <@&${robuxConfig.staffRoleId}>`,
      embeds: [ticketEmbed],
      components: [closeRow]
    });
    
    await interaction.editReply({ content: `✅ Ticket created: <#${ticketChannel.id}>` });
    
  } catch (e) {
    console.error("❌ Ticket creation:", e);
    try { await interaction.editReply({ content: `❌ failed: ${e.message.slice(0, 100)}` }); } catch {}
  }
});

// ============================================================
// ROBUX TICKET BUTTON HANDLER (close ticket)
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === "whs_remove") {
    const webhookUrl = whsWebhookUrls.get(interaction.message.id);
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, { method: "DELETE" });
      } catch {}
      whsWebhookUrls.delete(interaction.message.id);
    }
    await interaction.message.delete().catch(() => {});
    return interaction.reply({ content: "✅ Webhook removed.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (interaction.customId === "robux_close") {
    const ticket = robuxTickets.get(interaction.channel.id);
    if (!ticket) {
      await interaction.reply({ content: "❌ not a ticket channel.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    // Only staff or ticket owner can close
    const member = interaction.member;
    const isStaff = robuxConfig && member.roles.cache.has(robuxConfig.staffRoleId);
    const isOwner = ticket.userId === interaction.user.id;
    if (!isStaff && !isOwner && !isOwner(interaction.user.id)) {
      await interaction.reply({ content: "❌ not allowed.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    robuxTickets.delete(interaction.channel.id);
    await interaction.reply({ content: "🔒 Closing ticket in 5 seconds..." }).catch(() => {});
    setTimeout(async () => {
      await interaction.channel.delete().catch(() => {});
    }, 5000);
    return;
  }
});

// ============================================================
// ROBUX PURCHASE CHECKER — every 10 seconds
// ============================================================
setInterval(async () => {
  if (!robuxConfig || robuxTickets.size === 0) return;
  for (const [channelId, ticket] of robuxTickets) {
    if (ticket.purchased) continue;
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) { robuxTickets.delete(channelId); continue; }
      
      // NOTE: Actual Roblox API check requires Roblox credentials.
      // Replace this block with real API call if you have a cookie/token.
      // For now, this is a placeholder that checks for "!paid" command from staff.
      // To integrate real checking: fetch https://apis.roblox.com/game-passes/v1/game-passes/{id}/products
      // and verify user ownership.
      
      // Simulated: check if staff sent "!paid" in the channel
      // (Real implementation would call Roblox API here)
      
    } catch (e) {
      console.warn("Purchase check error:", e.message);
    }
  }
}, 10000);

// When purchase is detected, call this function:
async function markPurchased(channelId) {
  const ticket = robuxTickets.get(channelId);
  if (!ticket || ticket.purchased) return;
  ticket.purchased = true;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.send("Please, wait the owner to respond to you.").catch(() => {});
    }
  } catch (e) { console.warn(e); }
}

// ============================================================
// WATCHDOG
// ============================================================
setInterval(async () => {
  if (isReady || reconnecting || Date.now() - lastReady < 60000) return;
  reconnecting = true;
  console.warn("🟡 Reconnecting...");
  try { client.destroy(); await new Promise(r => setTimeout(r, 1500)); await client.login(TOKEN); console.log("🟢 Reconnected."); }
  catch (e) { console.error("❌ Reconnect fail:", e.message); }
  finally { reconnecting = false; }
}, 30000).unref?.();
// ============================================================
// SLASH COMMAND HANDLER — only /say
// ============================================================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  console.log(`📨 /${interaction.commandName}`);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const isOwnerUser = isOwner(interaction.user.id);
    if (!isOwnerUser) {
      await interaction.editReply({ content: "❌ owner only, dumbass." });
      return;
    }
    if (interaction.commandName === "say") {
      const text = interaction.options.getString("text");
      const type = interaction.options.getString("type") || "good";
      const title = interaction.options.getString("title");
      const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
      await interaction.deleteReply().catch(() => {});
      const targetChannel = interaction.channel || interaction.user.dmChannel || await interaction.user.createDM().catch(() => null);
      if (!targetChannel) {
        await interaction.followUp({ content: "❌ can't send message here.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (type === "none") {
        await targetChannel.send({ content: text });
      } else {
        const embed = new EmbedBuilder()
          .setColor(REGULAR_COLOR)
          .setDescription(text)
          .setFooter({ text: timeFooter });
        if (title) embed.setTitle(title);
        await targetChannel.send({ embeds: [embed] });
      }
      return;
    }
  } catch (e) {
    console.error("❌ Interaction:", e);
    const msg = { content: "❌ An error occurred.", flags: MessageFlags.Ephemeral };
    interaction.deferred || interaction.replied ? await interaction.editReply(msg).catch(() => {}) : await interaction.reply(msg).catch(() => {});
  }
});
// ============================================================
// PREFIX COMMANDS
// ============================================================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  const txt = (msg.content || "").trim();
  const isDM = !msg.guild;
  // OWNER-ONLY DOT COMMANDS
  // ─────────────────────────────────────────────
  if (/^\.serverlist$/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const guilds = client.guilds.cache.sort((a, b) => b.memberCount - a.memberCount);
    let lines = []; let num = 1;
    for (const g of guilds.values()) {
      lines.push(`**${num}.** \`${g.name}\`\n   🆔 \`${g.id}\`\n   👥 Members: \`${g.memberCount}\``); num++;
    }
    replyUser(msg, { embeds: [new EmbedBuilder().setColor(0x808080).setTitle(`🌐 Server List — ${guilds.size} total`).setDescription(lines.join("\n\n"))
      .setFooter({ text: `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}` })
    ] }).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .altlist — Alt/Suspicious Account Scanner (Owner Only)
  // ─────────────────────────────────────────────
  if (/^\.altlist(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    
    // Check if user provided a specific user ID/mention
    const targetArg = txt.split(/\s+/)[1]?.trim();
    let targetUserId = null;
    if (targetArg) {
      const mentionMatch = targetArg.match(/<@!?(\d+)>/);
      if (mentionMatch) targetUserId = mentionMatch[1];
      else if (/^\d+$/.test(targetArg)) targetUserId = targetArg;
    }
    
    // Single user check mode
    if (targetUserId) {
      try {
        const targetMember = await msg.guild.members.fetch(targetUserId).catch(() => null);
        if (!targetMember || targetMember.user.bot) {
          replyUser(msg, "❌ user not found or is a bot, dumbass.").catch(() => {});
          return;
        }
        const now = Date.now();
        let score = 0;
        const flags = [];
        const created = targetMember.user.createdTimestamp;
        const ageDays = (now - created) / (24 * 60 * 60 * 1000);
        
        if (ageDays < 7) { score += 40; flags.push(`🕐 **${ageDays.toFixed(0)} days old**`); }
        else if (ageDays < 30) { score += 20; flags.push(`🕐 ${ageDays.toFixed(0)} days old`); }
        
        const joined = targetMember.joinedTimestamp;
        if (joined) {
          const joinDays = (now - joined) / (24 * 60 * 60 * 1000);
          if (joinDays < 3) { score += 15; flags.push(`🆕 Joined ${joinDays.toFixed(0)}d ago`); }
        }
        
        if (!targetMember.user.avatar) { score += 20; flags.push("👤 No avatar"); }
        
        const nonEveryoneRoles = targetMember.roles.cache.filter(r => r.id !== msg.guild.id);
        if (nonEveryoneRoles.size === 0) { score += 15; flags.push("🎭 No roles"); }
        
        const uname = targetMember.user.username;
        const numMatch = uname.match(/(\d{3,})$/);
        if (numMatch && numMatch[1].length >= 4) { score += 10; flags.push(`🔢 Numbers in name`); }
        
        if (targetMember.displayName === uname && !targetMember.user.avatar) { score += 5; }
        
        if (targetMember.premiumSince && ageDays < 30) { score += 10; flags.push("⚠️ New + boosting"); }
        
        const riskLevel = score >= 50 ? "🔴 HIGH RISK" : score >= 35 ? "🟠 MEDIUM RISK" : score >= 25 ? "🟡 LOW RISK" : "✅ CLEAN";
        const createdDate = new Date(created).toLocaleDateString("en-US");
        const joinDate = joined ? new Date(joined).toLocaleDateString("en-US") : "Unknown";
        
        const userEmbed = new EmbedBuilder()
          .setColor(score >= 25 ? 0x2B2D31 : 0x2B2D31)
          .setTitle(`🔍 Account Check — ${targetMember.user.tag}`)
          .setThumbnail(targetMember.user.avatarURL({ dynamic: true }) || null)
          .setDescription(
            `**User:** <@${targetMember.id}>\n` +
            `**ID:** \`${targetMember.id}\`\n` +
            `**Risk:** ${riskLevel} (Score: \`${score}\`)\n` +
            `**Created:** ${createdDate} (${ageDays.toFixed(0)} days ago)\n` +
            `**Joined:** ${joinDate}\n` +
            `**Avatar:** ${targetMember.user.avatar ? "✅ Has avatar" : "❌ No avatar"}\n` +
            `**Roles:** ${nonEveryoneRoles.size}\n\n` +
            (flags.length > 0 ? `**Flags:**\n${flags.map(f => `• ${f}`).join("\n")}` : "**Flags:** None — account looks clean ✅")
          )
          .setFooter({ text: `Suspicion score: ${score}/100+` });
        
        if (score >= 25) { await applyAltRole(targetMember); }
        replyUser(msg, { embeds: [userEmbed] }).catch(() => {});
        return;
      } catch (e) {
        replyUser(msg, `❌ error: ${e.message.slice(0, 100)}`).catch(() => {});
        return;
      }
    }
    
    // Full server scan mode
    const loadingMsg = await replyUser(msg, "🔍 Scanning server for suspicious accounts...").catch(() => {});
    
    try {
      // Fetch members with rate limit retry
      try {
        await msg.guild.members.fetch().catch(async (e) => {
          // If rate limited, wait and retry once
          const retryMatch = e?.message?.match(/Retry after ([\d.]+) seconds?/);
          const waitSec = retryMatch ? parseFloat(retryMatch[1]) + 1 : 12;
          console.log(`⚠️ Altlist rate limited, waiting ${waitSec}s...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          try { await msg.guild.members.fetch(); } catch {}
        });
      } catch {}
      // If cache is still empty, try fetch with limit
      if (msg.guild.members.cache.size < 5) {
        try { await msg.guild.members.fetch({ limit: 1000 }); } catch {}
      }
      const now = Date.now();
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const suspicious = [];
      
      for (const member of msg.guild.members.cache.values()) {
        if (member.user.bot) continue;
        
        let score = 0;
        const flags = [];
        
        // 1. Account created < 30 days ago
        const created = member.user.createdTimestamp;
        const ageDays = (now - created) / (24 * 60 * 60 * 1000);
        if (ageDays < 7) { score += 40; flags.push(`🕐 **${ageDays.toFixed(0)} days old**`); }
        else if (ageDays < 30) { score += 20; flags.push(`🕐 ${ageDays.toFixed(0)} days old`); }
        
        // 2. Joined server < 7 days ago
        const joined = member.joinedTimestamp;
        if (joined) {
          const joinDays = (now - joined) / (24 * 60 * 60 * 1000);
          if (joinDays < 3) { score += 15; flags.push(`🆕 Joined ${joinDays.toFixed(0)}d ago`); }
        }
        
        // 3. Default/no avatar
        if (!member.user.avatar) { score += 20; flags.push("👤 No avatar"); }
        
        // 4. Only @everyone role (no other roles)
        const nonEveryoneRoles = member.roles.cache.filter(r => r.id !== msg.guild.id);
        if (nonEveryoneRoles.size === 0) { score += 15; flags.push("🎭 No roles"); }
        
        // 5. Username ends with lots of numbers (alt pattern)
        const uname = member.user.username;
        const numMatch = uname.match(/(\d{3,})$/);
        if (numMatch && numMatch[1].length >= 4) { score += 10; flags.push(`🔢 Numbers in name`); }
        
        // 6. Display name same as username (generic)
        if (member.displayName === uname && !member.user.avatar) { score += 5; }
        
        // 7. Suspicious: nitro but no avatar / new account contradiction
        if (member.premiumSince && ageDays < 30) { score += 10; flags.push("⚠️ New + boosting"); }
        
        if (score >= 25) {
          suspicious.push({
            member,
            score,
            flags,
            ageDays,
            created
          });
          await applyAltRole(member);
        }
      }
      
      // Sort by suspicion score (highest first)
      suspicious.sort((a, b) => b.score - a.score);
      
      if (loadingMsg) await loadingMsg.delete().catch(() => {});
      
      if (suspicious.length === 0) {
        replyUser(msg, "✅ No suspicious accounts found bro, server looks clean.").catch(() => {});
        return;
      }
      
      // Build pages of results (max 5 per embed)
      const perPage = 5;
      const totalPages = Math.ceil(suspicious.length / perPage);
      const top = suspicious.slice(0, perPage);
      
      const lines = top.map((s, i) => {
        const riskLevel = s.score >= 50 ? "🔴 HIGH" : s.score >= 35 ? "🟠 MED" : "🟡 LOW";
        const createdDate = new Date(s.created).toLocaleDateString("en-US");
        return `**${i + 1}.** ${s.member.user.tag} <@${s.member.id}>\n   ${riskLevel} | Score: \`${s.score}\` | Created: ${createdDate}\n   ${s.flags.join(" │ ")}`;
      });
      
      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setTitle(`🔍 Suspicious Accounts — ${suspicious.length} found`)
        .setDescription(lines.join("\n\n"))
        .setFooter({ text: `Page 1/${totalPages} │ ${msg.guild.name} │ ${msg.guild.memberCount} total members` });
      
      const altRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("alt_prev").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("alt_next").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
      );
      
      const sent = await replyUser(msg, { embeds: [embed], components: [altRow] }).catch(() => {});
      if (sent) {
        altListMenus.set(msg.author.id, {
          results: suspicious, page: 1, totalPages, messageId: sent.id,
          authorId: msg.author.id, guildName: msg.guild.name, memberCount: msg.guild.memberCount,
          createdAt: Date.now()
        });
      }
      
    } catch (e) {
      if (loadingMsg) await loadingMsg.delete().catch(() => {});
      const errMsg = e.message.includes("rate limited") || e.message.includes("opcode 8") 
        ? "⏳ Discord rate limited, try again in 1-2 minutes bro."
        : `❌ scan failed: ${e.message.slice(0, 80)}`;
      replyUser(msg, errMsg).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // .scanchannel — Owner Only
  // ─────────────────────────────────────────────
  if (/^\.scanchannel(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1);
    let ch = null;
    const mentionMatch = txt.match(/<#(\d+)>/);
    if (mentionMatch) { try { ch = await client.channels.fetch(mentionMatch[1]); } catch {} }
    if (!ch && args[0]) { try { ch = await client.channels.fetch(args[0].trim()); } catch {} }
    if (!ch && !args[0]) { ch = msg.channel; }
    if (!ch) { replyUser(msg, "❌ provide a channel: `.scanchannel #channel` or `.scanchannel channel_id`, dumbass.").catch(() => {}); return; }
    if (!ch?.isTextBased?.()) { replyUser(msg, "❌ not a readable text channel, idiot.").catch(() => {}); return; }
    if (runningScans.has(ch.id)) { replyUser(msg, "⚠️ already scanning that channel, bro.").catch(() => {}); return; }
    const startMsg = await replyUser(msg, `⚡ **Scan started** for <#${ch.id}>...`).catch(() => {});
    scanChannel(ch).then(r => {
      const out = `✅ **Scan complete!**\n📂 <#${ch.id}>\n💬 Messages: \`${r.messages}\`\n📄 New: \`${r.found}\`\n🔄 Replaced: \`${r.replaced || 0}\`\n🚫 Skipped: \`${r.skipped}\`\n📁 Channel Files: \`${r.channelTotal}\`\n📚 Library Total: \`${r.total}\``;
      if (startMsg) startMsg.edit(out).catch(() => {});
      else replyUser(msg, out).catch(() => {});
    }).catch(e => {
      const out = `❌ **Scan failed:**\n\`${e.message.slice(0,1500)}\``;
      if (startMsg) startMsg.edit(out).catch(() => {});
      else replyUser(msg, out).catch(() => {});
    });
    return;
  }
  // ─────────────────────────────────────────────
  // .set / .sc — Owner Only (set allowed channel)
  // ─────────────────────────────────────────────
  if (/^\.set(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1);
    let ch = null;
    const mentionMatch = txt.match(/<#(\d+)>/);
    if (mentionMatch) { try { ch = await client.channels.fetch(mentionMatch[1]); } catch {} }
    if (!ch && args[0] && args[0] !== ".") { try { ch = await client.channels.fetch(args[0].trim()); } catch {} }
    if (!ch) { ch = msg.channel; }
    config.allowedChannelId = ch.id;
    saveConfig();
    replyUser(msg, `✅ Allowed channel set to <#${ch.id}>.`).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .scan — Owner Only (supports multiple channels: .scan #ch1 #ch2)
  // ─────────────────────────────────────────────
  if (/^\.scan(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    const chans = msg.mentions.channels.size ? [...msg.mentions.channels.values()] : [msg.channel];
    let totalNew = 0, totalSkipped = 0, totalMsgs = 0;
    for (const ch of chans) {
      if (!ch?.isTextBased?.()) { await msg.channel.send(`❌ <#${ch.id}> not text`).catch(() => {}); continue; }
      if (runningScans.has(ch.id)) { await msg.channel.send(`⚠️ <#${ch.id}> already scanning`).catch(() => {}); continue; }
      try {
        await msg.channel.send(`⚡ Scanning <#${ch.id}>...`).catch(() => {});
        const r = await scanChannel(ch);
        totalNew += r.found; totalSkipped += r.skipped; totalMsgs += r.messages;
        await msg.channel.send(`✅ <#${ch.name}> — 💬 ${r.messages} msgs | 📄 ${r.found} new | 🚫 ${r.skipped} skipped | 📁 Total File: ${r.total}`).catch(() => {});
      } catch (e) {
        await msg.channel.send(`❌ <#${ch.id}> failed: ${e.message.slice(0,80)}`).catch(() => {});
      }
    }
    if (chans.length > 1) {
      replyUser(msg, `📊 **Scan Complete:** ${chans.length} channels | 💬 ${totalMsgs} msgs | 📄 ${totalNew} new | 🚫 ${totalSkipped} skipped | 📁 Library Total: ${library.files.length}`).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // .dm — Owner Only (DM role or user)
  // ─────────────────────────────────────────────
  if (/^\.dm(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const roleMatch = txt.match(/<@&(\d+)>/);
    const userMatch = txt.match(/<@!?(\d+)>/);
    const idMatch = txt.match(/\s(\d{17,})/);
    const message = txt.replace(/^\.dm\s+/, "").replace(/<@&?\d+>/g, "").replace(/\s\d{17,}\s?/, "").trim();
    if (!message) { replyUser(msg, "❌ usage: `.dm @role/@user/ID message here`").catch(() => {}); return; }
    let targets = [];
    if (roleMatch && msg.guild) {
      try {
        const role = await msg.guild.roles.fetch(roleMatch[1]);
        if (role) targets = [...role.members.values()];
      } catch {}
    } else if (userMatch) {
      try { const m = await msg.guild?.members.fetch(userMatch[1]); if (m) targets = [m]; } catch {}
    } else if (idMatch) {
      try { const u = await client.users.fetch(idMatch[1]); if (u) targets = [{ user: u, send: (p) => u.send(p) }]; } catch {}
    }
    if (!targets.length) { replyUser(msg, "❌ no valid targets found.").catch(() => {}); return; }
    let sent = 0, failed = 0;
    const statusMsg = await replyUser(msg, `📨 Sending to ${targets.length} targets...`).catch(() => {});
    for (const t of targets) {
      try { await (t.send ? t.send(message) : t.user.send(message)); sent++; }
      catch { failed++; }
      await new Promise(r => setTimeout(r, 300));
    }
    if (statusMsg) statusMsg.edit(`✅ Done! Sent: ${sent} | Failed: ${failed}`).catch(() => {});
    else replyUser(msg, `✅ Done! Sent: ${sent} | Failed: ${failed}`).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .extract — Owner Only
  // ─────────────────────────────────────────────
  if (/^\.leave(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    const args = txt.split(/\s+/).slice(1); const target = args[0];
    if (!target) {
      if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
      if (msg.guild.id === GUILD_ID) { replyUser(msg, "❌ can't leave main server, dumbass.").catch(() => {}); return; }
      try { await msg.guild.leave(); replyUser(msg, `✅ left **${msg.guild.name}**, bro.`).catch(() => {}); }
      catch (e) { replyUser(msg, `❌ failed: \`${e.message}\``).catch(() => {}); }
      return;
    }
    if (target.toLowerCase() === "all") {
      let left = 0, failed = 0;
      for (const g of client.guilds.cache.values()) {
        if (g.id === GUILD_ID) continue;
        try { await g.leave(); left++; } catch { failed++; }
      }
      replyUser(msg, `✅ left **${left}** servers${failed ? ` (${failed} failed)` : ""}. Main server safe.`).catch(() => {});
      return;
    }
    try {
      const guild = await client.guilds.fetch(target.trim());
      if (guild.id === GUILD_ID) { replyUser(msg, "❌ can't leave main server, dumbass.").catch(() => {}); return; }
      await guild.leave(); replyUser(msg, `✅ left **${guild.name}**, bro.`).catch(() => {});
    } catch { replyUser(msg, "❌ invalid server id, dumbass.").catch(() => {}); }
    return;
  }
  // ─────────────────────────────────────────────
  // .dm — Owner Only (DM all members with a role or single user)
  // ─────────────────────────────────────────────
  if (/^\.dm(?:\s|$)/i.test(txt)) {
    if (!isOwner(msg.author.id)) { replyUser(msg, "❌ owner only, dumbass.").catch(() => {}); return; }
    if (isDM) { replyUser(msg, "❌ use this in a server, dumbass.").catch(() => {}); return; }
    // Parse role mention, user mention, or ID
    const roleMention = txt.match(/<@&(\d+)>/);
    const userMention = txt.match(/<@!?(\d+)>/);
    let targetType = null; // "role" or "user"
    let targetId = null;
    let messageStart = 0;
    
    if (roleMention) {
      targetType = "role";
      targetId = roleMention[1];
      messageStart = txt.indexOf(roleMention[0]) + roleMention[0].length;
    } else if (userMention) {
      targetType = "user";
      targetId = userMention[1];
      messageStart = txt.indexOf(userMention[0]) + userMention[0].length;
    } else {
      const args = txt.split(/\s+/).slice(1);
      if (args[0] && /^\d+$/.test(args[0])) {
        targetId = args[0].trim();
        messageStart = txt.indexOf(args[0]) + args[0].length;
        // Try to determine if it's a role or user
        try {
          const roleCheck = await msg.guild.roles.fetch(targetId);
          if (roleCheck) targetType = "role";
        } catch {}
        if (!targetType) {
          try {
            const userCheck = await msg.guild.members.fetch(targetId);
            if (userCheck) targetType = "user";
          } catch {}
        }
      }
    }
    
    if (!targetId || !targetType) { replyUser(msg, "❌ mention a role/user or paste ID, dumbass.").catch(() => {}); return; }
    const messageText = txt.slice(messageStart).trim();
    if (!messageText) { replyUser(msg, "❌ put a message to send, idiot.").catch(() => {}); return; }
    
    if (targetType === "user") {
      // Single user DM
      try {
        const member = await msg.guild.members.fetch(targetId);
        if (!member) { replyUser(msg, "❌ user not found in this server, dumbass.").catch(() => {}); return; }
        const startMsg = await replyUser(msg, `⏳ Sending DM to **${member.user.tag}**...`).catch(() => {});
        try {
          await member.send(messageText);
          const result = `✅ **DM Sent!**\n\n👤 User: **${member.user.tag}**\n✅ Status: \`Sent\`\n📨 Message:\n> ${messageText.slice(0, 1000)}`;
          if (startMsg) startMsg.edit(result).catch(() => {});
          else replyUser(msg, result).catch(() => {});
        } catch {
          const result = `❌ **DM Failed!**\n\n👤 User: **${member.user.tag}**\n❌ Status: \`Failed to send\``;
          if (startMsg) startMsg.edit(result).catch(() => {});
          else replyUser(msg, result).catch(() => {});
        }
      } catch (e) {
        replyUser(msg, `❌ invalid user, dumbass.`).catch(() => {});
      }
      return;
    }
    
    // Role-based DM (original ghostdm behavior)
    let role = null;
    try { role = await msg.guild.roles.fetch(targetId); } catch {}
    if (!role) { replyUser(msg, "❌ invalid role, dumbass.").catch(() => {}); return; }
    const startMsg = await replyUser(msg, `⏳ Sending DMs to **${role.members?.size || "?"}** members with role **${role.name}**...`).catch(() => {});
    let sent = 0, failed = 0;
    try { await msg.guild.members.fetch(); } catch {}
    const membersWithRole = msg.guild.members.cache.filter(m => m.roles.cache.has(targetId) && !m.user.bot);
    for (const member of membersWithRole.values()) {
      try {
        await member.send(messageText);
        sent++;
      } catch {
        failed++;
      }
    }
    const result = `✅ **DM complete!**\n\n👥 Role: **${role.name}**\n✅ Sent: \`${sent}\`\n❌ Failed: \`${failed}\`\n📨 Message:\n> ${messageText.slice(0, 1000)}`;
    if (startMsg) startMsg.edit(result).catch(() => {});
    else replyUser(msg, result).catch(() => {});
    return;
  }
  // ─────────────────────────────────────────────
  // .delwh — Delete Webhook (regular + buyer)
  // ─────────────────────────────────────────────
  if (/^\.delwh(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "whs", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    
    const arg = txt.split(/\s+/)[1]?.trim();
    if (!arg) {
      return replyUser(msg, "❌ usage: `.delwh <webhook_url>`, dumbass.").catch(() => {});
    }
    
    let webhookUrl = arg;
    const urlMatch = txt.match(/(https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+)/i);
    if (urlMatch) webhookUrl = urlMatch[1];

    const timeFooter = `Requested by @${msg.author.username}│Webhook Delete`;
    const loadingEmbed = new EmbedBuilder()
      .setColor(getEmbedColor(isBuyerUser))
      .setTitle("Deleting Webhook URL...")
      .setDescription("⏳ Processing...")
      .setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [loadingEmbed] }).catch(() => {});

    try {
      const res = await fetch(webhookUrl, { method: "DELETE" });
      
      if (sentMsg) await sentMsg.delete().catch(() => {});
      
      if (res.status === 404) {
        await msg.channel.send(`<@${msg.author.id}> ❌ Not Found`).catch(() => {});
      } else {
        const resultEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("Result")
          .setFooter({ text: timeFooter });
        
        if (res.ok) {
          resultEmbed.setDescription("✅ Delete");
        } else {
          resultEmbed.setDescription(`❌ failed: HTTP ${res.status}`);
        }
        
        await msg.channel.send({
          content: `<@${msg.author.id}> done, delete the webhook bro!`,
          embeds: [resultEmbed]
        }).catch(() => {});
      }
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ error: ${e.message.slice(0,100)}`).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // ─────────────────────────────────────────────
  // ─────────────────────────────────────────────
  // .whs — Webhook Spammer (with Start button + modal)
  // ─────────────────────────────────────────────
  if (/^\.whs(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    
    const panelEmbed = new EmbedBuilder()
      .setColor(getEmbedColor(perm.isBuyer))
      .setDescription("Click `Start` button below to start.");
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("whs_start")
        .setLabel("Start")
        .setStyle(ButtonStyle.Success)
    );
    
    const panelMsg = await replyUser(msg, { embeds: [panelEmbed], components: [row] }).catch(() => {});
    if (panelMsg) {
      whsPanelOwners.set(panelMsg.id, msg.author.id);
      setTimeout(() => whsPanelOwners.delete(panelMsg.id), 10 * 60 * 1000);
    }
    return;
  }

  // .upload — file → Pastefy loadstring (regular + buyer)
  // ─────────────────────────────────────────────
  // .promdeobf — Prometheus Deobfuscator
  if (/^\.promdeobf(?:\s|$)/i.test(txt)) {
    const startTime = Date.now();
    const arg = txt.split(/\s+/)[1]?.trim();
    let fileContent = null;
    let fileName = "deobfuscated.lua";

    if (msg.attachments && msg.attachments.size > 0) {
      const att = msg.attachments.first();
      fileName = att.name || "deobfuscated.lua";
      try { const res = await fetch(att.url); fileContent = await res.text(); } catch {}
    }
    if (!fileContent && msg.reference && msg.reference.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        if (refMsg.attachments && refMsg.attachments.size > 0) {
          const att = refMsg.attachments.first();
          fileName = att.name || "deobfuscated.lua";
          const res = await fetch(att.url);
          fileContent = await res.text();
        }
      } catch {}
    }
    if (!fileContent && arg && /^https?:\/\//i.test(arg)) {
      try {
        let url = arg;
        if (url.includes("github.com") && url.includes("/blob/")) {
          url = url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
        }
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        fileContent = await res.text();
        fileName = "deobfuscated.lua";
      } catch {}
    }

    if (!fileContent || !fileContent.trim()) {
      replyUser(msg, "❌ attach a lua. luau. & .txt file or reply to a one or put url.").catch(() => {});
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    const loadingEmbed = new EmbedBuilder()
      .setColor(REGULAR_COLOR)
      .setTitle("Deobfuscating...")
      .setDescription("⏳ Processing...")
      .setFooter({ text: "Today at " + timeStr });
    const loadingMsg = await msg.channel.send({ embeds: [loadingEmbed] }).catch(() => null);

    let resultCode = null;
    let errorMsg = null;
    try {
      const { deobfuscate } = global.__promDeobf;
      const result = deobfuscate(fileContent, { detect: false, name: fileName });
      resultCode = result.code;
    } catch (e) {
      errorMsg = e.message;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (loadingMsg) await loadingMsg.delete().catch(() => {});

    if (errorMsg || !resultCode) {
      replyUser(msg, "❌ deobfuscate failed: " + (errorMsg || "unknown error")).catch(() => {});
      return;
    }

    const previewLines = resultCode.split("\n").slice(0, 5).join("\n");
    const resultEmbed = new EmbedBuilder()
      .setColor(REGULAR_COLOR)
      .setTitle("File Preview")
      .setDescription("```lua\n" + previewLines.substring(0, 400) + "\n```")
      .setFooter({ text: "Today at " + timeStr });

    const outName = "deobf_" + Math.random().toString(36).substring(2, 10) + ".lua";
    const { AttachmentBuilder } = require("discord.js");
    const attachment = new AttachmentBuilder(Buffer.from(resultCode, "utf-8"), { name: outName });

    await msg.channel.send({
      content: `<@${msg.author.id}> Here you go!\nFinish in \`${elapsed}s\``,
      embeds: [resultEmbed],
      files: [attachment]
    }).catch(() => {});
    return;
  }

  if (/^\.upload(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "upload", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    let attachments = [...(msg.attachments?.values() || [])].filter(a => {
      const e = ext(a.name);
      return e === "txt" || e === "lua";
    });
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        for (const a of refMsg.attachments?.values?.() || []) {
          const e = ext(a.name);
          if (e === "txt" || e === "lua") attachments.push(a);
        }
        for (const s of refMsg.messageSnapshots?.values?.() || []) {
          for (const a of s.attachments?.values?.() || []) {
            const e = ext(a.name);
            if (e === "txt" || e === "lua") attachments.push(a);
          }
        }
      } catch {}
    }
    if (!attachments.length) { replyUser(msg, "❌ upload a txt or lua file, dumbass.").catch(() => {}); return; }
    const file = attachments[0];
    if (file.size > 200 * 1024) { replyUser(msg, "❌ max is 200kb lol.").catch(() => {}); return; }
    const sentMsg = await replyUser(msg, "⏳ Uploading...").catch(() => {});
    try {
      const res = await fetch(file.url);
      const content = await res.text();
      const apiKey = process.env.PASTEFY_API_KEY;
      if (!apiKey) throw new Error("PASTEFY_API_KEY not set in env vars");
      // Try Pastefy API v2 with minimal fields
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      };
      const body = {
        title: file.name || "script.lua",
        content: content
      };
      let pastefyRes = await fetch("https://pastefy.app/api/v2/paste", {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      let rawUrl = null;
      if (pastefyRes.ok) {
        try {
          const data = await pastefyRes.json();
          const pid = data?.id || data?._id || data?.paste?.id;
          if (pid) rawUrl = `https://pastefy.app/${pid}/raw`;
        } catch {}
      }
      // Fallback: try v1 endpoint
      if (!rawUrl) {
        const v1Res = await fetch("https://pastefy.app/api/v1/paste", {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        if (v1Res.ok) {
          try {
            const data = await v1Res.json();
            const pid = data?.id || data?._id || data?.paste?.id;
            if (pid) rawUrl = `https://pastefy.app/${pid}/raw`;
          } catch {}
        } else {
          // Show v2 error if both failed
          const errText = await pastefyRes.text();
          throw new Error(`Pastefy v2 HTTP ${pastefyRes.status}: ${errText.slice(0, 150)}`);
        }
      }
      if (!rawUrl) throw new Error("Could not get paste URL from Pastefy response");
      const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;
      if (sentMsg) await sentMsg.delete().catch(() => {});
      const embed = new EmbedBuilder()
        .setColor(getEmbedColor(isBuyerUser))
        .setTitle("Script Copy")
        .setDescription(`\`\`\`lua\n${loadstring}\n\`\`\``)
        .setFooter({ text: `Request by @${msg.author.username}│File → Script`, iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
      await msg.channel.send({
        content: `<@${msg.author.id}> Here is the script bro!`,
        embeds: [embed]
      }).catch(() => {});
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ upload failed: ${e.message}`).catch(() => {});
    }
    return;
  }
  // ─────────────────────────────────────────────
  // .obf — Prince Obfuscator (regular + buyer)
  // ─────────────────────────────────────────────
  // ─────────────────────────────────────────────

  // .find, .get, .rename/.rn, .et, .dl/.download
  // ─────────────────────────────────────────────

  // .et — carousel mode
  if (/^\.et(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg, true);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    if (isDM && !perm.isBuyer) { replyUser(msg, "❌ not here, dumbass.").catch(() => {}); return; }
    const cd = checkCommandCooldown(msg.author.id, "et", perm.isBuyer);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    let attachments = extractAttachmentsOf(msg);
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        attachments = extractAttachmentsOf(refMsg);
      } catch {}
    }
    if (!attachments.length) {
      replyUser(msg, "❌ upload a .zip file or reply to one, dumbass.").catch(() => {});
      return;
    }
    const sourceFile = attachments[0];
    const maxInfo = getMaxFileSize(msg.guild);
    if (sourceFile.size > maxInfo.size) {
      replyUser(msg, `❌ max file is ${maxInfo.label}, lol.`).catch(() => {});
      return;
    }
    const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
    try {
      const buf = await downloadURL(sourceFile.url);
      let files = extractFilesFromZip(buf);
      if (!files.length) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, "❌ zip is empty or has no extractable files, bro.").catch(() => {});
        return;
      }
      if (sentMsg) await sentMsg.delete().catch(() => {});
      const firstFile = files[0];
      const attachment = new AttachmentBuilder(firstFile.data, { name: firstFile.name });
      const pageLabel = `1/${files.length}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("extract_prev").setEmoji("⬅️").setStyle(ButtonStyle.Secondary).setDisabled(files.length <= 1),
        new ButtonBuilder().setCustomId("extract_page").setLabel(pageLabel).setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId("extract_next").setEmoji("➡️").setStyle(ButtonStyle.Secondary).setDisabled(files.length <= 1)
      );
      const carouselMsg = await msg.channel.send({ files: [attachment], components: [row] }).catch(() => {});
      if (carouselMsg) {
        extractCarouselMenus.set(msg.author.id, {
          files, index: 0, sourceType: "zip",
          messageId: carouselMsg.id, authorId: msg.author.id, createdAt: Date.now()
        });
      }
    } catch (e) {
      if (sentMsg) await sentMsg.delete().catch(() => {});
      replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
    }
    return;
  }
  // .rename / .rn
  if (/^\.(?:rename|rn)$/i.test(txt)) {
    const perm = await checkRegularPermission(msg, false);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "rename", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    let attachments = [...(msg.attachments?.values() || [])];
    if (!attachments.length && msg.reference?.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        attachments = [...allAttachmentsOf(refMsg)];
      } catch {}
    }
    if (!attachments.length) { replyUser(msg, "❌ bruh, upload file or reply to a file.").catch(() => {}); return; }
    const file = attachments[0];
    const fileExt = ext(file.name);
    if (fileExt !== "lua" && fileExt !== "txt") { replyUser(msg, "❌ only .lua and .txt is working, idiot.").catch(() => {}); return; }
    const timeFooter = `Today at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" })}`;
    const workingEmbed = new EmbedBuilder()
      .setColor(getEmbedColor(isBuyerUser))
      .setTitle("Renaming...")
      .setDescription("⏳ Processing...")
      .setFooter({ text: timeFooter });
    const sentMsg = await replyUser(msg, { embeds: [workingEmbed] }).catch(() => {});
    // NO DELAY — FAST response
    (async () => {
      try {
        const res = await fetch(file.url);
        const text = await res.text();
        // Extract URLs from original file content
        const urlRegex = /https?:\/\/[^\s"'()\]]+/g;
        const foundUrls = text.match(urlRegex) || [];
        const cleaned = cleanLuaScript(text);
        
        // Stats
        const originalLines = text.split("\n").length;
        const cleanedLines = cleaned.split("\n").length;
        const linesRemoved = originalLines - cleanedLines;
        const originalSize = Buffer.byteLength(text, "utf8");
        const cleanedSize = Buffer.byteLength(cleaned, "utf8");
        
        // Filename: 20 random chars + .lua
        const randChars = "abcdefghijklmnopqrstuvwxyz";
        let outputName = "";
        for (let i = 0; i < 20; i++) {
          outputName += randChars.charAt(Math.floor(Math.random() * randChars.length));
        }
        outputName += ".lua";
        
        const finalOutput = cleaned;
        
        const allLines = cleaned.split("\n");
        // Limit preview to MAX 50 words (or 5 lines, whichever comes first)
        let previewWords = [];
        let wordCount = 0;
        let lineCount = 0;
        for (const line of allLines) {
          if (lineCount >= 5 || wordCount >= 50) break;
          const words = line.trim().split(/\s+/).filter(Boolean);
          for (const w of words) {
            if (wordCount >= 50) break;
            previewWords.push(w);
            wordCount++;
          }
          previewWords.push("\n");
          lineCount++;
        }
        let previewText = previewWords.join(" ").replace(/ \n /g, "\n").trim();
        if (previewText.endsWith("\n")) previewText = previewText.slice(0, -1);
        if (wordCount >= 50 || lineCount >= 5) previewText += "\n...";
        // Safety truncation
        if (previewText.length > 1000) previewText = previewText.slice(0, 1000) + "\n...";
        
        // Build description with URL section if links found
        let description = `\`\`\`lua\n${previewText}\n\`\`\``;
        if (foundUrls.length > 0) {
          const uniqueUrls = [...new Set(foundUrls)];
          const urlList = uniqueUrls.slice(0, 10).map(u => `- ${u}`).join("\n");
          let urlSection = `\n\n**URL Found:**\n${urlList}`;
          if (uniqueUrls.length > 10) urlSection += `\n- ...and ${uniqueUrls.length - 10} more`;
          description += urlSection.slice(0, 800);
        }
        
        const avatarURL = msg.author.displayAvatarURL({ dynamic: true, size: 128 });
        const resultEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("File Preview")
          .setDescription(description)
          .setFooter({ text: `Request by @${msg.author.username}│Clean & Fixed`, iconURL: avatarURL });
        const fixedFile = new AttachmentBuilder(Buffer.from(finalOutput), { name: outputName });
        if (sentMsg) await sentMsg.delete().catch(() => {});
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here you go bro!**`,
          files: [fixedFile],
          embeds: [resultEmbed]
        }).catch(() => {});
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
      }
    })();
    return;
  }
  // .get
  if (/^\.get(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const cd = checkCommandCooldown(msg.author.id, "get", perm.isBuyer);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    const id = txt.split(/\s+/)[1];
    if (!id) { replyUser(msg, "❌ put id of file, idiot.").catch(() => {}); return; }
    const file = getFile(id);
    if (!file) { replyUser(msg, "❌ your id is wrong, try find working id, dumbass.").catch(() => {}); return; }
    const freshUrl = await getFreshUrl(file);
    replyUser(msg, { content: "**Here is the file twin!**", files: [{ attachment: freshUrl || file.url, name: file.filename || "file" }] }).catch(() => {});
    return;
  }
  // .dl / .download — gives file from library ID OR downloads from Discord CDN link
  if (/^\.download(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const arg = txt.split(/\s+/)[1];
    if (!arg) { replyUser(msg, "❌ put file link, idiot.").catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "dl", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }

    // Check if Instagram URL
    if (/instagram\.com|instagr\.am|ig\.me/i.test(arg)) {
      const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
      try {
        let downloadUrl = null;
        let mediaType = "Media";
        try {
          const apiRes = await fetch("https://api.cobalt.tools/api/json", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ url: arg })
          });
          if (!apiRes.ok) throw new Error("API " + apiRes.status);
          const data = await apiRes.json();
          
          if (data?.url) {
            downloadUrl = data.url;
            mediaType = data.audio ? "Audio" : "Video/Photo";
          } else if (data?.audio) {
            downloadUrl = data.audio;
            mediaType = "Audio";
          } else if (data?.picker && Array.isArray(data.picker) && data.picker.length > 0) {
            downloadUrl = data.picker[0].url;
            mediaType = "Photo (1/" + data.picker.length + ")";
          }
        } catch {}
        
        if (!downloadUrl) throw new Error("Failed to get Instagram media");
        
        const resEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("📥 Instagram Download")
          .setDescription("**Type:** " + mediaType + "\n🔗 **Download:** [Click Here](" + downloadUrl + ")")
          .setFooter({ text: "Request by @" + msg.author.username + "│Instagram DL", iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
        
        if (sentMsg) await sentMsg.delete().catch(() => {});
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here you go bro!**`,
          embeds: [resEmbed]
        }).catch(() => {});
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, "❌ failed — link may be private, expired, or not a post/reel.").catch(() => {});
      }
      return;
    }

    // Check if TikTok URL — NO WATERMARK
    if (/tiktok\.com|vm\.tiktok\.com/i.test(arg)) {
      const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
      try {
        // Try cobalt.tools first (clean, no watermark)
        let videoUrl = null;
        try {
          const apiRes = await fetch("https://api.cobalt.tools/api/json", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ url: arg })
          });
          const data = await apiRes.json();
          if (data?.url) videoUrl = data.url;
        } catch {}
        
        // Fallback: tikwm
        if (!videoUrl) {
          try {
            const api2 = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(arg)}`);
            const d2 = await api2.json();
            if (d2?.data?.play) videoUrl = d2.data.play;
          } catch {}
        }
        
        if (!videoUrl) throw new Error("Failed to get video");
        
        const resEmbed = new EmbedBuilder()
          .setColor(getEmbedColor(isBuyerUser))
          .setTitle("📥 TikTok Download")
          .setDescription(`🔗 **Download:** [Click Here](${videoUrl})`)
          .setFooter({ text: `Request by @${msg.author.username}│TikTok DL`, iconURL: msg.author.displayAvatarURL({ dynamic: true, size: 128 }) });
        
        if (sentMsg) await sentMsg.delete().catch(() => {});
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here you go bro!**`,
          embeds: [resEmbed]
        }).catch(() => {});
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ failed: ${e.message.slice(0, 80)}`).catch(() => {});
      }
      return;
    }

    // Check if input is a URL
    if (/^https?:\/\//i.test(arg) || /cdn\.discordapp\.com/i.test(arg) || /media\.discordapp\.net/i.test(arg)) {
      const sentMsg = await replyUser(msg, "⏳ Processing...").catch(() => {});
      try {
        const buf = await downloadURL(arg);
        // Extract filename from URL
        let fileName = "file";
        const urlMatch = arg.match(/\/([^/?#]+)(?:\?|#|$)/);
        if (urlMatch) fileName = decodeURIComponent(urlMatch[1]);
        const fileExt = ext(fileName);
        if (!fileExt) fileName += ".txt";
        const attachment = new AttachmentBuilder(buf, { name: fileName });
        if (sentMsg) await sentMsg.delete().catch(() => {});
        await msg.channel.send({
          content: `<@${msg.author.id}> **Here you go bro!**`,
          files: [attachment]
        }).catch(() => {});
      } catch (e) {
        if (sentMsg) await sentMsg.delete().catch(() => {});
        replyUser(msg, `❌ error: ${e.message}`).catch(() => {});
      }
      return;
    }

    // Otherwise treat as file ID from library
    const file = getFile(arg);
    if (!file) { replyUser(msg, "❌ your id is wrong, try find working id, dumbass.").catch(() => {}); return; }
    const freshUrl = await getFreshUrl(file);
    const fileUrl = freshUrl || file.url;
    const fileAttachment = { attachment: fileUrl, name: file.filename || "file.lua" };
    
    await msg.channel.send({
      content: `<@${msg.author.id}> **Here is the file twin!**`,
      files: [fileAttachment]
    }).catch(() => {});
    return;
  }
  // .find
  if (/^\.find(?:\s|$)/i.test(txt)) {
    const perm = await checkRegularPermission(msg);
    if (!perm.allowed) { replyUser(msg, perm.reason).catch(() => {}); return; }
    const query = txt.slice(5).trim();
    if (!query) { replyUser(msg, "❌ usage: `.find <file name>`, dumbass.").catch(() => {}); return; }
    const results = findFiles(query);
    if (!results.length) { replyUser(msg, "❌ no found for that, dumbass.").catch(() => {}); return; }
    const isBuyerUser = perm.isBuyer;
    const cd = checkCommandCooldown(msg.author.id, "find", isBuyerUser);
    if (cd.onCooldown) { replyUser(msg, `❌ ${cd.message}`).catch(() => {}); return; }
    const perPage = 8; const totalPages = Math.ceil(results.length / perPage);
    const pageItems = results.slice(0, perPage);
    const timeNow = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });
    const embed = new EmbedBuilder()
      .setColor(getEmbedColor(isBuyerUser))
      .setTitle(getFinderTitle(isBuyerUser))
      .setDescription(pageItems.map(f => `\`${f.filename}\` — ID: \`${f.id}\``).join("\n"))
      .setFooter({ text: `Pages 1/${totalPages} │ Today at ${timeNow}` });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prev_page").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("next_page").setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(totalPages <= 1)
    );
    const sent = await replyUser(msg, { embeds: [embed], components: [row] }).catch(() => {});
    if (sent) paginationMenus.set(msg.author.id, {
      results, page: 1, totalPages, messageId: sent.id,
      authorId: msg.author.id, createdAt: Date.now(), isBuyer: isBuyerUser
    });
    return;
  }
});
// ============================================================
// EXPRESS SERVER
// ============================================================
const app = express();
app.get("/", (req, res) => res.status(200).send(isReady ? "✅ ONLINE" : "⏳ Starting..."));
app.get("/health", (req, res) => res.status(200).json({
  process: "online", discord: isReady ? "ready" : "offline", bot: client.user?.tag, guild: GUILD_ID, files: library.files.length
}));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 Port ${PORT}`));
const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || "";
if (keepAliveUrl) {
  setInterval(() => {
    try { require("https").get(`${keepAliveUrl}/health`).on("error", () => {}); } catch(e) {}
  }, 180000);
}
process.on("unhandledRejection", e => console.error("❌ Rejection:", e));
process.on("uncaughtException", e => console.error("❌ Exception:", e));
console.log("🔑 Connecting...");
client.login(TOKEN).catch(e => { console.error("❌ Login fail:", e); process.exit(1); });
