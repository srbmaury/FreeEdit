"use strict";

// Pure history codec and retention policy. PNG assets are stored once across
// snapshots rather than copied into every JSON document. No DOM or editor state.
const HistoryModel = (() => {
  const MAX_BYTES = 16 * 1024 * 1024;
  const MAX_ENTRIES = 100;
  function capture(document, entries = []) {
    const known = new Map(entries.flatMap(entry => entry.assets).map(asset => [asset, asset]));
    const assets = [];
    const indices = new Map();
    const json = JSON.stringify(document, (key, value) => {
      if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) return value;
      if (!indices.has(value)) {
        indices.set(value, assets.length);
        assets.push(known.get(value) ?? value);
      }
      return {$freeeditAsset: indices.get(value)};
    });
    return {json, assets};
  }
  function read(entry) {
    return JSON.parse(entry.json, (key, value) =>
      value && typeof value === "object" && Object.keys(value).length === 1 &&
      Number.isInteger(value.$freeeditAsset) ? entry.assets[value.$freeeditAsset] : value);
  }
  function same(a, b) {
    return !!a && !!b && a.json === b.json && a.assets.length === b.assets.length &&
      a.assets.every((asset, index) => asset === b.assets[index]);
  }
  function bytes(entries) {
    // Conservative UTF-16 payload accounting, excluding small object overhead.
    const assets = new Set(entries.flatMap(entry => entry.assets));
    return 2 * (entries.reduce((total, entry) => total + entry.json.length, 0) +
      [...assets].reduce((total, asset) => total + asset.length, 0));
  }
  function trim(primary, secondary, {maxBytes = MAX_BYTES, maxEntries = MAX_ENTRIES} = {}) {
    while (primary.length + secondary.length > maxEntries || bytes([...primary, ...secondary]) > maxBytes) {
      // Keep the nearest undo/redo steps, discarding the farthest steps first.
      const stack = secondary.length >= primary.length && secondary.length ? secondary : primary;
      if (!stack.length) break;
      stack.shift();
    }
  }
  function push(stack, entry, other = [], limits) {
    if (!same(stack.at(-1), entry)) stack.push(entry);
    trim(stack, other, limits);
  }
  return Object.freeze({capture, read, same, bytes, push, MAX_BYTES, MAX_ENTRIES});
})();
