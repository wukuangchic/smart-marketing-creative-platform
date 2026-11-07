#!/usr/bin/env bash
set -euo pipefail

certificate=/etc/letsencrypt/live/YOUR_PUBLIC_IP/fullchain.pem
if [[ ! -r "$certificate" ]]; then
  echo "IP TLS certificate is missing or unreadable: $certificate" >&2
  exit 1
fi
openssl x509 -in "$certificate" -noout -checkend 172800
