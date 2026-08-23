return {
  "folke/which-key.nvim",
  opts = {
    spec = {
      {
        "<leader>p",
        function()
          Snacks.terminal.focus("pi", {
            interactive = true,
            win = {
              position = "float",
              backdrop = 60,
              height = 0.9,
              width = 0.95,
              zindex = 50,
            },
          })
        end,
        desc = "Pi Coding Agent",
        icon = "󰚩",
        mode = "n",
        cond = function()
          return vim.fn.executable("pi") == 1
        end,
      },
    },
  },
}
