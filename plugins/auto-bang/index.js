/**
 * Auto Bang — bang command autocomplete plugin.
 * The real feature lives in script.js which is injected globally on every page.
 * This minimal bang command is required so degoog loads the plugin and serves script.js.
 */
export default {
  name: "Auto Bang",
  description: "Type ! in the search box to get instant command suggestions as you type.",
  trigger: "autobang",
  aliases: ["bang"],
  settingsSchema: [
    {
      key: "maxSuggestions",
      label: "Max suggestions",
      type: "select",
      options: ["1", "2", "4", "6", "8", "10"],
      default: "6",
      description: "How many commands to show in the autocomplete dropdown.",
    },
    {
      key: "position",
      label: "Dropdown position",
      type: "select",
      options: ["above", "below"],
      default: "above",
      description: "Show the autocomplete dropdown above or below the search box.",
    },
  ],

  execute() {
    return {
      title: "Auto Bang",
      html: `<div style="padding:12px;font-size:0.85rem;color:var(--text-secondary)">Start typing <code>!</code> in the search box — Auto Bang will suggest commands automatically.</div>`,
    };
  },
};
