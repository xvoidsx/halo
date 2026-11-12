#!/bin/bash
# Halo .deb after-install: heal directory permissions left behind by
# the 0.1.0/0.1.1 packages.
#
# Those packages were built under umask 007, so /opt/Halo and its
# subdirectories shipped as 770 root:root. dpkg replaces *files* on
# upgrade but never fixes the mode of a directory that already exists,
# so a plain upgrade left /opt/Halo untraversable for a normal user and
# launching from rofi failed with "Permission denied" even though the
# binary itself was 755. Normalize the directories (and the icon and
# desktop file) here so an upgrade over the old install actually works.
set -e

if [ -d /opt/Halo ]; then
  # a+rX: everything readable, directories traversable, and anything
  # that already had an execute bit keeps it (binaries, .so files,
  # pty.node). This heals both the 770 directories AND the 640 files
  # the umask-007 builds shipped (npm installs node_modules as 640,
  # so the unpacked node-pty was unreadable by a normal user and the
  # terminal engine failed to load with EACCES).
  chmod -R a+rX /opt/Halo
  chmod 644 /opt/Halo/resources/app.asar 2>/dev/null || true
  # The Chromium SUID sandbox helper must be setuid-root (4755) or
  # Electron refuses to start on machines without unprivileged user
  # namespaces (this sandbox; some hardened hosts) — "The SUID sandbox
  # helper binary was found, but is not configured correctly". fpm
  # strips the setuid bit when building the deb, so set it here —
  # postinst runs as root. On machines with user namespaces enabled
  # (Debian default, including Raven's) it is simply unused.
  chmod 4755 /opt/Halo/chrome-sandbox 2>/dev/null || true
fi

for d in /usr/share/icons/hicolor/*/apps; do
  [ -d "$d" ] && chmod 755 "$d" || true
done
chmod 644 /usr/share/icons/hicolor/*/apps/halo.png 2>/dev/null || true
chmod 644 /usr/share/applications/org.xvoidsx.halo.desktop 2>/dev/null || true

# Put `halo` on PATH. electron-builder's default postinst registers
# /usr/bin/halo via update-alternatives — but setting deb.afterInstall
# REPLACES that default postinst, so since 0.1.7 (when this script was
# added) no install created the symlink at all: `halo` was
# command-not-found even after a clean apt install, and only rofi (whose
# .desktop Exec points at /opt/Halo/halo directly) worked. The postrm
# still tries to remove the alternative, so register it the same way
# the default postinst would; fall back to a plain symlink when
# update-alternatives is absent.
if [ -x /opt/Halo/halo ]; then
  if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --install /usr/bin/halo halo /opt/Halo/halo 100 || ln -sf /opt/Halo/halo /usr/bin/halo
  else
    ln -sf /opt/Halo/halo /usr/bin/halo
  fi
fi

exit 0
