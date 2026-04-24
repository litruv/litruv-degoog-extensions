/**
 * Link Target — overrides the target attribute on all result links.
 */
export default {
  name: "Link Target",
  description: "Override where result links open (_top, _blank, _parent, _self).",
  trigger: "__link_target",

  settingsSchema: [
    {
      key: "linkTarget",
      label: "Link target",
      type: "select",
      options: ["_top", "_blank", "_parent", "_self"],
      default: "_top",
      description: "_top: break out of iframe, navigate same tab - _blank: open in a new tab - _parent: navigate parent frame - _self: open in the iframe itself",
    },
  ],

  execute() {
    return null;
  },
};
