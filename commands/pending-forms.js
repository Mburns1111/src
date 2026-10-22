import PendingForm from "../models/PendingForm.js";

export async function trackPendingForm({
  guildId,
  ownerId,
  channelId,
  messageId,
  type,
  expiresAt = null,
}) {
  return PendingForm.create({
    guildId,
    ownerId,
    channelId,
    messageId,
    type,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });
}

export async function clearPendingForm(guildId, channelId, messageId) {
  await PendingForm.deleteOne({ guildId, channelId, messageId });
}

export async function getPendingFormStatus(guild, pendingForm) {
  let message;
  try {
    const channel = await guild.channels.fetch(pendingForm.channelId);
    if (!channel?.messages) {
      await clearPendingForm(guild.id, pendingForm.channelId, pendingForm.messageId);
      return "stale";
    }
    message = await channel.messages.fetch(pendingForm.messageId);
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) throw error;
    await clearPendingForm(guild.id, pendingForm.channelId, pendingForm.messageId);
    return "stale";
  }

  const prefix = `${pendingForm.type}:new:${pendingForm.ownerId}`;
  const createButton = message.components
    .flatMap((row) => row.components)
    .find((component) => component.customId?.startsWith(prefix));
  if (!createButton) {
    await clearPendingForm(guild.id, pendingForm.channelId, pendingForm.messageId);
    return "stale";
  }
  return createButton.disabled ? "submitting" : "active";
}

export async function discardPendingForm(guild, pendingForm) {
  try {
    const channel = await guild.channels.fetch(pendingForm.channelId);
    const message = await channel?.messages?.fetch(pendingForm.messageId);
    const prefix = `${pendingForm.type}:new:${pendingForm.ownerId}`;
    const isFormMessage = message?.components
      .flatMap((row) => row.components)
      .some((component) => component.customId?.startsWith(prefix));
    if (isFormMessage) await message.delete();
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) throw error;
  }

  await clearPendingForm(guild.id, pendingForm.channelId, pendingForm.messageId);
}

function hasCreateButton(message, pendingForm) {
  const prefix = `${pendingForm.type}:new:${pendingForm.ownerId}`;
  return message?.components
    .flatMap((row) => row.components)
    .some((component) => component.customId?.startsWith(prefix));
}

export async function cleanupPendingForms(guild) {
  const pendingForms = await PendingForm.find({ guildId: guild.id }).lean();
  let removedCount = 0;

  for (const pendingForm of pendingForms) {
    let channel;
    let message;
    try {
      channel = await guild.channels.fetch(pendingForm.channelId);
      message = await channel?.messages?.fetch(pendingForm.messageId);
      if (hasCreateButton(message, pendingForm)) {
        await message.delete();
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) {
        console.error(
          `Could not clean up pending ${pendingForm.type} form ${pendingForm.messageId}:`,
          error,
        );
        continue;
      }
    }

    await PendingForm.deleteOne({ _id: pendingForm._id });
    removedCount += 1;
  }

  if (removedCount) {
    console.log(`Removed ${removedCount} unfinished listing or trade form(s) in guild ${guild.id}.`);
  }
}
