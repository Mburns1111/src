// Run with: node scripts/preview-post-appearance.js
// Writes two local PNGs; does not post to Discord or alter saved profiles.
import { mkdir, writeFile } from 'node:fs/promises';
import { renderPostImage } from '../services/post-renderer.js';

const output = 'tmp/appearance-previews';
await mkdir(output, { recursive: true });
const data = {
  displayName: 'Sample ❀ Member',
  discordUsername: 'sample_user',
  robloxUsername: 'SampleRoblox',
  serverRoles: ['Community', 'Member'],
  lookingForTrades: true,
  bio: 'This is a preview of the shared card appearance system.',
};
for (const [name, appearance] of [
  ['default', {}],
  ['garden-background', { background: 'garden', panelColor: 'match', panelOpacity: 0.58, stickers: [{ id: 'flower', x: 0.85, y: 0.2, scale: 1, rotation: 20 }] }],
  ['garden-lavender-panels', { background: 'garden', panelColor: 'lavender', panelOpacity: 0.72 }],
  ['customized', {
    background: 'sageDots',
    frame: 'doubleLine',
    font: 'classic',
    fontColor: 'plum',
    stickers: [
      { id: 'flower', x: 0.89, y: 0.17, scale: 0.8, rotation: 20 },
      { id: 'star', x: 0.11, y: 0.85, scale: 0.6, rotation: -10 },
    ],
  }],
]) {
  const image = await renderPostImage({ type: 'profile', data, appearance });
  const file = `${output}/profile-${name}.png`;
  await writeFile(file, image);
  console.log(`Wrote ${file}`);
}
