require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const db = require("./db");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const FARM_CHANNEL_ID = process.env.FARM_CHANNEL_ID;
const HARVEST_ROLE_ID = process.env.HARVEST_ROLE_ID;
const GUILD_ID = process.env.GUILD_ID;
const HARVEST_CHANNEL_ID = "1487121637454381243";

const GROW_TIME_MS = 5 * 60 * 60 * 1000;
const activeTimers = new Map();
const harvestedPlantings = new Set();

function normalizeCropName(input) {
  return input.trim().toLowerCase();
}

function formatCropName(input) {
  const clean = input.trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// podrzava:
// cvetx5
// cvet x 5
// cvet 5
function parsePlantMessage(content) {
  const match = content.trim().match(/^([a-zA-ZčćžšđČĆŽŠĐ]+)\s*(?:x\s*)?(\d+)$/i);
  if (!match) return null;

  const cropKey = normalizeCropName(match[1]);
  const amount = parseInt(match[2], 10);

  if (!cropKey) return null;
  if (!Number.isInteger(amount) || amount <= 0) return null;

  return { cropKey, amount };
}

function discordTime(ms, format = "f") {
  return `<t:${Math.floor(ms / 1000)}:${format}>`;
}

function getMessageImage(message) {
  const attachment = message.attachments.find(att => {
    if (!att.contentType) {
      return /\.(png|jpe?g|gif|webp)$/i.test(att.name || "");
    }
    return att.contentType.startsWith("image/");
  });

  return attachment ? attachment.url : null;
}

function buildPlantEmbed({
  cropName,
  amount,
  userId,
  plantedAt,
  harvestAt,
  imageUrl
}) {
  const embed = new EmbedBuilder()
    .setTitle("🌱 Sadnja zabeležena!")
    .setDescription(`<@${userId}> je posadio/la.`)
    .addFields(
      { name: "🌿 Vrsta", value: cropName, inline: true },
      { name: "📦 Količina", value: String(amount), inline: true },
      { name: "🕒 Posađeno", value: discordTime(plantedAt), inline: true },
      { name: "⏰ Berba", value: discordTime(harvestAt), inline: true },
      { name: "📍 Lokacija", value: "Ranch", inline: true }
    )
    .setColor(0x57f287);

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

function buildHarvestEmbed({
  cropName,
  amount,
  userId,
  plantedAt,
  harvestAt,
  imageUrl
}) {
  const embed = new EmbedBuilder()
    .setTitle("🚨 Spremno za branje!")
    .setDescription(`<@${userId}> spremno je za branje.`)
    .addFields(
      { name: "🌿 Vrsta", value: cropName, inline: true },
      { name: "📦 Količina", value: String(amount), inline: true },
      { name: "🕒 Posađeno", value: discordTime(plantedAt), inline: true },
      { name: "✅ Spremno", value: discordTime(harvestAt), inline: true },
      { name: "📍 Lokacija", value: "Ranch", inline: true }
    )
    .setColor(0xed4245);

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

function buildHarvestedEmbed({
  cropName,
  amount,
  plantedUserId,
  harvestedByUserId,
  plantedAt,
  harvestAt,
  harvestedAt,
  imageUrl
}) {
  const embed = new EmbedBuilder()
    .setTitle("✅ Obrano!")
    .setDescription(
      `<@${harvestedByUserId}> je obrao/la sadnju od <@${plantedUserId}>.`
    )
    .addFields(
      { name: "🌿 Vrsta", value: cropName, inline: true },
      { name: "📦 Količina", value: String(amount), inline: true },
      { name: "🕒 Posađeno", value: discordTime(plantedAt), inline: true },
      { name: "⏰ Bilo spremno", value: discordTime(harvestAt), inline: true },
      { name: "🧺 Obrano", value: discordTime(harvestedAt), inline: true },
      { name: "👨‍🌾 Obrao", value: `<@${harvestedByUserId}>`, inline: true },
      { name: "📍 Lokacija", value: "Ranch", inline: true }
    )
    .setColor(0x5865f2);

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  return embed;
}

function buildHarvestButton(plantingId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`obrano_${plantingId}`)
      .setLabel("Obrano")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🧺")
  );
}

function insertPlanting(data) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO plantings (
        guild_id,
        channel_id,
        user_id,
        message_id,
        crop_key,
        amount,
        planted_at,
        harvest_at,
        harvested
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        data.guildId,
        data.channelId,
        data.userId,
        data.messageId,
        data.cropKey,
        data.amount,
        data.plantedAt,
        data.harvestAt
      ],
      function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, ...data });
      }
    );
  });
}

async function sendHarvestMessage(row) {
  const guild = await client.guilds.fetch(row.guildId).catch(() => null);
  if (!guild) return;

  const channel = await guild.channels.fetch(HARVEST_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = buildHarvestEmbed({
    cropName: formatCropName(row.cropKey),
    amount: row.amount,
    userId: row.userId,
    plantedAt: row.plantedAt,
    harvestAt: row.harvestAt,
    imageUrl: row.imageUrl || null
  });

  const content = HARVEST_ROLE_ID
    ? `<@&${HARVEST_ROLE_ID}> <@${row.userId}>`
    : `<@${row.userId}>`;

  await channel.send({
    content,
    embeds: [embed],
    components: [buildHarvestButton(row.id)]
  });
}

function scheduleHarvest(row) {
  const delay = Math.max(0, row.harvestAt - Date.now());

  const timeout = setTimeout(async () => {
    await sendHarvestMessage(row);
    activeTimers.delete(row.id);
  }, delay);

  activeTimers.set(row.id, timeout);
}

client.on("messageCreate", async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (message.guild.id !== GUILD_ID) return;
  if (message.channel.id !== FARM_CHANNEL_ID) return;

  const parsed = parsePlantMessage(message.content);
  if (!parsed) return;

  const plantedAt = Date.now();
  const harvestAt = plantedAt + GROW_TIME_MS;
  const imageUrl = getMessageImage(message);

  const saved = await insertPlanting({
    guildId: message.guild.id,
    channelId: message.channel.id,
    userId: message.author.id,
    messageId: message.id,
    cropKey: parsed.cropKey,
    amount: parsed.amount,
    plantedAt,
    harvestAt,
    imageUrl
  });

  saved.imageUrl = imageUrl;

  scheduleHarvest(saved);

  await message.react("✅").catch(() => null);

  const embed = buildPlantEmbed({
    cropName: formatCropName(parsed.cropKey),
    amount: parsed.amount,
    userId: message.author.id,
    plantedAt,
    harvestAt,
    imageUrl
  });

  await message.channel.send({ embeds: [embed] });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("obrano_")) return;

  const plantingId = interaction.customId.replace("obrano_", "");

  if (harvestedPlantings.has(plantingId)) {
    await interaction.reply({
      content: "Ovo je već obrano.",
      ephemeral: true
    }).catch(() => null);
    return;
  }

  harvestedPlantings.add(plantingId);

  const embed = interaction.message.embeds[0];
  const existingImage = embed?.image?.url || null;

  const fieldMap = new Map();
  for (const field of embed?.fields || []) {
    fieldMap.set(field.name, field.value);
  }

  const vrsta = fieldMap.get("🌿 Vrsta") || "Nepoznato";
  const kolicina = fieldMap.get("📦 Količina") || "0";
  const plantedUserMatch = interaction.message.content.match(/<@(\d+)>/);
  const plantedUserId = plantedUserMatch ? plantedUserMatch[1] : interaction.user.id;

  let plantedAt = Date.now();
  let harvestAt = Date.now();

  const readyField = fieldMap.get("✅ Spremno") || fieldMap.get("⏰ Bilo spremno");
  const plantedField = fieldMap.get("🕒 Posađeno");

  const plantedTimestampMatch = plantedField?.match(/<t:(\d+):[a-z]>/i);
  const readyTimestampMatch = readyField?.match(/<t:(\d+):[a-z]>/i);

  if (plantedTimestampMatch) {
    plantedAt = Number(plantedTimestampMatch[1]) * 1000;
  }

  if (readyTimestampMatch) {
    harvestAt = Number(readyTimestampMatch[1]) * 1000;
  }

  const editedEmbed = buildHarvestedEmbed({
    cropName: vrsta,
    amount: kolicina,
    plantedUserId,
    harvestedByUserId: interaction.user.id,
    plantedAt,
    harvestAt,
    harvestedAt: Date.now(),
    imageUrl: existingImage
  });

  await interaction.update({
    content: `✅ Obrano od strane <@${interaction.user.id}>`,
    embeds: [editedEmbed],
    components: []
  }).catch(() => null);
});

client.once("clientReady", () => {
  console.log(`Bot online kao ${client.user.tag}`);
});

const token = process.env.DISCORD_TOKEN?.trim();

if (!token) {
  console.error("DISCORD_TOKEN nije postavljen.");
  process.exit(1);
}

console.log("DISCORD_TOKEN postoji:", true);
console.log("Duzina tokena:", token.length);

client.login(token);
