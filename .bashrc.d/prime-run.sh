# Run a command with NVIDIA PRIME render offload.
# Usage: prime-run <command> [args...]
prime-run() {
  if [ $# -eq 0 ]; then
    echo "usage: prime-run <command> [args...]" >&2
    return 2
  fi
  command -v "$1" >/dev/null 2>&1 || {
    echo "prime-run: $1: command not found" >&2
    return 127
  }
  __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia __VK_LAYER_NV_optimus=NVIDIA_only "$@"
}
