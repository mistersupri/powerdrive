#!/usr/bin/env bash
# Starts a real Samba (SMB3, signing + encryption required) and OpenSSH SFTP server for the adapter tests.
#   sudo bash scripts/ci-external-servers.sh
#   export SD_TEST_SFTP=127.0.0.1:2222:sduser:pass123:/srv/sftproot
#   export SD_TEST_SMB=127.0.0.1:445:sduser:pass123:share
set -euo pipefail
SUDO=""; [ "$(id -u)" -eq 0 ] || SUDO="sudo"
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -q
$SUDO apt-get install -y -q samba smbclient openssh-server
id sduser >/dev/null 2>&1 || $SUDO useradd -M -s /bin/bash sduser
echo "sduser:pass123" | $SUDO chpasswd
$SUDO mkdir -p /srv/smbshare /srv/sftproot /var/run/sshd
$SUDO chown sduser /srv/smbshare /srv/sftproot
printf 'pass123\npass123\n' | $SUDO smbpasswd -a -s sduser >/dev/null
$SUDO tee /etc/samba/smb.conf >/dev/null <<'CONF'
[global]
  workgroup = WORKGROUP
  server role = standalone server
  map to guest = never
  server min protocol = SMB3
  server signing = mandatory
  smb encrypt = required
[share]
  path = /srv/smbshare
  read only = no
  valid users = sduser
  force user = sduser
CONF
$SUDO smbd -D
# sshd gets a configuration of its own. Appending to /etc/ssh/sshd_config is not enough: the first value of a keyword wins, and
# the runner image may carry a drop-in in sshd_config.d that turns password login off, which made the SFTP tests fail.
$SUDO ssh-keygen -A >/dev/null 2>&1
$SUDO tee /tmp/sshd_sd_test.conf >/dev/null <<'CONF'
Port 2222
ListenAddress 127.0.0.1
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key
PasswordAuthentication yes
KbdInteractiveAuthentication no
PubkeyAuthentication no
UsePAM no
AllowUsers sduser
Subsystem sftp internal-sftp
PidFile /tmp/sshd_sd_test.pid
CONF
$SUDO /usr/sbin/sshd -t -f /tmp/sshd_sd_test.conf
$SUDO /usr/sbin/sshd -f /tmp/sshd_sd_test.conf -E /tmp/sshd_sd_test.log
echo "external test servers ready"
