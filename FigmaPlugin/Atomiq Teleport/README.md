# Atomiq Teleport

Figma plugin for copying selected design layers as Teleport JSON that FRAMEWP can paste directly onto the canvas.

## Current Workflow

1. Select a frame, group, or layer in Figma.
2. Open the plugin and click Copy to Teleport.
3. Switch to FRAMEWP and paste on the canvas with the normal paste shortcut.

## What It Exports

- frames and groups as FRAMEWP frames
- text layers as editable FRAMEWP text
- image-filled layers as FRAMEWP images using embedded data URLs
- vector-style layers as FRAMEWP custom SVG icons
- basic auto layout as flex-style frame settings

## Local Development

1. Install dependencies:

   npm install

2. Build the plugin:

   npm run build

3. In Figma, import the plugin manifest from this folder.

## Notes

- This version embeds images as clipboard-safe data URLs so the copy flow works without external services.
- Automatic WordPress media upload is possible later, but it needs a dedicated authenticated upload endpoint and manifest network permissions.
