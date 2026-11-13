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
printf 'Port 2222\nPasswordAuthentication yes\nSubsystem sftp internal-sftp\n' | $SUDO tee -a /etc/ssh/sshd_config >/dev/null
$SUDO ssh-keygen -A >/dev/null 2>&1
$SUDO /usr/sbin/sshd
sleep 2
echo "external test servers ready"
