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
fi

for d in /usr/share/icons/hicolor/*/apps; do
  [ -d "$d" ] && chmod 755 "$d" || true
done
chmod 644 /usr/share/icons/hicolor/*/apps/halo.png 2>/dev/null || true
chmod 644 /usr/share/applications/org.xvoidsx.halo.desktop 2>/dev/null || true

exit 0
