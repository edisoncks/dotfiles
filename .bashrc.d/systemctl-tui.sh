# Workaround for the following error.
# ncurses: cannot initialize terminal type ($TERM="xterm-ghostty"); exiting
alias systemctl-tui='sudo env TERM=xterm-256color /home/edison/.local/share/mise/installs/github-rgwood-systemctl-tui/latest/systemctl-tui'
