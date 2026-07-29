-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

local map = vim.keymap.set

-- pi coding agent
if vim.fn.executable("pi") == 1 then
  map({ "n", "t" }, "<c-o>", function()
    Snacks.terminal.focus("pi -c", {
      interactive = true,
      win = {
        position = "float",
        backdrop = 60,
        height = 0.9,
        width = 0.95,
        zindex = 50,
      },
    })
  end, { desc = "Pi Coding Agent" })
end
