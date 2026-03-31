/**
 * Auto Bang — bang command autocomplete plugin.
 */
export default {
  name: "Auto Bang",
  description: "Type ! in the search box to get instant command suggestions as you type.",
  trigger: "autobang",
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
      html: `<div style="padding:12px">
        <img src="/plugins/auto-bang/pipeman-banging.gif" alt="Auto Bang" style="display:block;max-width:100%;border-radius:8px;margin-bottom:8px;" />
      </div>`,
    };
  },
};
