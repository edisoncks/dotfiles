return {
  {
    "folke/snacks.nvim",
    opts = {
      picker = {
        sources = {
          explorer = {
            hidden = true,
          },
          files = {
            hidden = true,
          },
        },
      },
      terminal = {
        win = {
          position = "float",
          backdrop = 60,
          height = 0.9,
          width = 0.95,
          zindex = 50,
        },
      },
    },
  },
}
