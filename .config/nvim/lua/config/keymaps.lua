-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

local map = vim.keymap.set

-- -- opencode
-- if vim.fn.executable("opencode") == 1 then
--   map({ "n", "t" }, "<c-o>", function()
--     Snacks.terminal.focus("opencode", {
--       interactive = true,
--       win = {
--         position = "float",
--         backdrop = 60,
--         height = 0.9,
--         width = 0.95,
--         zindex = 50,
--       },
--     })
--   end, { desc = "OpenCode" })
-- end

-- claude
if vim.fn.executable("claude") == 1 then
  map({ "n", "t" }, "<c-o>", function()
    Snacks.terminal.focus("bash -ic 'clear && claude'", {
      interactive = true,
      win = {
        position = "float",
        backdrop = 60,
        height = 0.9,
        width = 0.95,
        zindex = 50,
      },
    })
  end, { desc = "Claude Code" })
end
