"const {
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
  if ((statement.names || []).length !== 1) return…"
 https://p16-flow-file-sign.ibyteimg.com/tos-mya-i-u8dpqn1f20/rc/pc/super_tool/6d185ccadb30415ab84a15a1b90599e1.txt?rcl=20260926105718E56F81E61DD2D7B9B042&rk3s=8e244e95&rrcfp=f512b60b&x-expires=1790996436&x-signature=yJMRCiZOF8cPfBQzzixiPMvCUbU%3D#:~:text=const%20%7B%0A%20%20Client%2C%0A%20%20GatewayIntentBits,process.exit(1)%3B%20%7D)%3B
