#!/usr/bin/env bash
set -euo pipefail

: "${PUBLIC_IP:?Set PUBLIC_IP in /etc/default/smart-creative}"
certificate="/etc/letsencrypt/live/${PUBLIC_IP}/fullchain.pem"
if [[ ! -r "$certificate" ]]; then
  echo "IP TLS certificate is missing or unreadable: $certificate" >&2
  exit 1
fi
openssl x509 -in "$certificate" -noout -checkend 172800
