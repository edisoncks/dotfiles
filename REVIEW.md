# Review — remaining issues

Issues from the initial review of `bootstrap.sh` that are **still open**.
The sourcing-related criticals are fixed (commits `70cf13c`, `b64364d`, `8fd9e63`).
The backup collision issue is fixed (`d803998`) and backups are now surfaced (`2d7ae3d`).

## Minor

### 1. Dangling symlinks
No check that `$DIR/$i` exists in the repo — a typo in the `DOTFILES` array silently creates a
broken link. Add `[ -e "$DOTFILE" ] || { echo "missing: $DOTFILE"; exit 1; }`.

### 2. Cosmetic echo
`echo "✅ Created symlinks for ~/$i"` prints even when nothing changed.
